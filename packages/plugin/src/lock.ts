import { mkdir, writeFile, readFile, unlink, stat, rename, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { analysisLockPath, queueLockPath } from './plugin-paths.js';

export interface LockRecord {
  pid: number;
  acquired_at: string;
  session_id: string;
}

const ANALYSIS_STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes
const QUEUE_STALE_AFTER_MS = 10 * 1000; // 10 seconds — queue mutations are short-lived

function pidExists(pid: number): boolean {
  try {
    // kill(pid, 0) is the cross-platform "does this pid exist" probe.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === 'EPERM';
  }
}

async function readLockAt(path: string): Promise<LockRecord | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as LockRecord;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return null;
    throw err;
  }
}

export async function readLock(projectRoot: string): Promise<LockRecord | null> {
  return readLockAt(analysisLockPath(projectRoot));
}

async function isLockStaleAt(path: string, existing: LockRecord, now: Date, staleAfterMs: number): Promise<boolean> {
  try {
    const st = await stat(path);
    const age = now.getTime() - st.mtime.getTime();
    if (age < staleAfterMs) return false;
  } catch {
    return false;
  }
  return !pidExists(existing.pid);
}

async function tryAcquireAt(
  path: string,
  record: Omit<LockRecord, 'acquired_at'>,
  staleAfterMs: number,
  now: Date,
): Promise<boolean> {
  const existing = await readLockAt(path);
  if (existing !== null && !(await isLockStaleAt(path, existing, now, staleAfterMs))) return false;

  await mkdir(dirname(path), { recursive: true });
  const full: LockRecord = { ...record, acquired_at: now.toISOString() };
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(full, null, 2), 'utf8');
  await rename(tmp, path);
  return true;
}

export async function tryAcquireLock(
  projectRoot: string,
  record: Omit<LockRecord, 'acquired_at'>,
  opts: { now?: () => Date } = {},
): Promise<boolean> {
  const now = (opts.now ?? (() => new Date()))();
  return tryAcquireAt(analysisLockPath(projectRoot), record, ANALYSIS_STALE_AFTER_MS, now);
}

export async function releaseLock(projectRoot: string): Promise<void> {
  try { await unlink(analysisLockPath(projectRoot)); }
  catch (err) { if ((err as { code?: string }).code !== 'ENOENT') throw err; }
}

async function tryCreateExclusive(path: string, contents: string): Promise<boolean> {
  try {
    // `wx` = O_CREAT | O_EXCL: atomic "create only if it does not exist".
    const fh = await open(path, 'wx');
    try {
      await fh.writeFile(contents, 'utf8');
    } finally {
      await fh.close();
    }
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === 'EEXIST') return false;
    throw err;
  }
}

/**
 * Acquire a short-lived lock around the pending-queue read-modify-write cycle.
 *
 * Uses O_EXCL exclusive-create semantics so two concurrent callers can never
 * both acquire the lock; retries up to `maxAttempts` times with a small backoff
 * when the lock is already held. Each retry also attempts to reclaim a
 * stale lock whose mtime is older than QUEUE_STALE_AFTER_MS (10s) and whose
 * holder pid is gone. Returns `true` on success.
 */
export async function tryAcquireQueueLock(
  projectRoot: string,
  record: Omit<LockRecord, 'acquired_at'>,
  opts: { now?: () => Date; maxAttempts?: number; backoffMs?: number } = {},
): Promise<boolean> {
  const nowFn = opts.now ?? (() => new Date());
  const attempts = opts.maxAttempts ?? 20;
  const backoff = opts.backoffMs ?? 15;
  const path = queueLockPath(projectRoot);
  await mkdir(dirname(path), { recursive: true });
  for (let i = 0; i < attempts; i++) {
    const now = nowFn();
    const contents = JSON.stringify({ ...record, acquired_at: now.toISOString() }, null, 2);
    if (await tryCreateExclusive(path, contents)) return true;

    // Lock file exists. If it's stale (old mtime + dead pid), reclaim it by unlinking.
    const existing = await readLockAt(path);
    if (existing !== null) {
      const stale = await isLockStaleAt(path, existing, now, QUEUE_STALE_AFTER_MS);
      if (stale) {
        try { await unlink(path); } catch { /* lost the reclaim race; fine */ }
        continue; // retry immediately without backoff
      }
    }
    await new Promise((r) => setTimeout(r, backoff));
  }
  return false;
}

export async function releaseQueueLock(projectRoot: string): Promise<void> {
  try { await unlink(queueLockPath(projectRoot)); }
  catch (err) { if ((err as { code?: string }).code !== 'ENOENT') throw err; }
}
