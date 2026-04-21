import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendLogEvent,
  readLogEvents,
  latestEvent,
  latestFailureTimestamp,
  type LogEvent,
} from '../../src/log.js';

describe('log', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'fos-plugin-log-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('readLogEvents returns [] when no log for the session', async () => {
    expect(await readLogEvents(tmp, 'sess-none')).toEqual([]);
  });

  it('appendLogEvent creates the logs dir + file and reads back round-trip', async () => {
    const ev: LogEvent = { kind: 'spawned_at', session_id: 'sess-1', timestamp: '2026-04-21T10:00:00Z' };
    await appendLogEvent(tmp, 'sess-1', ev);
    const events = await readLogEvents(tmp, 'sess-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(ev);
  });

  it('appendLogEvent preserves order', async () => {
    await appendLogEvent(tmp, 'sess-2', { kind: 'spawned_at', session_id: 'sess-2', timestamp: 't1' });
    await appendLogEvent(tmp, 'sess-2', { kind: 'worker_started', session_id: 'sess-2', timestamp: 't2' });
    await appendLogEvent(tmp, 'sess-2', { kind: 'worker_success', session_id: 'sess-2', timestamp: 't3', concept_count: 1, unknown_count: 0, elapsed_ms: 30 });
    const events = await readLogEvents(tmp, 'sess-2');
    expect(events.map((e) => e.kind)).toEqual(['spawned_at', 'worker_started', 'worker_success']);
  });

  it('latestEvent returns the most recent event', async () => {
    await appendLogEvent(tmp, 'sess-3', { kind: 'spawned_at', session_id: 'sess-3', timestamp: 't1' });
    await appendLogEvent(tmp, 'sess-3', { kind: 'worker_started', session_id: 'sess-3', timestamp: 't2' });
    const latest = await latestEvent(tmp, 'sess-3');
    expect(latest?.kind).toBe('worker_started');
  });

  it('latestFailureTimestamp scans all logs dirs and returns the most recent worker_failure timestamp', async () => {
    await appendLogEvent(tmp, 'sess-a', { kind: 'worker_success', session_id: 'sess-a', timestamp: '2026-04-20T10:00:00Z', concept_count: 0, unknown_count: 0, elapsed_ms: 1 });
    await appendLogEvent(tmp, 'sess-b', { kind: 'worker_failure', session_id: 'sess-b', timestamp: '2026-04-21T11:00:00Z', error_name: 'RefinerFailure', message: 'x', elapsed_ms: 1 });
    await appendLogEvent(tmp, 'sess-c', { kind: 'worker_failure', session_id: 'sess-c', timestamp: '2026-04-21T12:00:00Z', error_name: 'RefinerFailure', message: 'y', elapsed_ms: 1 });
    const ts = await latestFailureTimestamp(tmp);
    expect(ts).toBe('2026-04-21T12:00:00Z');
  });

  it('latestFailureTimestamp returns null when no failures', async () => {
    expect(await latestFailureTimestamp(tmp)).toBeNull();
  });

  it('appendLogEvent round-trips backfill_batch events', async () => {
    const ev: LogEvent = {
      kind: 'backfill_batch',
      session_id: '_batch',
      timestamp: '2026-04-22T09:00:00Z',
      analyzed: 4,
      failed: 1,
      total_cost_usd: 0.1234,
      elapsed_ms: 12000,
    };
    await appendLogEvent(tmp, '_batch', ev);
    const events = await readLogEvents(tmp, '_batch');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(ev);
  });

  it('latestFailureTimestamp ignores backfill_batch events', async () => {
    await appendLogEvent(tmp, '_batch', {
      kind: 'backfill_batch',
      session_id: '_batch',
      timestamp: '2099-01-01T00:00:00Z',
      analyzed: 0,
      failed: 99,
      total_cost_usd: 0,
      elapsed_ms: 0,
    });
    await appendLogEvent(tmp, 'sess-x', {
      kind: 'worker_failure',
      session_id: 'sess-x',
      timestamp: '2026-04-20T10:00:00Z',
      error_name: 'E',
      message: 'm',
      elapsed_ms: 1,
    });
    const ts = await latestFailureTimestamp(tmp);
    expect(ts).toBe('2026-04-20T10:00:00Z');
  });
});
