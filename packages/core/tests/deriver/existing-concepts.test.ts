import { describe, it, expect } from 'vitest';
import { existingConceptSummaries } from '../../src/deriver/existing-concepts.js';
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
  return { concepts: map, generated_at: '2026-04-20T12:00:00Z', project_view_version: 1 };
}

describe('existingConceptSummaries', () => {
  it('produces slug, name, latest summary, and first-3 files per concept', () => {
    const v = view(
      merged({
        slug: 'a',
        name: 'Alpha',
        files: ['f1.ts', 'f2.ts', 'f3.ts', 'f4.ts'],
        history: [
          { session_id: 's1', analyzed_at: '2026-01-01T00:00:00Z', kind: 'introduced', summary: 'old', reasoning: [] },
          { session_id: 's2', analyzed_at: '2026-02-01T00:00:00Z', kind: 'refined', summary: 'latest take', reasoning: [] },
        ],
      }),
    );
    const out = existingConceptSummaries(v);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      slug: 'a',
      name: 'Alpha',
      summary: 'latest take',
      files: ['f1.ts', 'f2.ts', 'f3.ts'],
    });
  });

  it('truncates summaries longer than 180 chars with a trailing ellipsis', () => {
    const long = 'x'.repeat(400);
    const v = view(
      merged({
        slug: 'a',
        name: 'A',
        history: [
          { session_id: 's1', analyzed_at: '2026-01-01T00:00:00Z', kind: 'introduced', summary: long, reasoning: [] },
        ],
      }),
    );
    const out = existingConceptSummaries(v);
    expect(out[0]!.summary).toHaveLength(180);
    expect(out[0]!.summary.endsWith('…')).toBe(true);
  });
});
