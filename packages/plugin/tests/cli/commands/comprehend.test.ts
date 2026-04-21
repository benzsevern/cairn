import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Writable } from 'node:stream';
import { runAnalyzeSubcommand, type AnalyzeDeps } from '../../../src/cli/commands/comprehend.js';
import { writeProjectConsent } from '../../../src/consent.js';
import { tryAcquireLock } from '../../../src/lock.js';
import {
  sessionsDir,
  logFilePath,
  analysisLockPath,
} from '../../../src/plugin-paths.js';

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

describe('comprehend analyze subcommand', () => {
  let tmp: string;
  const fixedNow = () => new Date('2026-04-20T12:00:00.000Z');

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-analyze-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('not opted in → exit 3', async () => {
    const err = capture();
    const code = await runAnalyzeSubcommand(
      { projectRoot: tmp, sessionId: 'sess-1', transcriptPath: join(tmp, 't.jsonl') },
      { stdout: capture().stream, stderr: err.stream },
    );
    expect(code).toBe(3);
    expect(err.text()).toMatch(/not opted in/);
  });

  it('lock held → exit 4 with guidance', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    await tryAcquireLock(tmp, { pid: process.pid, session_id: 'holder' }, { now: fixedNow });

    const err = capture();
    const code = await runAnalyzeSubcommand(
      { projectRoot: tmp, sessionId: 'sess-new', transcriptPath: join(tmp, 't.jsonl') },
      { stdout: capture().stream, stderr: err.stream, now: fixedNow },
    );
    expect(code).toBe(4);
    expect(err.text()).toMatch(/already running|Analysis already running/);
  });

  it('--dry-run emits JSON with cost + existing-state fields', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const transcript = join(tmp, 't.jsonl');
    await writeFile(transcript, 'x'.repeat(700), 'utf8');

    const out = capture();
    const code = await runAnalyzeSubcommand(
      {
        projectRoot: tmp,
        sessionId: 'sess-dry',
        transcriptPath: transcript,
        dryRun: true,
      },
      { stdout: out.stream, stderr: capture().stream, now: fixedNow },
    );
    expect(code).toBe(0);
    const json = JSON.parse(out.text().trim()) as Record<string, unknown>;
    expect(json).toMatchObject({
      session_id: 'sess-dry',
      transcript_path: transcript,
      size_bytes: 700,
    });
    expect(typeof json['estimated_cost_usd_low']).toBe('number');
    expect(json['existing_session_file']).toBeNull();
  });

  it('happy path calls analyzeSession + rebuild, logs success, releases lock', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const transcript = join(tmp, 't.jsonl');
    await writeFile(transcript, '{}\n', 'utf8');

    const analyzeSessionImpl = vi.fn(async () => ({
      session_id: 'sess-ok',
      transcript_path: transcript,
      analyzed_at: fixedNow().toISOString(),
      refiner_version: 'v1.0.0',
      refiner_prompt_hash: 'abc',
      model: 'claude-sonnet-4-6',
      segment_count: 1,
      concept_count: 3,
      unknown_count: 1,
      concepts: [],
      unknowns: [],
    }));
    const rebuildImpl = vi.fn(async () => {});

    const out = capture();
    const code = await runAnalyzeSubcommand(
      { projectRoot: tmp, sessionId: 'sess-ok', transcriptPath: transcript },
      {
        analyzeSessionImpl: analyzeSessionImpl as unknown as AnalyzeDeps['analyzeSessionImpl'],
        rebuildImpl,
        stdout: out.stream,
        stderr: capture().stream,
        now: fixedNow,
      },
    );
    expect(code).toBe(0);
    expect(analyzeSessionImpl).toHaveBeenCalledTimes(1);
    expect(rebuildImpl).toHaveBeenCalledTimes(1);
    expect(out.text()).toMatch(/concepts=3 unknowns=1/);
    await expect(stat(analysisLockPath(tmp))).rejects.toThrow();
    await expect(stat(logFilePath(tmp, 'sess-ok'))).resolves.toBeDefined();
  });

  it('existing session file without --force reports skip', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const sid = 'sess-existing';
    const file = join(sessionsDir(tmp), `2026-04-20-${sid}.md`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, '# session\n', 'utf8');

    const out = capture();
    const analyzeSessionImpl = vi.fn();
    const code = await runAnalyzeSubcommand(
      { projectRoot: tmp, sessionId: sid, transcriptPath: join(tmp, 't.jsonl') },
      {
        analyzeSessionImpl: analyzeSessionImpl as unknown as AnalyzeDeps['analyzeSessionImpl'],
        stdout: out.stream,
        stderr: capture().stream,
        now: fixedNow,
      },
    );
    expect(code).toBe(0);
    expect(analyzeSessionImpl).not.toHaveBeenCalled();
    expect(out.text()).toMatch(/already analyzed/);
  });
});
