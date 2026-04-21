import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, utimes, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tryAcquireLock, releaseLock, readLock } from '../../src/lock.js';
import { analysisLockPath } from '../../src/plugin-paths.js';

describe('lock', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'fos-plugin-lock-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('tryAcquireLock returns true and writes the lock file when no lock exists', async () => {
    const ok = await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-1' });
    expect(ok).toBe(true);
    const raw = await readFile(analysisLockPath(tmp), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.pid).toBe(process.pid);
    expect(parsed.session_id).toBe('sess-1');
    expect(typeof parsed.acquired_at).toBe('string');
  });

  it('second tryAcquireLock on the same project returns false when holder pid is alive', async () => {
    const first = await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-1' });
    expect(first).toBe(true);
    const second = await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-2' });
    expect(second).toBe(false);
  });

  it('releaseLock removes the file', async () => {
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-1' });
    await releaseLock(tmp);
    await expect(stat(analysisLockPath(tmp))).rejects.toThrow();
  });

  it('after release, the next tryAcquireLock succeeds', async () => {
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-1' });
    await releaseLock(tmp);
    const ok = await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-2' });
    expect(ok).toBe(true);
  });

  it('reclaims a lock older than 30 min whose pid is not running', async () => {
    // Acquire with an unlikely-to-exist pid.
    await tryAcquireLock(tmp, { pid: 99999999, session_id: 'zombie' });
    // Backdate mtime to 40 minutes ago.
    const forty = new Date(Date.now() - 40 * 60 * 1000);
    await utimes(analysisLockPath(tmp), forty, forty);
    const ok = await tryAcquireLock(tmp, { pid: process.pid, session_id: 'fresh' });
    expect(ok).toBe(true);
    const rec = await readLock(tmp);
    expect(rec?.session_id).toBe('fresh');
  });

  it('does NOT reclaim a lock older than 30 min whose pid IS running', async () => {
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'live' });
    const forty = new Date(Date.now() - 40 * 60 * 1000);
    await utimes(analysisLockPath(tmp), forty, forty);
    const ok = await tryAcquireLock(tmp, { pid: process.pid, session_id: 'other' });
    expect(ok).toBe(false);
    const rec = await readLock(tmp);
    expect(rec?.session_id).toBe('live');
  });

  it('readLock returns the structured contents or null', async () => {
    expect(await readLock(tmp)).toBeNull();
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-1' });
    const rec = await readLock(tmp);
    expect(rec).not.toBeNull();
    expect(rec?.pid).toBe(process.pid);
    expect(rec?.session_id).toBe('sess-1');
    expect(typeof rec?.acquired_at).toBe('string');
  });
});
