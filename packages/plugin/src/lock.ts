import { mkdir, writeFile, readFile, unlink, stat, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { analysisLockPath } from './plugin-paths.js';

export interface LockRecord {
  pid: number;
  acquired_at: string;
  session_id: string;
}

const STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes

function pidExists(pid: number): boolean {
  try {
    // kill(pid, 0) is the cross-platform "does this pid exist" probe.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === 'EPERM';
  }
}

export async function readLock(projectRoot: string): Promise<LockRecord | null> {
  try {
    const raw = await readFile(analysisLockPath(projectRoot), 'utf8');
    return JSON.parse(raw) as LockRecord;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return null;
    throw err;
  }
}

async function isLockStale(projectRoot: string, existing: LockRecord, now: Date): Promise<boolean> {
  try {
    const st = await stat(analysisLockPath(projectRoot));
    const age = now.getTime() - st.mtime.getTime();
    if (age < STALE_AFTER_MS) return false;
  } catch {
    return false;
  }
  return !pidExists(existing.pid);
}

export async function tryAcquireLock(
  projectRoot: string,
  record: Omit<LockRecord, 'acquired_at'>,
  opts: { now?: () => Date } = {},
): Promise<boolean> {
  const now = (opts.now ?? (() => new Date()))();
  const existing = await readLock(projectRoot);
  if (existing !== null && !(await isLockStale(projectRoot, existing, now))) return false;

  await mkdir(dirname(analysisLockPath(projectRoot)), { recursive: true });
  const full: LockRecord = { ...record, acquired_at: now.toISOString() };
  const tmp = `${analysisLockPath(projectRoot)}.tmp`;
  await writeFile(tmp, JSON.stringify(full, null, 2), 'utf8');
  await rename(tmp, analysisLockPath(projectRoot));
  return true;
}

export async function releaseLock(projectRoot: string): Promise<void> {
  try { await unlink(analysisLockPath(projectRoot)); }
  catch (err) { if ((err as { code?: string }).code !== 'ENOENT') throw err; }
}
