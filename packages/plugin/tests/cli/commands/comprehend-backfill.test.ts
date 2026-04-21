import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import {
  runBackfillSubcommand,
  type BackfillDeps,
} from '../../../src/cli/commands/comprehend-backfill.js';
import { writeProjectConsent } from '../../../src/consent.js';
import { analysisLockPath, logFilePath } from '../../../src/plugin-paths.js';

function capture(): { stream: Writable; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      cb();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}

describe('comprehend backfill subcommand', () => {
  let tmp: string;
  const fixedNow = () => new Date('2026-04-20T12:00:00.000Z');

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-backfill-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const baseDeps = (): BackfillDeps => ({
    now: fixedNow,
    findHashImpl: async () => 'fake-hash',
    discoverSessionsImpl: async () => [],
    claudeProjectsDir: join(tmp, 'fake-claude-projects'),
  });

  it('not opted in → exit 3', async () => {
    const err = capture();
    const code = await runBackfillSubcommand(
      { projectRoot: tmp, showPreview: true },
      { ...baseDeps(), stdout: capture().stream, stderr: err.stream },
    );
    expect(code).toBe(3);
    expect(err.text()).toMatch(/not opted in/);
  });

  it('--show-preview emits JSON with expected shape', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });

    const sessions = [
      { sessionId: 's1', transcriptPath: '/tmp/s1.jsonl', sizeBytes: 1000, analyzedAt: '2026-04-19T10:00:00.000Z' },
      { sessionId: 's2', transcriptPath: '/tmp/s2.jsonl', sizeBytes: 2000, analyzedAt: '2026-04-19T11:00:00.000Z' },
    ];
    const discoverSessionsImpl = vi.fn(async () => sessions);

    const out = capture();
    const code = await runBackfillSubcommand(
      { projectRoot: tmp, showPreview: true },
      {
        ...baseDeps(),
        discoverSessionsImpl: discoverSessionsImpl as unknown as BackfillDeps['discoverSessionsImpl'],
        stdout: out.stream,
        stderr: capture().stream,
      },
    );
    expect(code).toBe(0);
    const json = JSON.parse(out.text().trim()) as Record<string, unknown>;
    expect(json).toMatchObject({
      count: 2,
      resolved_project_hash: 'fake-hash',
    });
    expect(typeof json['estimated_cost_usd_low']).toBe('number');
    expect(typeof json['estimated_cost_usd_high']).toBe('number');
  });

  it('--yes with 0 discovered sessions exits 0 with "No sessions" message', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const backfillImpl = vi.fn();

    const out = capture();
    const code = await runBackfillSubcommand(
      { projectRoot: tmp, yes: true },
      {
        ...baseDeps(),
        backfillImpl: backfillImpl as unknown as BackfillDeps['backfillImpl'],
        stdout: out.stream,
        stderr: capture().stream,
      },
    );
    expect(code).toBe(0);
    expect(backfillImpl).not.toHaveBeenCalled();
    expect(out.text()).toMatch(/No sessions to backfill/);
    await expect(stat(analysisLockPath(tmp))).rejects.toThrow();
  });

  it('--yes with 2 discovered sessions calls backfill and releases lock', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });

    const sessions = [
      { sessionId: 's1', transcriptPath: '/tmp/s1.jsonl', sizeBytes: 500, analyzedAt: '2026-04-19T10:00:00.000Z' },
      { sessionId: 's2', transcriptPath: '/tmp/s2.jsonl', sizeBytes: 700, analyzedAt: '2026-04-19T11:00:00.000Z' },
    ];
    const discoverSessionsImpl = vi.fn(async () => sessions);
    const backfillImpl = vi.fn(async () => ({
      discovered: 2,
      analyzed: 2,
      skipped: [],
      failed: [],
      total_cost_usd: 0.05,
    }));

    const out = capture();
    const code = await runBackfillSubcommand(
      { projectRoot: tmp, yes: true },
      {
        ...baseDeps(),
        discoverSessionsImpl: discoverSessionsImpl as unknown as BackfillDeps['discoverSessionsImpl'],
        backfillImpl: backfillImpl as unknown as BackfillDeps['backfillImpl'],
        stdout: out.stream,
        stderr: capture().stream,
      },
    );
    expect(code).toBe(0);
    expect(backfillImpl).toHaveBeenCalledTimes(1);
    expect(out.text()).toMatch(/analyzed=2/);
    // Lock released after the run.
    await expect(stat(analysisLockPath(tmp))).rejects.toThrow();
  });

  it('--yes emits a single backfill_batch log event with aggregate totals (not per-session)', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });

    const sessions = [
      { sessionId: 's1', transcriptPath: '/tmp/s1.jsonl', sizeBytes: 500, analyzedAt: '2026-04-19T10:00:00.000Z' },
      { sessionId: 's2', transcriptPath: '/tmp/s2.jsonl', sizeBytes: 700, analyzedAt: '2026-04-19T11:00:00.000Z' },
      { sessionId: 's3', transcriptPath: '/tmp/s3.jsonl', sizeBytes: 300, analyzedAt: '2026-04-19T12:00:00.000Z' },
    ];
    const discoverSessionsImpl = vi.fn(async () => sessions);
    const backfillImpl = vi.fn(async () => ({
      discovered: 3,
      analyzed: 2,
      skipped: [],
      failed: [{ session_id: 's3', reason: 'boom' }],
      total_cost_usd: 0.1234,
    }));

    const code = await runBackfillSubcommand(
      { projectRoot: tmp, yes: true },
      {
        ...baseDeps(),
        discoverSessionsImpl: discoverSessionsImpl as unknown as BackfillDeps['discoverSessionsImpl'],
        backfillImpl: backfillImpl as unknown as BackfillDeps['backfillImpl'],
        stdout: capture().stream,
        stderr: capture().stream,
      },
    );
    expect(code).toBe(0);

    // Per-session logs should NOT have been written.
    await expect(stat(logFilePath(tmp, 's1'))).rejects.toThrow();
    await expect(stat(logFilePath(tmp, 's2'))).rejects.toThrow();
    await expect(stat(logFilePath(tmp, 's3'))).rejects.toThrow();

    // One aggregate batch event should exist at _batch.log.
    const raw = await readFile(logFilePath(tmp, '_batch'), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: 'backfill_batch',
      session_id: '_batch',
      analyzed: 2,
      failed: 1,
      total_cost_usd: 0.1234,
    });
    expect(typeof lines[0].elapsed_ms).toBe('number');
  });

  it('no --show-preview and no --yes exits 2 (cost-estimate step missing)', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const err = capture();
    const code = await runBackfillSubcommand(
      { projectRoot: tmp },
      { ...baseDeps(), stdout: capture().stream, stderr: err.stream },
    );
    expect(code).toBe(2);
    expect(err.text()).toMatch(/Cost-estimate confirmation required/);
  });
});
