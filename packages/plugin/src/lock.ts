import { mkdir, readFile, unlink, stat, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { analysisLockPath, queueLockPath } from './plugin-paths.js';

export interface LockRecord {
  pid: number;
  acquired_at: string;
  session_id: string;
}

const ANALYSIS_STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes
const QUEUE_STALE_AFTER_MS = 10 * 1000; // 10 seconds — queue mutations are short-lived

export interface ExclusiveLockArgs {
  lockPath: string;
  content: string;
  staleAfterMs: number;
  now: () => Date;
  /**
   * If a number: age-stale reclaim also requires this pid to be dead (kill(pid,0) probe).
   * If null/undefined: age alone triggers reclaim (no liveness check).
   */
  pidForStalenessCheck?: number | null;
  maxAttempts?: number;
  backoffMs?: number;
}

function pidExists(pid: number): boolean {
  try {
    // kill(pid, 0) is the cross-platform "does this pid exist" probe.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === 'EPERM';
  }
}

async function tryExclusiveCreate(lockPath: string, content: string): Promise<boolean> {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    // `wx` = O_CREAT | O_EXCL: atomic "create only if it does not exist".
    const handle = await open(lockPath, 'wx');
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === 'EEXIST') return false;
    throw err;
  }
}

async function isStale(args: {
  lockPath: string;
  staleAfterMs: number;
  now: () => Date;
  pidForStalenessCheck: number | null | undefined;
}): Promise<boolean> {
  try {
    const st = await stat(args.lockPath);
    const age = args.now().getTime() - st.mtime.getTime();
    if (age < args.staleAfterMs) return false;
    // age-stale; if caller wants pid liveness, also require dead pid
    if (args.pidForStalenessCheck === null || args.pidForStalenessCheck === undefined) return true;
    return !pidExists(args.pidForStalenessCheck);
  } catch {
    return false;
  }
}

/**
 * Atomic exclusive-create lock with optional stale reclaim. Single primitive
 * shared by both `tryAcquireLock` (analysis.lock) and `tryAcquireQueueLock`
 * (queue.lock). Uses O_EXCL (`open(path, 'wx')`) so concurrent callers can
 * never both acquire.
 */
export async function acquireExclusiveLock(args: ExclusiveLockArgs): Promise<boolean> {
  const maxAttempts = args.maxAttempts ?? 20;
  const backoffMs = args.backoffMs ?? 15;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (await tryExclusiveCreate(args.lockPath, args.content)) return true;

    // File exists — check staleness.
    if (await isStale({
      lockPath: args.lockPath,
      staleAfterMs: args.staleAfterMs,
      now: args.now,
      pidForStalenessCheck: args.pidForStalenessCheck,
    })) {
      try { await unlink(args.lockPath); } catch { /* lost the reclaim race; fine */ }
      if (await tryExclusiveCreate(args.lockPath, args.content)) return true;
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  return false;
}

export async function releaseExclusiveLock(lockPath: string): Promise<void> {
  try { await unlink(lockPath); }
  catch (err) { if ((err as { code?: string }).code !== 'ENOENT') throw err; }
}

// -------- consumer wrappers --------

export async function readLock(projectRoot: string): Promise<LockRecord | null> {
  try {
    const raw = await readFile(analysisLockPath(projectRoot), 'utf8');
    return JSON.parse(raw) as LockRecord;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return null;
    throw err;
  }
}

export async function tryAcquireLock(
  projectRoot: string,
  record: Omit<LockRecord, 'acquired_at'>,
  opts: { now?: () => Date } = {},
): Promise<boolean> {
  const now = opts.now ?? (() => new Date());
  const existing = await readLock(projectRoot);
  return acquireExclusiveLock({
    lockPath: analysisLockPath(projectRoot),
    content: JSON.stringify({ ...record, acquired_at: now().toISOString() }, null, 2),
    staleAfterMs: ANALYSIS_STALE_AFTER_MS,
    now,
    pidForStalenessCheck: existing?.pid ?? null,
    // Analysis lock has no retry loop — single attempt preserves prior behaviour.
    maxAttempts: 1,
  });
}

export async function releaseLock(projectRoot: string): Promise<void> {
  await releaseExclusiveLock(analysisLockPath(projectRoot));
}

/**
 * Acquire a short-lived lock around the pending-queue read-modify-write cycle.
 * Retries up to `maxAttempts` with a small backoff; reclaims a stale lock
 * whose mtime is older than QUEUE_STALE_AFTER_MS (10s).
 */
export async function tryAcquireQueueLock(
  projectRoot: string,
  record: Omit<LockRecord, 'acquired_at'>,
  opts: { now?: () => Date; maxAttempts?: number; backoffMs?: number } = {},
): Promise<boolean> {
  const now = opts.now ?? (() => new Date());
  return acquireExclusiveLock({
    lockPath: queueLockPath(projectRoot),
    content: JSON.stringify({ ...record, acquired_at: now().toISOString() }, null, 2),
    staleAfterMs: QUEUE_STALE_AFTER_MS,
    now,
    pidForStalenessCheck: null, // queue lock is time-based reclaim only
    ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
    ...(opts.backoffMs !== undefined ? { backoffMs: opts.backoffMs } : {}),
  });
}

export async function releaseQueueLock(projectRoot: string): Promise<void> {
  await releaseExclusiveLock(queueLockPath(projectRoot));
}
