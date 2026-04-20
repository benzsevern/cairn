import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSession } from '../../src/analyze-session.js';
import { writeSessionArtifact } from '../../src/writer/write-session.js';
import { writeManifest, defaultManifest, readManifest } from '../../src/writer/manifest.js';
import { sessionsDir } from '../../src/paths.js';
import type { SessionArtifact } from '../../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRANSCRIPT_FIXTURE = join(HERE, '..', 'fixtures', 'transcripts', 'minimal.jsonl');

const goodRefinerJson = JSON.stringify({
  concepts: [
    {
      slug: 'fuzzy-matcher',
      name: 'Fuzzy matcher',
      kind: 'introduced',
      summary: 'Levenshtein-based company name matcher.',
      reasoning: ['Chose Levenshtein for simplicity'],
      depends_on: [],
      files: ['src/match.ts'],
      transcript_refs: [],
      confidence: 'high',
    },
  ],
  unknowns: [],
});

describe('analyzeSession', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-analyze-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('empty project + fresh transcript → session file written and manifest updated', async () => {
    const invoke = vi.fn().mockResolvedValue(goodRefinerJson);
    const artifact = await analyzeSession({
      projectRoot: tmp,
      transcriptPath: TRANSCRIPT_FIXTURE,
      sessionId: 'sess-a',
      model: 'claude-sonnet-4-6',
      now: () => new Date('2026-04-20T10:00:00.000Z'),
      invoke,
    });

    expect(artifact.session_id).toBe('sess-a');
    expect(artifact.concepts).toHaveLength(1);
    expect(artifact.concepts[0]!.slug).toBe('fuzzy-matcher');

    const files = await readdir(sessionsDir(tmp));
    expect(files).toEqual(['2026-04-20-sess-a.md']);

    const manifest = await readManifest(tmp);
    expect(manifest.refiner_version).toBeTruthy();
    expect(manifest.refiner_prompt_hash).toMatch(/^sha256:/);
    expect(manifest.override_active).toBe(false);
  });

  it('existing concepts are passed to the refiner via <existing-concepts>', async () => {
    // Seed the project with one prior session.
    const prior: SessionArtifact = {
      session_id: 'prev',
      transcript_path: '/t.jsonl',
      analyzed_at: '2026-04-19T10:00:00Z',
      refiner_version: 'v1.0.0',
      refiner_prompt_hash: 'sha256:x',
      model: 'claude-sonnet-4-6',
      segment_count: 1,
      concept_count: 1,
      unknown_count: 0,
      concepts: [
        {
          slug: 'cache-invalidation',
          name: 'Cache invalidation',
          kind: 'introduced',
          summary: 'Invalidate on write.',
          reasoning: [],
          depends_on: [],
          files: ['src/cache.ts'],
          transcript_refs: [],
          confidence: 'high',
        },
      ],
      unknowns: [],
    };
    await writeSessionArtifact(tmp, prior, '2026-04-19');

    const invoke = vi.fn().mockResolvedValue(goodRefinerJson);
    await analyzeSession({
      projectRoot: tmp,
      transcriptPath: TRANSCRIPT_FIXTURE,
      sessionId: 'sess-b',
      invoke,
    });

    const call = invoke.mock.calls[0]![0] as { userInput: string };
    expect(call.userInput).toContain('<existing-concepts>');
    expect(call.userInput).toContain('cache-invalidation');
    expect(call.userInput).toContain('Cache invalidation');
  });

  it('RefinerFailure → failed stub written, no session md, manifest unchanged', async () => {
    // Seed a manifest so we can assert it was NOT bumped.
    const before = defaultManifest();
    before.refiner_version = 'vX-sentinel';
    before.refiner_prompt_hash = 'sha256:sentinel';
    await writeManifest(tmp, before);

    const invoke = vi.fn().mockResolvedValue('this is not valid json at all');
    await expect(
      analyzeSession({
        projectRoot: tmp,
        transcriptPath: TRANSCRIPT_FIXTURE,
        sessionId: 'sess-fail',
        now: () => new Date('2026-04-20T12:00:00.000Z'),
        invoke,
        maxAttempts: 2,
      }),
    ).rejects.toThrow(/RefinerFailure/);

    const files = await readdir(sessionsDir(tmp));
    expect(files).toEqual(['2026-04-20-sess-fail.failed.json']);

    const stubRaw = await readFile(join(sessionsDir(tmp), '2026-04-20-sess-fail.failed.json'), 'utf8');
    const stub = JSON.parse(stubRaw) as {
      reason: string;
      attempts: Array<{ kind: string }>;
    };
    expect(stub.reason).toBe('RefinerFailure');
    expect(stub.attempts.length).toBeGreaterThan(0);

    // manifest untouched
    const after = await readManifest(tmp);
    expect(after.refiner_version).toBe('vX-sentinel');
    expect(after.refiner_prompt_hash).toBe('sha256:sentinel');
  });

  it('PayloadTooLargeError → failed stub written with reason PayloadTooLargeError', async () => {
    // Build a synthetic transcript large enough to trip the 400k cap after serialization.
    const big = 'x'.repeat(5_000);
    const lines: string[] = [];
    // 100 turns × ~5kB → ~500kB payload, > 400kB cap.
    for (let i = 0; i < 100; i++) {
      lines.push(
        JSON.stringify({
          type: 'user',
          timestamp: '2026-04-20T10:00:00Z',
          message: { role: 'user', content: big },
        }),
      );
      lines.push(
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-04-20T10:00:01Z',
          message: { role: 'assistant', content: [{ type: 'text', text: big }] },
        }),
      );
    }
    const bigTranscript = join(tmp, 'big.jsonl');
    await writeFile(bigTranscript, lines.join('\n'), 'utf8');

    const invoke = vi.fn().mockResolvedValue(goodRefinerJson);
    await expect(
      analyzeSession({
        projectRoot: tmp,
        transcriptPath: bigTranscript,
        sessionId: 'sess-huge',
        now: () => new Date('2026-04-20T13:00:00.000Z'),
        invoke,
      }),
    ).rejects.toThrow(/PayloadTooLarge/);

    expect(invoke).not.toHaveBeenCalled();

    const files = await readdir(sessionsDir(tmp));
    expect(files).toEqual(['2026-04-20-sess-huge.failed.json']);
    const stubRaw = await readFile(join(sessionsDir(tmp), '2026-04-20-sess-huge.failed.json'), 'utf8');
    const stub = JSON.parse(stubRaw) as { reason: string; attempts: Array<{ kind: string }> };
    expect(stub.reason).toBe('PayloadTooLargeError');
    expect(stub.attempts[0]!.kind).toBe('payload_too_large');
  });
});
