import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildGraphJson, writeGraphJson } from '../../src/deriver/graph-json.js';
import { graphJsonPath } from '../../src/paths.js';
import type { MergedConcept, ProjectView } from '../../src/types.js';

function merged(p: Partial<MergedConcept> & { slug: string; name: string }): MergedConcept {
  return {
    introduced_in: 's1',
    last_updated_in: 's1',
    depends_on: [],
    depended_on_by: [],
    files: [],
    confidence: 'unknown',
    history: [],
    unknowns: [],
    ...p,
  };
}

function view(...concepts: MergedConcept[]): ProjectView {
  const map = new Map<string, MergedConcept>();
  for (const c of concepts) map.set(c.slug, c);
  return { concepts: map, generated_at: '2026-04-20T12:00:00Z', project_view_version: 3 };
}

describe('buildGraphJson', () => {
  it('produces one node per concept with the documented shape', () => {
    const v = view(
      merged({
        slug: 'a',
        name: 'Alpha',
        confidence: 'high',
        introduced_in: 's1',
        files: ['x.ts', 'y.ts'],
        history: [
          { session_id: 's1', analyzed_at: '2026-01-01T00:00:00Z', kind: 'introduced', summary: '', reasoning: [] },
          { session_id: 's2', analyzed_at: '2026-02-01T00:00:00Z', kind: 'refined', summary: '', reasoning: [] },
        ],
        unknowns: [{ slug_ref: 'a', question: 'q', recovery_prompt: 'rp' }],
      }),
    );
    const g = buildGraphJson(v);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]).toEqual({
      slug: 'a',
      name: 'Alpha',
      confidence: 'high',
      introduced_in: 's1',
      file_count: 2,
      session_touch_count: 2,
      has_unknowns: true,
    });
  });

  it('emits both active and deprecated edges distinguished by status', () => {
    const v = view(
      merged({
        slug: 'child',
        name: 'Child',
        depends_on: [
          { slug: 'p1', status: 'active', last_asserted_in: 's2' },
          { slug: 'p2', status: 'deprecated', last_asserted_in: 's1' },
        ],
      }),
      merged({ slug: 'p1', name: 'P1' }),
      merged({ slug: 'p2', name: 'P2' }),
    );
    const g = buildGraphJson(v);
    const childEdges = g.edges.filter((e) => e.from === 'child');
    expect(childEdges).toHaveLength(2);
    expect(childEdges.find((e) => e.to === 'p1')!.status).toBe('active');
    expect(childEdges.find((e) => e.to === 'p2')!.status).toBe('deprecated');
    for (const e of childEdges) {
      expect(e.kind).toBe('depends_on');
    }
  });

  it('sorts nodes and edges deterministically', () => {
    const v = view(
      merged({
        slug: 'b',
        name: 'B',
        depends_on: [
          { slug: 'z', status: 'active', last_asserted_in: 's1' },
          { slug: 'a', status: 'active', last_asserted_in: 's1' },
        ],
      }),
      merged({ slug: 'a', name: 'A' }),
      merged({ slug: 'z', name: 'Z' }),
    );
    const g = buildGraphJson(v);
    expect(g.nodes.map((n) => n.slug)).toEqual(['a', 'b', 'z']);
    // Edges from 'b' sorted by to
    const bEdges = g.edges.filter((e) => e.from === 'b');
    expect(bEdges.map((e) => e.to)).toEqual(['a', 'z']);
  });
});

describe('writeGraphJson', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-graph-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes graph.json atomically (no stray .tmp file) and content parses', async () => {
    const v = view(merged({ slug: 'a', name: 'Alpha' }));
    await writeGraphJson(tmp, v);
    const target = graphJsonPath(tmp);
    const raw = await readFile(target, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.schema_version).toBe('1.0.0');
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.project_view_version).toBe(3);

    const dirListing = await readdir(dirname(target));
    expect(dirListing.some((n) => n.endsWith('.tmp'))).toBe(false);
  });
});
