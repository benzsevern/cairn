import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { runStatusSubcommand } from '../../../src/cli/commands/comprehend-status.js';
import { writeProjectConsent } from '../../../src/consent.js';
import { appendLogEvent } from '../../../src/log.js';
import { ackedAtPath } from '../../../src/plugin-paths.js';

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

describe('comprehend status subcommand', () => {
  let tmp: string;
  const fixedNow = () => new Date('2026-04-20T12:00:00.000Z');

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-status-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('not opted in → exit 3', async () => {
    const err = capture();
    const code = await runStatusSubcommand(
      { projectRoot: tmp },
      { stdout: capture().stream, stderr: err.stream, now: fixedNow },
    );
    expect(code).toBe(3);
    expect(err.text()).toMatch(/not opted in/);
  });

  it('opted in, empty project → human output with zero counts', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const out = capture();
    const code = await runStatusSubcommand(
      { projectRoot: tmp },
      { stdout: out.stream, stderr: capture().stream, now: fixedNow },
    );
    expect(code).toBe(0);
    const text = out.text();
    expect(text).toMatch(/analyzed=0 failed=0 queued=0 running=no/);
    expect(text).toMatch(/recent runs \(0\)/);
  });

  it('--json shape includes counts, recent_runs, lock, ack_applied', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    await appendLogEvent(tmp, 'sess-a', {
      kind: 'worker_success',
      session_id: 'sess-a',
      timestamp: '2026-04-20T11:00:00.000Z',
      concept_count: 5,
      unknown_count: 2,
      elapsed_ms: 1000,
    });
    await appendLogEvent(tmp, 'sess-b', {
      kind: 'worker_failure',
      session_id: 'sess-b',
      timestamp: '2026-04-20T11:30:00.000Z',
      error_name: 'RefinerFailure',
      message: 'boom',
      elapsed_ms: 500,
    });

    const out = capture();
    const code = await runStatusSubcommand(
      { projectRoot: tmp, json: true },
      { stdout: out.stream, stderr: capture().stream, now: fixedNow },
    );
    expect(code).toBe(0);
    const json = JSON.parse(out.text().trim()) as {
      counts: Record<string, number | boolean>;
      recent_runs: Array<{ session_id: string; outcome: string }>;
      ack_applied: boolean;
    };
    expect(json.recent_runs).toHaveLength(2);
    expect(json.recent_runs[0]?.session_id).toBe('sess-b'); // most recent
    expect(json.recent_runs[0]?.outcome).toBe('failure');
    expect(json.ack_applied).toBe(false);
  });

  it('--ack touches acked_at and reports ack_applied in JSON', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const out = capture();
    const code = await runStatusSubcommand(
      { projectRoot: tmp, ack: true, json: true },
      { stdout: out.stream, stderr: capture().stream, now: fixedNow },
    );
    expect(code).toBe(0);
    await expect(stat(ackedAtPath(tmp))).resolves.toBeDefined();
    const json = JSON.parse(out.text().trim()) as { ack_applied: boolean };
    expect(json.ack_applied).toBe(true);
  });
});
