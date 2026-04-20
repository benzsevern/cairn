import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSessionArtifact } from '../../src/writer/write-session.js';
import { sessionsDir } from '../../src/paths.js';
import type { SessionArtifact } from '../../src/types.js';

const minimal: SessionArtifact = {
  session_id: 'sess-1',
  transcript_path: '/t.jsonl',
  analyzed_at: '2026-04-20T10:00:00Z',
  refiner_version: 'v1.0.0',
  refiner_prompt_hash: 'sha256:abc',
  model: 'claude-sonnet-4-6',
  segment_count: 1,
  concept_count: 0,
  unknown_count: 0,
  concepts: [],
  unknowns: [],
};

describe('writeSessionArtifact', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'fos-write-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('creates sessions dir if missing and writes a file with the date-id filename pattern', async () => {
    const out = await writeSessionArtifact(tmp, minimal, '2026-04-20');
    const files = await readdir(sessionsDir(tmp));
    expect(files).toEqual(['2026-04-20-sess-1.md']);
    const text = await readFile(out, 'utf8');
    expect(text).toContain('session_id: sess-1');
  });

  it('overwrites an existing session file without leaving a temp artifact', async () => {
    await writeSessionArtifact(tmp, minimal, '2026-04-20');
    const updated = { ...minimal, model: 'claude-opus-4-7' };
    const target = await writeSessionArtifact(tmp, updated, '2026-04-20');
    const files = await readdir(sessionsDir(tmp));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.md$/);
    const text = await readFile(target, 'utf8');
    expect(text).toContain('claude-opus-4-7');
  });
});
