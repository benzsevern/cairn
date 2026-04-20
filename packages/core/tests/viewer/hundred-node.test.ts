import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeSessions } from '../../src/deriver/merge.js';
import { buildGraphJson } from '../../src/deriver/graph-json.js';
import { renderGraphHtml } from '../../src/viewer/render-html.js';
import { graphHtmlPath } from '../../src/paths.js';
import type { ConceptNode, SessionArtifact } from '../../src/types.js';

function synthesizeHundredConceptSession(): SessionArtifact {
  const concepts: ConceptNode[] = [];
  for (let i = 0; i < 100; i++) {
    const slug = `c${String(i).padStart(3, '0')}`;
    // Build a tree: node i depends on floor((i-1)*0.6) % i — deterministic, every non-root has one parent.
    const deps: string[] = [];
    if (i > 0) {
      const parentIdx = Math.floor((i - 1) * 0.6) % i;
      deps.push(`c${String(parentIdx).padStart(3, '0')}`);
    }
    concepts.push({
      slug,
      name: `Concept ${i}`,
      kind: 'introduced',
      summary: `Synthetic concept ${i}`,
      reasoning: [`reason-${i}`],
      depends_on: deps,
      files: [`src/file-${i % 10}.ts`],
      transcript_refs: [i],
      confidence: (['high', 'medium', 'low', 'unknown'] as const)[i % 4],
    });
  }
  return {
    session_id: 's-hundred',
    transcript_path: '/tmp/s-hundred.jsonl',
    analyzed_at: '2026-04-20T12:00:00Z',
    refiner_version: '0.0.1',
    refiner_prompt_hash: 'hash',
    model: 'test-model',
    segment_count: 1,
    concept_count: concepts.length,
    unknown_count: 0,
    concepts,
    unknowns: [],
  };
}

describe('100-node graph pipeline smoke', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-100-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('builds + renders 100 concepts through merge -> graph.json -> HTML without error', async () => {
    const session = synthesizeHundredConceptSession();
    const view = mergeSessions([session]);
    expect(view.concepts.size).toBe(100);

    const graph = buildGraphJson(view);
    expect(graph.nodes).toHaveLength(100);
    expect(graph.edges.length).toBe(99); // tree: n-1 edges

    const target = await renderGraphHtml(tmp, graph);
    expect(target).toBe(graphHtmlPath(tmp));

    const html = await readFile(target, 'utf8');
    const start = html.indexOf('<script id="fos-graph-data" type="application/json">');
    expect(start).toBeGreaterThan(-1);
    const afterOpen = start + '<script id="fos-graph-data" type="application/json">'.length;
    const close = html.indexOf('</script>', afterOpen);
    const payload = html.slice(afterOpen, close);
    const parsed = JSON.parse(payload);
    expect(parsed.nodes).toHaveLength(100);
    expect(parsed.edges).toHaveLength(99);
  });
});
