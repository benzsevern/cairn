import { describe, it, expect } from 'vitest';
import { mergeSessions } from '../../src/deriver/merge.js';
import type { ConceptNode, SessionArtifact, Unknown } from '../../src/types.js';

function concept(p: Partial<ConceptNode> & { slug: string; name: string }): ConceptNode {
  return {
    kind: 'referenced',
    summary: '',
    reasoning: [],
    depends_on: [],
    files: [],
    transcript_refs: [],
    confidence: 'unknown',
    ...p,
  };
}

function session(p: Partial<SessionArtifact> & { session_id: string; analyzed_at: string }): SessionArtifact {
  return {
    transcript_path: `/t/${p.session_id}.jsonl`,
    refiner_version: 'v1.0.0',
    refiner_prompt_hash: 'sha256:abc',
    model: 'claude-sonnet-4-6',
    segment_count: 1,
    concept_count: p.concepts?.length ?? 0,
    unknown_count: p.unknowns?.length ?? 0,
    concepts: [],
    unknowns: [],
    ...p,
  };
}

describe('mergeSessions', () => {
  it('produces one MergedConcept per unique slug across sessions', () => {
    const s1 = session({
      session_id: 's1',
      analyzed_at: '2026-01-01T10:00:00Z',
      concepts: [concept({ slug: 'a', name: 'Alpha' }), concept({ slug: 'b', name: 'Beta' })],
    });
    const s2 = session({
      session_id: 's2',
      analyzed_at: '2026-01-02T10:00:00Z',
      concepts: [concept({ slug: 'a', name: 'Alpha v2' }), concept({ slug: 'c', name: 'Gamma' })],
    });
    const view = mergeSessions([s1, s2]);
    expect([...view.concepts.keys()].sort()).toEqual(['a', 'b', 'c']);
    // Latest-name-wins for display
    expect(view.concepts.get('a')!.name).toBe('Alpha v2');
  });

  it('unions files across sessions', () => {
    const s1 = session({
      session_id: 's1',
      analyzed_at: '2026-01-01T00:00:00Z',
      concepts: [concept({ slug: 'a', name: 'A', files: ['src/a.ts', 'src/b.ts'] })],
    });
    const s2 = session({
      session_id: 's2',
      analyzed_at: '2026-01-02T00:00:00Z',
      concepts: [concept({ slug: 'a', name: 'A', files: ['src/b.ts', 'src/c.ts'] })],
    });
    const view = mergeSessions([s1, s2]);
    expect(view.concepts.get('a')!.files.sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('sets introduced_in = earliest session and last_updated_in = latest', () => {
    const s1 = session({
      session_id: 's1',
      analyzed_at: '2026-01-01T00:00:00Z',
      concepts: [concept({ slug: 'a', name: 'A' })],
    });
    const s2 = session({
      session_id: 's2',
      analyzed_at: '2026-02-01T00:00:00Z',
      concepts: [concept({ slug: 'a', name: 'A' })],
    });
    const view = mergeSessions([s1, s2]);
    const merged = view.concepts.get('a')!;
    expect(merged.introduced_in).toBe('s1');
    expect(merged.last_updated_in).toBe('s2');
  });

  it('appends history entries in chronological order with the correct kind', () => {
    const s1 = session({
      session_id: 's1',
      analyzed_at: '2026-01-01T00:00:00Z',
      concepts: [concept({ slug: 'a', name: 'A', kind: 'introduced', summary: 'first' })],
    });
    const s2 = session({
      session_id: 's2',
      analyzed_at: '2026-02-01T00:00:00Z',
      concepts: [concept({ slug: 'a', name: 'A', kind: 'refined', summary: 'second' })],
    });
    const view = mergeSessions([s1, s2]);
    const h = view.concepts.get('a')!.history;
    expect(h).toHaveLength(2);
    expect(h[0]!.session_id).toBe('s1');
    expect(h[0]!.kind).toBe('introduced');
    expect(h[1]!.session_id).toBe('s2');
    expect(h[1]!.kind).toBe('refined');
    expect(h[1]!.summary).toBe('second');
  });

  it('preserves reasoning per-session (does not dedup at merge time)', () => {
    const reasoning = ['Picked X because Y', 'Z was ruled out'];
    const s1 = session({
      session_id: 's1',
      analyzed_at: '2026-01-01T00:00:00Z',
      concepts: [concept({ slug: 'a', name: 'A', reasoning })],
    });
    const s2 = session({
      session_id: 's2',
      analyzed_at: '2026-02-01T00:00:00Z',
      // Intentionally duplicate reasoning lines from s1.
      concepts: [concept({ slug: 'a', name: 'A', reasoning })],
    });
    const view = mergeSessions([s1, s2]);
    const h = view.concepts.get('a')!.history;
    expect(h[0]!.reasoning).toEqual(reasoning);
    expect(h[1]!.reasoning).toEqual(reasoning);
  });

  it('computes depended_on_by as the reverse of active edges', () => {
    const s1 = session({
      session_id: 's1',
      analyzed_at: '2026-01-01T00:00:00Z',
      concepts: [
        concept({ slug: 'child', name: 'Child', depends_on: ['parent'] }),
        concept({ slug: 'parent', name: 'Parent' }),
      ],
    });
    const view = mergeSessions([s1]);
    expect(view.concepts.get('parent')!.depended_on_by).toEqual(['child']);
    expect(view.concepts.get('child')!.depended_on_by).toEqual([]);
  });

  it('marks edges dropped in a later session as deprecated with last_asserted_in = earlier session', () => {
    const s1 = session({
      session_id: 's1',
      analyzed_at: '2026-01-01T00:00:00Z',
      concepts: [
        concept({ slug: 'child', name: 'Child', depends_on: ['parent'] }),
        concept({ slug: 'parent', name: 'Parent' }),
      ],
    });
    const s2 = session({
      session_id: 's2',
      analyzed_at: '2026-02-01T00:00:00Z',
      // Edge to 'parent' is dropped in s2.
      concepts: [
        concept({ slug: 'child', name: 'Child', depends_on: [] }),
        concept({ slug: 'parent', name: 'Parent' }),
      ],
    });
    const view = mergeSessions([s1, s2]);
    const child = view.concepts.get('child')!;
    expect(child.depends_on).toHaveLength(1);
    expect(child.depends_on[0]).toEqual({
      slug: 'parent',
      status: 'deprecated',
      last_asserted_in: 's1',
    });
    // Deprecated edge must NOT appear in parent.depended_on_by.
    expect(view.concepts.get('parent')!.depended_on_by).toEqual([]);
  });

  it('attaches unknowns to the concept they reference', () => {
    const u: Unknown = {
      slug_ref: 'a',
      question: 'why?',
      recovery_prompt: 'ask user',
    };
    const s1 = session({
      session_id: 's1',
      analyzed_at: '2026-01-01T00:00:00Z',
      concepts: [concept({ slug: 'a', name: 'A' })],
      unknowns: [u],
    });
    const view = mergeSessions([s1]);
    expect(view.concepts.get('a')!.unknowns).toEqual([u]);
  });
});
