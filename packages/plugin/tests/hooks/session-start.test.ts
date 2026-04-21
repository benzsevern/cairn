import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, utimes, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import {
  pickSessionStartMessage,
  runSessionStart,
} from '../../src/hooks/session-start.js';
import { writeProjectConsent } from '../../src/consent.js';
import { tryAcquireLock } from '../../src/lock.js';
import { appendLogEvent } from '../../src/log.js';
import {
  sessionsDir,
  ackedAtPath,
  pendingQueuePath,
  logFilePath,
  fosDir,
} from '../../src/plugin-paths.js';

function captureStdout(): { stream: Writable; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      cb();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}

describe('session-start hook', () => {
  let tmp: string;
  const fixedNow = () => new Date('2026-04-20T12:00:00.000Z');

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-plugin-sessionstart-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('no consent → silent (returns null)', async () => {
    const msg = await pickSessionStartMessage({ projectRoot: tmp, now: fixedNow });
    expect(msg).toBeNull();
  });

  it('priority 1: failure_seen — failure timestamp newer than acked_at mtime', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    // Write an acked_at file, then backdate its mtime to before the failure.
    await mkdir(fosDir(tmp), { recursive: true });
    await writeFile(ackedAtPath(tmp), '', 'utf8');
    const old = new Date('2026-04-20T10:00:00.000Z');
    await utimes(ackedAtPath(tmp), old, old);

    await appendLogEvent(tmp, 'sess-fail', {
      kind: 'worker_failure',
      session_id: 'sess-fail',
      timestamp: '2026-04-20T11:30:00.000Z',
      error_name: 'Boom',
      message: 'nope',
      elapsed_ms: 42,
    });

    const msg = await pickSessionStartMessage({ projectRoot: tmp, now: fixedNow });
    expect(msg).toBe('⚠ Last FOS analysis failed — run /comprehend status to see why.');
  });

  it('priority 1 suppressed: acked_at newer than failure → falls through (first_session here)', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    await appendLogEvent(tmp, 'sess-fail', {
      kind: 'worker_failure',
      session_id: 'sess-fail',
      timestamp: '2026-04-20T10:00:00.000Z',
      error_name: 'Boom',
      message: 'nope',
      elapsed_ms: 42,
    });
    // acked_at mtime = 11:00, i.e. newer than the failure at 10:00.
    await mkdir(fosDir(tmp), { recursive: true });
    await writeFile(ackedAtPath(tmp), '', 'utf8');
    const newer = new Date('2026-04-20T11:00:00.000Z');
    await utimes(ackedAtPath(tmp), newer, newer);

    const msg = await pickSessionStartMessage({ projectRoot: tmp, now: fixedNow });
    expect(msg).toBe(
      'FOS: opted in but no sessions analyzed yet — your first session will be analyzed on Stop.',
    );
  });

  it('priority 2: stalled_detach — spawned_at > 5min old with no worker_started', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    // spawned_at 10 minutes before fixedNow
    await appendLogEvent(tmp, 'sess-stalled', {
      kind: 'spawned_at',
      session_id: 'sess-stalled',
      timestamp: '2026-04-20T11:50:00.000Z',
      transcript_path: '/tmp/x.jsonl',
    });

    const msg = await pickSessionStartMessage({ projectRoot: tmp, now: fixedNow });
    expect(msg).toBe('⚠ FOS worker appears stalled — run /comprehend status.');
  });

  it('priority 3: pending > 0 — pending.json queue length', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    await mkdir(fosDir(tmp), { recursive: true });
    await writeFile(
      pendingQueuePath(tmp),
      JSON.stringify({
        queue: [
          { session_id: 'a', transcript_path: '/tmp/a', queued_at: '2026-04-20T11:00:00.000Z' },
          { session_id: 'b', transcript_path: '/tmp/b', queued_at: '2026-04-20T11:30:00.000Z' },
        ],
      }),
      'utf8',
    );

    const msg = await pickSessionStartMessage({ projectRoot: tmp, now: fixedNow });
    expect(msg).toBe('FOS: 2 session(s) queued, analysis running in background.');
  });

  it('priority 4: first_session — consent exists but no session files yet', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });

    const msg = await pickSessionStartMessage({ projectRoot: tmp, now: fixedNow });
    expect(msg).toBe(
      'FOS: opted in but no sessions analyzed yet — your first session will be analyzed on Stop.',
    );
  });

  it('priority 5: running — lock exists and nothing higher-priority fires', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    // Create a session file so first_session doesn't fire.
    await mkdir(sessionsDir(tmp), { recursive: true });
    await writeFile(join(sessionsDir(tmp), '2026-04-20-prev.md'), '# prev\n', 'utf8');

    // Acquire a lock 30 seconds ago.
    const thirtySecondsAgo = () => new Date('2026-04-20T11:59:30.000Z');
    await tryAcquireLock(
      tmp,
      { pid: process.pid, session_id: 'holder' },
      { now: thirtySecondsAgo },
    );

    const msg = await pickSessionStartMessage({ projectRoot: tmp, now: fixedNow });
    expect(msg).toBe('FOS: background analysis running for 30s.');
  });

  it('priority 6: silent — consent + prior session, no lock, no failures, no pending', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    await mkdir(sessionsDir(tmp), { recursive: true });
    await writeFile(join(sessionsDir(tmp), '2026-04-19-prev.md'), '# prev\n', 'utf8');
    // Also bump acked_at so any accidental failure would be suppressed.
    await mkdir(fosDir(tmp), { recursive: true });
    await writeFile(ackedAtPath(tmp), '', 'utf8');

    const msg = await pickSessionStartMessage({ projectRoot: tmp, now: fixedNow });
    expect(msg).toBeNull();
  });

  it('runSessionStart writes the Claude-Code JSON envelope to stdout for a non-null pick', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    // Triggers first_session (priority 4).
    const { stream, text } = captureStdout();

    const code = await runSessionStart({
      projectRoot: tmp,
      now: fixedNow,
      stdout: stream,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(text().trim()) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toBe(
      'FOS: opted in but no sessions analyzed yet — your first session will be analyzed on Stop.',
    );
  });

  it('runSessionStart emits a benign {continue,suppressOutput} envelope when pick is null (no consent)', async () => {
    // Claude Code treats empty-stdout-with-exit-0 as a hook failure; the
    // silent path must still emit a valid JSON envelope to count as success.
    const { stream, text } = captureStdout();
    const code = await runSessionStart({
      projectRoot: tmp,
      now: fixedNow,
      stdout: stream,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(text().trim()) as { continue: boolean; suppressOutput: boolean };
    expect(parsed.continue).toBe(true);
    expect(parsed.suppressOutput).toBe(true);
  });

  // Silence unused-import warnings in strict test configs.
  void logFilePath;
  void appendFile;
});
