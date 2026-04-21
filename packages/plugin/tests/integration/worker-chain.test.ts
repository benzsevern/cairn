import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runWorker } from '../../src/worker/analyze-worker.js';
import { tryAcquireLock } from '../../src/lock.js';
import {
  analysisLockPath,
  pendingQueuePath,
  logFilePath,
} from '../../src/plugin-paths.js';
import type { SessionArtifact } from '@fos/core';

function makeArtifact(overrides: Partial<SessionArtifact> = {}): SessionArtifact {
  return {
    session_id: 'sess-1',
    transcript_path: '/tmp/transcript.jsonl',
    analyzed_at: '2026-04-20T12:00:00.000Z',
    refiner_version: 'test',
    refiner_prompt_hash: 'hash',
    model: 'test-model',
    segment_count: 1,
    concept_count: 3,
    unknown_count: 2,
    concepts: [],
    unknowns: [],
    ...overrides,
  };
}

async function readLogLines(projectRoot: string, sessionId: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(logFilePath(projectRoot, sessionId), 'utf8');
  return raw.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
}

async function writePendingFile(
  projectRoot: string,
  queue: Array<{ session_id: string; transcript_path: string; queued_at: string }>,
): Promise<void> {
  await mkdir(dirname(pendingQueuePath(projectRoot)), { recursive: true });
  await writeFile(pendingQueuePath(projectRoot), JSON.stringify({ queue }, null, 2), 'utf8');
}

describe('worker-chain integration', () => {
  let tmp: string;
  const fixedNow = () => new Date('2026-04-20T12:00:00.000Z');

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-plugin-worker-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('happy path: runs analyze + rebuild, logs worker_started + worker_success with counts, releases lock', async () => {
    // Seed the lock as the stop hook would.
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-1' }, { now: fixedNow });

    const analyzeSessionImpl = vi.fn().mockResolvedValue(makeArtifact({ concept_count: 7, unknown_count: 4 }));
    const rebuildImpl = vi.fn().mockResolvedValue(undefined);
    const spawnChild = vi.fn();

    await runWorker({
      projectRoot: tmp,
      transcriptPath: '/tmp/transcript.jsonl',
      sessionId: 'sess-1',
      now: fixedNow,
      analyzeSessionImpl,
      rebuildImpl,
      spawnChild,
    });

    expect(analyzeSessionImpl).toHaveBeenCalledOnce();
    expect(rebuildImpl).toHaveBeenCalledOnce();
    expect(analyzeSessionImpl.mock.calls[0]![0]).toMatchObject({
      projectRoot: tmp,
      transcriptPath: '/tmp/transcript.jsonl',
      sessionId: 'sess-1',
    });

    const events = await readLogLines(tmp, 'sess-1');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'worker_started', session_id: 'sess-1' });
    expect(events[1]).toMatchObject({
      kind: 'worker_success',
      session_id: 'sess-1',
      concept_count: 7,
      unknown_count: 4,
    });

    // Lock released.
    await expect(stat(analysisLockPath(tmp))).rejects.toThrow();

    // No pending queue → no spawn.
    expect(spawnChild).not.toHaveBeenCalled();
  });

  it('failure path: analyze throws → worker_failure logged, lock still released', async () => {
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-2' }, { now: fixedNow });

    const analyzeSessionImpl = vi.fn().mockRejectedValue(
      Object.assign(new Error('boom'), { name: 'RefinerFailure' }),
    );
    const rebuildImpl = vi.fn().mockResolvedValue(undefined);
    const spawnChild = vi.fn();

    await runWorker({
      projectRoot: tmp,
      transcriptPath: '/tmp/t.jsonl',
      sessionId: 'sess-2',
      now: fixedNow,
      analyzeSessionImpl,
      rebuildImpl,
      spawnChild,
    });

    expect(analyzeSessionImpl).toHaveBeenCalledOnce();
    expect(rebuildImpl).not.toHaveBeenCalled();

    const events = await readLogLines(tmp, 'sess-2');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'worker_started' });
    expect(events[1]).toMatchObject({
      kind: 'worker_failure',
      session_id: 'sess-2',
      error_name: 'RefinerFailure',
      message: 'boom',
    });

    await expect(stat(analysisLockPath(tmp))).rejects.toThrow();
    expect(spawnChild).not.toHaveBeenCalled();
  });

  it('pending drain: after success, spawns next session from pending.json and removes it from the queue', async () => {
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-current' }, { now: fixedNow });

    await writePendingFile(tmp, [
      { session_id: 'sess-next', transcript_path: '/tmp/next.jsonl', queued_at: '2026-04-20T11:59:00.000Z' },
      { session_id: 'sess-later', transcript_path: '/tmp/later.jsonl', queued_at: '2026-04-20T11:59:30.000Z' },
    ]);

    const analyzeSessionImpl = vi.fn().mockResolvedValue(makeArtifact());
    const rebuildImpl = vi.fn().mockResolvedValue(undefined);
    const spawnChild = vi.fn();

    await runWorker({
      projectRoot: tmp,
      transcriptPath: '/tmp/current.jsonl',
      sessionId: 'sess-current',
      now: fixedNow,
      analyzeSessionImpl,
      rebuildImpl,
      spawnChild,
    });

    expect(spawnChild).toHaveBeenCalledOnce();
    expect(spawnChild).toHaveBeenCalledWith({
      projectRoot: tmp,
      transcriptPath: '/tmp/next.jsonl',
      sessionId: 'sess-next',
    });

    const pendingRaw = await readFile(pendingQueuePath(tmp), 'utf8');
    const pending = JSON.parse(pendingRaw) as { queue: Array<{ session_id: string }> };
    expect(pending.queue).toHaveLength(1);
    expect(pending.queue[0]!.session_id).toBe('sess-later');
  });

  it('empty queue: no spawn when pending.json is absent', async () => {
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-solo' }, { now: fixedNow });

    const spawnChild = vi.fn();
    await runWorker({
      projectRoot: tmp,
      transcriptPath: '/tmp/solo.jsonl',
      sessionId: 'sess-solo',
      now: fixedNow,
      analyzeSessionImpl: vi.fn().mockResolvedValue(makeArtifact()),
      rebuildImpl: vi.fn().mockResolvedValue(undefined),
      spawnChild,
    });

    expect(spawnChild).not.toHaveBeenCalled();
  });

  it('empty queue: no spawn when pending.json has empty queue', async () => {
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'sess-empty' }, { now: fixedNow });
    await writePendingFile(tmp, []);

    const spawnChild = vi.fn();
    await runWorker({
      projectRoot: tmp,
      transcriptPath: '/tmp/e.jsonl',
      sessionId: 'sess-empty',
      now: fixedNow,
      analyzeSessionImpl: vi.fn().mockResolvedValue(makeArtifact()),
      rebuildImpl: vi.fn().mockResolvedValue(undefined),
      spawnChild,
    });

    expect(spawnChild).not.toHaveBeenCalled();
  });
});
