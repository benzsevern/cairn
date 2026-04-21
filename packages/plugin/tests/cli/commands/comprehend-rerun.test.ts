import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runRerun,
  showPreview,
  type RerunArgs,
} from '../../../src/cli/commands/comprehend-rerun.js';
import { writeProjectConsent } from '../../../src/consent.js';
import { tryAcquireLock } from '../../../src/lock.js';
import { logFilePath, sessionsDir } from '../../../src/plugin-paths.js';

const fixedNow = () => new Date('2026-04-20T12:00:00.000Z');

async function seedTranscript(projectRoot: string, name: string, content: string): Promise<string> {
  const dir = join(projectRoot, 'transcripts');
  await mkdir(dir, { recursive: true });
  const p = join(dir, `${name}.jsonl`);
  await writeFile(p, content, 'utf8');
  return p;
}

async function writeSessionFile(
  projectRoot: string,
  sessionId: string,
  transcriptPath: string,
  refinerVersion = 'v1.0.0',
): Promise<void> {
  const dir = sessionsDir(projectRoot);
  await mkdir(dir, { recursive: true });
  const body = [
    '---',
    `session_id: ${sessionId}`,
    `transcript_path: ${transcriptPath}`,
    `analyzed_at: ${fixedNow().toISOString()}`,
    `refiner_version: ${refinerVersion}`,
    `refiner_prompt_hash: hash-${sessionId}`,
    'model: claude-sonnet-4-6',
    'segment_count: 1',
    'concept_count: 1',
    'unknown_count: 0',
    '---',
    '',
    `## Concept: X ${sessionId}  {#x-${sessionId}}`,
    '',
    '**Kind:** introduced',
    '**Confidence:** high',
    '**Depends on:** []',
    '**Files:** ',
    '',
    '**Summary**',
    'a concept',
    '',
    '**Transcript refs:** ',
    '',
  ].join('\n');
  await writeFile(join(dir, `2026-04-20-${sessionId}.md`), body, 'utf8');
}

const validRefinerJson = JSON.stringify({
  concepts: [
    {
      slug: 'y',
      name: 'Y',
      kind: 'refined',
      summary: 's',
      reasoning: [],
      depends_on: [],
      files: [],
      transcript_refs: [],
      confidence: 'high',
    },
  ],
  unknowns: [],
});

// Provide a valid transcript as a single JSONL user event so readTranscript succeeds.
const sampleTranscript = JSON.stringify({
  type: 'user',
  uuid: 'u-1',
  timestamp: '2026-04-20T11:00:00.000Z',
  message: { role: 'user', content: 'hello please analyze' },
}) + '\n';

describe('runRerun', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-rerun-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('exits 3 if project not opted in (bare)', async () => {
    await expect(
      runRerun({ projectRoot: tmp, mode: 'rebuild' }),
    ).rejects.toMatchObject({ exitCode: 3 });
  });

  it('bare mode re-runs rebuild only (no refiner)', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    // Seed a session so rebuildProjectView has something to merge (works with none too).
    const tp = await seedTranscript(tmp, 'sess-1', sampleTranscript);
    await writeSessionFile(tmp, 'sess-1', tp);

    const invoke = vi.fn();
    const report = await runRerun({ projectRoot: tmp, mode: 'rebuild', invoke, now: fixedNow });
    expect(invoke).not.toHaveBeenCalled();
    expect(report.mode).toBe('rebuild');
    // graph.html should exist after rebuild
    await expect(stat(join(tmp, '.comprehension', 'graph.html'))).resolves.toBeTruthy();
  });

  it('--session re-analyzes ONE session and releases lock', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const tp = await seedTranscript(tmp, 'sess-1', sampleTranscript);
    await writeSessionFile(tmp, 'sess-1', tp);

    const invoke = vi.fn().mockResolvedValue(validRefinerJson);
    const result = await runRerun({
      projectRoot: tmp,
      mode: 'session',
      sessionId: 'sess-1',
      invoke,
      now: fixedNow,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.analyzed).toBe(1);
    // Lock file should be released.
    await expect(stat(join(tmp, '.comprehension', 'analysis.lock'))).rejects.toThrow();
  });

  it('--all re-analyzes every session and writes backfill_batch log entry with mode:rerun', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const tp1 = await seedTranscript(tmp, 'sess-1', sampleTranscript);
    const tp2 = await seedTranscript(tmp, 'sess-2', sampleTranscript);
    await writeSessionFile(tmp, 'sess-1', tp1);
    await writeSessionFile(tmp, 'sess-2', tp2);

    const invoke = vi.fn().mockResolvedValue(validRefinerJson);
    const result = await runRerun({
      projectRoot: tmp,
      mode: 'all',
      confirm: async () => true,
      invoke,
      now: fixedNow,
    });
    expect(invoke.mock.calls.length).toBe(2);
    expect(result.analyzed).toBe(2);

    const raw = await readFile(logFilePath(tmp, '_batch'), 'utf8');
    const lines = raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: 'backfill_batch',
      session_id: '_batch',
      mode: 'rerun',
      analyzed: 2,
      failed: 0,
    });
  });

  it('--show-preview emits structured JSON payload', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const tp1 = await seedTranscript(tmp, 'sess-1', sampleTranscript);
    await writeSessionFile(tmp, 'sess-1', tp1);

    const payload = await showPreview({
      projectRoot: tmp,
      mode: 'all',
      model: 'claude-sonnet-4-6',
    });
    expect(payload).toMatchObject({
      mode: 'all',
      count: 1,
      project_root: tmp,
    });
    expect(typeof payload.estimated_cost_usd_low).toBe('number');
    expect(typeof payload.estimated_cost_usd_high).toBe('number');
    expect(typeof payload.refiner_version_current).toBe('string');
    expect(Array.isArray(payload.refiner_version_on_sessions)).toBe(true);
  });

  it('--session exits 4 if lock held', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const tp = await seedTranscript(tmp, 'sess-1', sampleTranscript);
    await writeSessionFile(tmp, 'sess-1', tp);
    // Pre-acquire lock as another pid.
    await tryAcquireLock(tmp, { pid: 99999, session_id: 'other' }, { now: fixedNow });

    const args: RerunArgs = {
      projectRoot: tmp,
      mode: 'session',
      sessionId: 'sess-1',
      now: fixedNow,
      invoke: vi.fn().mockResolvedValue(validRefinerJson),
    };
    await expect(runRerun(args)).rejects.toMatchObject({ exitCode: 4 });
  });

  it('--all without confirm consent exits 2', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    await expect(
      runRerun({
        projectRoot: tmp,
        mode: 'all',
        confirm: async () => false,
        now: fixedNow,
      }),
    ).rejects.toMatchObject({ exitCode: 2 });
  });

  it('listSessions tolerates an empty sessions directory (preview mode=all, count=0)', async () => {
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    // Create sessions dir but leave it empty.
    await mkdir(sessionsDir(tmp), { recursive: true });
    const payload = await showPreview({
      projectRoot: tmp,
      mode: 'all',
      model: 'claude-sonnet-4-6',
    });
    expect(payload.count).toBe(0);
    expect(payload.estimated_cost_usd_low).toBe(0);
  });
});
