import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSessionArtifact } from '../../src/writer/write-session.js';
import { loadAllSessions } from '../../src/deriver/session-loader.js';
import { sessionsDir } from '../../src/paths.js';
import type { SessionArtifact } from '../../src/types.js';

function makeArtifact(overrides: Partial<SessionArtifact> = {}): SessionArtifact {
  return {
    session_id: 'sess-1',
    transcript_path: '/tmp/t.jsonl',
    analyzed_at: '2026-04-20T10:00:00Z',
    refiner_version: 'v1.0.0',
    refiner_prompt_hash: 'sha256:abc',
    model: 'claude-sonnet-4-6',
    segment_count: 2,
    concept_count: 1,
    unknown_count: 1,
    concepts: [
      {
        slug: 'cache-invalidation',
        name: 'Cache invalidation',
        kind: 'introduced',
        summary: 'We invalidate the cache after every write.',
        reasoning: ['Chose write-through because latency was acceptable'],
        depends_on: ['storage'],
        files: ['src/cache.ts', 'src/store.ts'],
        transcript_refs: [3, 7],
        confidence: 'high',
      },
    ],
    unknowns: [
      {
        slug_ref: 'cache-invalidation',
        question: 'why LRU vs LFU',
        recovery_prompt: 'Ask the user which replacement policy was considered.',
      },
    ],
    ...overrides,
  };
}

describe('loadAllSessions', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-loader-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns [] when sessions dir does not exist', async () => {
    const result = await loadAllSessions(tmp);
    expect(result).toEqual([]);
  });

  it('round-trips a written artifact with all fields preserved', async () => {
    const original = makeArtifact();
    await writeSessionArtifact(tmp, original, '2026-04-20');
    const loaded = await loadAllSessions(tmp);
    expect(loaded).toHaveLength(1);
    const got = loaded[0]!;
    expect(got.session_id).toBe(original.session_id);
    expect(got.transcript_path).toBe(original.transcript_path);
    expect(got.analyzed_at).toBe(original.analyzed_at);
    expect(got.refiner_version).toBe(original.refiner_version);
    expect(got.refiner_prompt_hash).toBe(original.refiner_prompt_hash);
    expect(got.model).toBe(original.model);
    expect(got.segment_count).toBe(original.segment_count);
    expect(got.concept_count).toBe(original.concept_count);
    expect(got.unknown_count).toBe(original.unknown_count);
    expect(got.concepts).toEqual(original.concepts);
    expect(got.unknowns).toEqual(original.unknowns);
  });

  it('skips .failed.json stubs when listing sessions', async () => {
    await writeSessionArtifact(tmp, makeArtifact(), '2026-04-20');
    await mkdir(sessionsDir(tmp), { recursive: true });
    await writeFile(
      join(sessionsDir(tmp), '2026-04-19-busted.failed.json'),
      JSON.stringify({ session_id: 'busted', reason: 'schema' }),
      'utf8',
    );
    const loaded = await loadAllSessions(tmp);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.session_id).toBe('sess-1');
  });

  it('returns artifacts sorted by analyzed_at ascending', async () => {
    await writeSessionArtifact(
      tmp,
      makeArtifact({ session_id: 'c', analyzed_at: '2026-03-15T10:00:00Z' }),
      '2026-03-15',
    );
    await writeSessionArtifact(
      tmp,
      makeArtifact({ session_id: 'a', analyzed_at: '2026-01-01T10:00:00Z' }),
      '2026-01-01',
    );
    await writeSessionArtifact(
      tmp,
      makeArtifact({ session_id: 'b', analyzed_at: '2026-02-10T10:00:00Z' }),
      '2026-02-10',
    );
    const loaded = await loadAllSessions(tmp);
    expect(loaded.map((a) => a.session_id)).toEqual(['a', 'b', 'c']);
  });
});
