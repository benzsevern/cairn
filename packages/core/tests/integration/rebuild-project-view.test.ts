import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rebuildProjectView } from '../../src/rebuild-project-view.js';
import { writeSessionArtifact } from '../../src/writer/write-session.js';
import { readManifest } from '../../src/writer/manifest.js';
import {
  conceptsDir,
  graphJsonPath,
  graphHtmlPath,
  conceptFilePath,
} from '../../src/paths.js';
import type { SessionArtifact } from '../../src/types.js';

function makeArtifact(overrides: Partial<SessionArtifact>): SessionArtifact {
  return {
    session_id: 'x',
    transcript_path: '/t.jsonl',
    analyzed_at: '2026-04-19T10:00:00Z',
    refiner_version: 'v1.0.0',
    refiner_prompt_hash: 'sha256:a',
    model: 'claude',
    segment_count: 1,
    concept_count: 0,
    unknown_count: 0,
    concepts: [],
    unknowns: [],
    ...overrides,
  };
}

const sessionA = makeArtifact({
  session_id: 'A',
  analyzed_at: '2026-04-18T10:00:00Z',
  concepts: [
    {
      slug: 'alpha',
      name: 'Alpha',
      kind: 'introduced',
      summary: 'Alpha concept.',
      reasoning: ['reasoning-a'],
      depends_on: [],
      files: ['src/a.ts'],
      transcript_refs: [],
      confidence: 'high',
    },
  ],
  concept_count: 1,
});

const sessionB = makeArtifact({
  session_id: 'B',
  analyzed_at: '2026-04-19T10:00:00Z',
  concepts: [
    {
      slug: 'beta',
      name: 'Beta',
      kind: 'introduced',
      summary: 'Beta depends on alpha.',
      reasoning: ['reasoning-b'],
      depends_on: ['alpha'],
      files: ['src/b.ts'],
      transcript_refs: [],
      confidence: 'medium',
    },
  ],
  concept_count: 1,
});

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('rebuildProjectView', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-rebuild-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('produces concept files, graph.json, and graph.html for a 2-session project', async () => {
    await writeSessionArtifact(tmp, sessionA, '2026-04-18');
    await writeSessionArtifact(tmp, sessionB, '2026-04-19');

    await rebuildProjectView({
      projectRoot: tmp,
      now: () => new Date('2026-04-20T00:00:00.000Z'),
    });

    const conceptFiles = await readdir(conceptsDir(tmp));
    expect(conceptFiles.sort()).toEqual(['alpha.md', 'beta.md']);

    const graphRaw = await readFile(graphJsonPath(tmp), 'utf8');
    const graph = JSON.parse(graphRaw) as {
      nodes: Array<{ slug: string }>;
      edges: Array<{ from: string; to: string }>;
      project_view_version: number;
    };
    expect(graph.nodes.map((n) => n.slug).sort()).toEqual(['alpha', 'beta']);
    expect(graph.edges).toEqual([{ from: 'beta', to: 'alpha', kind: 'depends_on', status: 'active' }]);

    expect(await exists(graphHtmlPath(tmp))).toBe(true);
  });

  it('is idempotent: deterministic fields are byte-identical across two runs with the same clock', async () => {
    await writeSessionArtifact(tmp, sessionA, '2026-04-18');
    await writeSessionArtifact(tmp, sessionB, '2026-04-19');

    const clock = () => new Date('2026-04-20T00:00:00.000Z');

    await rebuildProjectView({ projectRoot: tmp, now: clock });
    const alpha1 = await readFile(conceptFilePath(tmp, 'alpha'), 'utf8');
    const beta1 = await readFile(conceptFilePath(tmp, 'beta'), 'utf8');
    const graph1 = JSON.parse(await readFile(graphJsonPath(tmp), 'utf8')) as {
      nodes: unknown;
      edges: unknown;
    };

    await rebuildProjectView({ projectRoot: tmp, now: clock });
    const alpha2 = await readFile(conceptFilePath(tmp, 'alpha'), 'utf8');
    const beta2 = await readFile(conceptFilePath(tmp, 'beta'), 'utf8');
    const graph2 = JSON.parse(await readFile(graphJsonPath(tmp), 'utf8')) as {
      nodes: unknown;
      edges: unknown;
    };

    // Concept files contain no version/timestamp, so they must be byte-identical.
    expect(alpha2).toBe(alpha1);
    expect(beta2).toBe(beta1);
    // Graph nodes/edges are deterministic across runs (only version/generated_at change).
    expect(graph2.nodes).toEqual(graph1.nodes);
    expect(graph2.edges).toEqual(graph1.edges);
  });

  it('bumps project_view_version exactly once per call and updates last_rebuild', async () => {
    await writeSessionArtifact(tmp, sessionA, '2026-04-18');

    const before = await readManifest(tmp);
    expect(before.project_view_version).toBe(0);
    expect(before.last_rebuild).toBeNull();

    await rebuildProjectView({
      projectRoot: tmp,
      now: () => new Date('2026-04-20T01:00:00.000Z'),
    });
    const m1 = await readManifest(tmp);
    expect(m1.project_view_version).toBe(1);
    expect(m1.last_rebuild).toBe('2026-04-20T01:00:00.000Z');

    await rebuildProjectView({
      projectRoot: tmp,
      now: () => new Date('2026-04-20T02:00:00.000Z'),
    });
    const m2 = await readManifest(tmp);
    expect(m2.project_view_version).toBe(2);
    expect(m2.last_rebuild).toBe('2026-04-20T02:00:00.000Z');

    // Also verify graph.json carries the same bumped version.
    const graph = JSON.parse(await readFile(graphJsonPath(tmp), 'utf8')) as {
      project_view_version: number;
      generated_at: string;
    };
    expect(graph.project_view_version).toBe(2);
    expect(graph.generated_at).toBe('2026-04-20T02:00:00.000Z');
  });

  it('deletes obsolete concept files when sessions no longer reference them', async () => {
    // First rebuild with A+B present — both concept files appear.
    await writeSessionArtifact(tmp, sessionA, '2026-04-18');
    await writeSessionArtifact(tmp, sessionB, '2026-04-19');
    await rebuildProjectView({
      projectRoot: tmp,
      now: () => new Date('2026-04-20T00:00:00.000Z'),
    });
    expect((await readdir(conceptsDir(tmp))).sort()).toEqual(['alpha.md', 'beta.md']);

    // Remove session B's file, rebuild — beta.md should be deleted.
    await rm(join(tmp, '.comprehension', 'sessions', '2026-04-19-B.md'));
    await rebuildProjectView({
      projectRoot: tmp,
      now: () => new Date('2026-04-20T01:00:00.000Z'),
    });
    expect(await readdir(conceptsDir(tmp))).toEqual(['alpha.md']);
  });
});
