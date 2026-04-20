import { describe, it, expect } from 'vitest';
import { RefinerOutputSchema } from '../../src/refiner/schema.js';

const valid = {
  concepts: [
    {
      slug: 'fuzzy-matching',
      name: 'Fuzzy Matching',
      kind: 'introduced',
      summary: 'Levenshtein approximate matching.',
      reasoning: ['Chose Levenshtein because X.'],
      depends_on: ['entity-resolution'],
      files: ['src/matching/fuzzy.ts'],
      transcript_refs: [12, 14],
      confidence: 'high',
    },
  ],
  unknowns: [],
};

describe('RefinerOutputSchema', () => {
  it('accepts a well-formed output', () => {
    const parsed = RefinerOutputSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('rejects kind outside enum', () => {
    const bad = { ...valid, concepts: [{ ...valid.concepts[0]!, kind: 'nonsense' }] };
    expect(RefinerOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects non-integer transcript_refs', () => {
    const bad = { ...valid, concepts: [{ ...valid.concepts[0]!, transcript_refs: [12.5] }] };
    expect(RefinerOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const missing = { concepts: [{}], unknowns: [] };
    expect(RefinerOutputSchema.safeParse(missing).success).toBe(false);
  });

  it('rejects empty slug', () => {
    const bad = { ...valid, concepts: [{ ...valid.concepts[0]!, slug: '' }] };
    expect(RefinerOutputSchema.safeParse(bad).success).toBe(false);
  });
});
