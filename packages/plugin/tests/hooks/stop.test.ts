import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, stat, readFile, utimes, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runStop } from '../../src/hooks/stop.js';
import { writeProjectConsent } from '../../src/consent.js';
import { tryAcquireLock } from '../../src/lock.js';
import {
  analysisLockPath,
  pendingQueuePath,
  logFilePath,
} from '../../src/plugin-paths.js';

describe('stop hook', () => {
  let tmp: string;
  const fixedNow = () => new Date('2026-04-20T12:00:00.000Z');

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-plugin-stop-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('no consent → returns 0, no lock created, no log written, no spawn', async () => {
    const spawnChild = vi.fn();
    const code = await runStop({
      projectRoot: tmp,
      sessionId: 'sess-1',
      transcriptPath: '/tmp/t.jsonl',
      now: fixedNow,
      spawnChild,
    });
    expect(code).toBe(0);
    expect(spawnChild).not.toHaveBeenCalled();
    await expect(stat(analysisLockPath(tmp))).rejects.toThrow();
    await expect(stat(logFilePath(tmp, 'sess-1'))).rejects.toThrow();
  });

  it('consent + free lock → lock acquired, spawned_at logged, spawnChild called once with right args', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });

    const spawnChild = vi.fn();
    const code = await runStop({
      projectRoot: tmp,
      sessionId: 'sess-2',
      transcriptPath: '/tmp/t2.jsonl',
      now: fixedNow,
      spawnChild,
    });

    expect(code).toBe(0);
    await expect(stat(analysisLockPath(tmp))).resolves.toBeDefined();

    const raw = await readFile(logFilePath(tmp, 'sess-2'), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: 'spawned_at',
      session_id: 'sess-2',
      transcript_path: '/tmp/t2.jsonl',
      timestamp: '2026-04-20T12:00:00.000Z',
    });

    expect(spawnChild).toHaveBeenCalledTimes(1);
    expect(spawnChild).toHaveBeenCalledWith({
      projectRoot: tmp,
      transcriptPath: '/tmp/t2.jsonl',
      sessionId: 'sess-2',
    });
  });

  it('consent + held lock → pending.json gets the new entry, no spawn, no log', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    // Seed an active lock held by this (alive) pid.
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'holder' }, { now: fixedNow });

    const spawnChild = vi.fn();
    const code = await runStop({
      projectRoot: tmp,
      sessionId: 'sess-queued',
      transcriptPath: '/tmp/queued.jsonl',
      now: fixedNow,
      spawnChild,
    });

    expect(code).toBe(0);
    expect(spawnChild).not.toHaveBeenCalled();
    await expect(stat(logFilePath(tmp, 'sess-queued'))).rejects.toThrow();

    const pendingRaw = await readFile(pendingQueuePath(tmp), 'utf8');
    const pending = JSON.parse(pendingRaw) as {
      queue: Array<{ session_id: string; transcript_path: string; queued_at: string }>;
    };
    expect(pending.queue).toHaveLength(1);
    expect(pending.queue[0]).toEqual({
      session_id: 'sess-queued',
      transcript_path: '/tmp/queued.jsonl',
      queued_at: '2026-04-20T12:00:00.000Z',
    });
  });

  it('consent + held lock (existing pending.json) → appends to existing queue', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'holder' }, { now: fixedNow });
    await mkdir(dirname(pendingQueuePath(tmp)), { recursive: true });
    await writeFile(
      pendingQueuePath(tmp),
      JSON.stringify({
        queue: [{ session_id: 'pre-existing', transcript_path: '/tmp/pre.jsonl', queued_at: '2026-04-20T11:00:00.000Z' }],
      }),
      'utf8',
    );

    await runStop({
      projectRoot: tmp,
      sessionId: 'sess-new',
      transcriptPath: '/tmp/new.jsonl',
      now: fixedNow,
      spawnChild: vi.fn(),
    });

    const pending = JSON.parse(await readFile(pendingQueuePath(tmp), 'utf8')) as {
      queue: Array<{ session_id: string }>;
    };
    expect(pending.queue.map((e) => e.session_id)).toEqual(['pre-existing', 'sess-new']);
  });

  it('consent + held lock + two concurrent runStop calls → both session ids land in pending.json', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    // Hold the analysis lock so both runStop calls take the queue path.
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'holder' }, { now: fixedNow });

    const spawnChild = vi.fn();
    // Fire both in parallel — the queue-lock must serialize the read-modify-write
    // so neither entry is lost.
    const [c1, c2] = await Promise.all([
      runStop({
        projectRoot: tmp,
        sessionId: 'race-a',
        transcriptPath: '/tmp/race-a.jsonl',
        now: fixedNow,
        spawnChild,
      }),
      runStop({
        projectRoot: tmp,
        sessionId: 'race-b',
        transcriptPath: '/tmp/race-b.jsonl',
        now: fixedNow,
        spawnChild,
      }),
    ]);

    expect(c1).toBe(0);
    expect(c2).toBe(0);
    expect(spawnChild).not.toHaveBeenCalled();

    const pending = JSON.parse(await readFile(pendingQueuePath(tmp), 'utf8')) as {
      queue: Array<{ session_id: string }>;
    };
    const ids = pending.queue.map((e) => e.session_id).sort();
    expect(ids).toEqual(['race-a', 'race-b']);
  });

  it('consent + stale lock (age > 30min, pid dead) → reclaimed, spawn proceeds', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    // Seed a lock whose pid is not running.
    await tryAcquireLock(tmp, { pid: 99999999, session_id: 'zombie' });
    // Backdate mtime to 40 minutes ago.
    const forty = new Date(Date.now() - 40 * 60 * 1000);
    await utimes(analysisLockPath(tmp), forty, forty);

    const spawnChild = vi.fn();
    const code = await runStop({
      projectRoot: tmp,
      sessionId: 'sess-fresh',
      transcriptPath: '/tmp/fresh.jsonl',
      spawnChild,
    });

    expect(code).toBe(0);
    expect(spawnChild).toHaveBeenCalledTimes(1);
    expect(spawnChild).toHaveBeenCalledWith({
      projectRoot: tmp,
      transcriptPath: '/tmp/fresh.jsonl',
      sessionId: 'sess-fresh',
    });

    // Lock reclaimed under the new session.
    const lockRaw = await readFile(analysisLockPath(tmp), 'utf8');
    expect(JSON.parse(lockRaw).session_id).toBe('sess-fresh');

    // No pending queue written.
    await expect(stat(pendingQueuePath(tmp))).rejects.toThrow();

    // spawned_at was logged.
    const raw = await readFile(logFilePath(tmp, 'sess-fresh'), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ kind: 'spawned_at', session_id: 'sess-fresh' });
  });
});
