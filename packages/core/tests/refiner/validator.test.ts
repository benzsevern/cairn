import { describe, it, expect } from 'vitest';
import { validateSemantic } from '../../src/refiner/validator.js';
import type { ValidatedRefinerOutput } from '../../src/refiner/schema.js';

const base: ValidatedRefinerOutput = {
  concepts: [
    {
      slug: 'fuzzy-matching',
      name: 'Fuzzy Matching',
      kind: 'introduced',
      summary: 's',
      reasoning: [],
      depends_on: [],
      files: [],
      transcript_refs: [],
      confidence: 'high',
    },
  ],
  unknowns: [],
};

describe('validateSemantic', () => {
  it('passes when depends_on references an output concept', () => {
    const out: ValidatedRefinerOutput = {
      concepts: [
        base.concepts[0]!,
        { ...base.concepts[0]!, slug: 'entity-resolution', name: 'ER', depends_on: ['fuzzy-matching'] },
      ],
      unknowns: [],
    };
    const issues = validateSemantic(out, new Set(['fuzzy-matching']));
    expect(issues).toEqual([]);
  });

  it('passes when depends_on references an existing-project concept', () => {
    const out: ValidatedRefinerOutput = {
      concepts: [{ ...base.concepts[0]!, depends_on: ['pre-existing'] }],
      unknowns: [],
    };
    const issues = validateSemantic(out, new Set(['pre-existing']));
    expect(issues).toEqual([]);
  });

  it('flags depends_on pointing at an unknown slug', () => {
    const out: ValidatedRefinerOutput = {
      concepts: [{ ...base.concepts[0]!, depends_on: ['ghost'] }],
      unknowns: [],
    };
    const issues = validateSemantic(out, new Set());
    expect(issues).toEqual([expect.stringContaining("depends_on 'ghost'")]);
  });

  it('flags an unknown.slug_ref pointing at nothing', () => {
    const out: ValidatedRefinerOutput = {
      concepts: [base.concepts[0]!],
      unknowns: [{ slug_ref: 'nonexistent', question: 'q', recovery_prompt: 'r' }],
    };
    const issues = validateSemantic(out, new Set());
    expect(issues).toEqual([expect.stringContaining("unknown.slug_ref 'nonexistent'")]);
  });

  it('allows slug_ref = null on unknowns', () => {
    const out: ValidatedRefinerOutput = {
      concepts: [],
      unknowns: [{ slug_ref: null, question: 'q', recovery_prompt: 'r' }],
    };
    expect(validateSemantic(out, new Set())).toEqual([]);
  });

  it('flags duplicate slugs within one response', () => {
    const out: ValidatedRefinerOutput = {
      concepts: [base.concepts[0]!, base.concepts[0]!],
      unknowns: [],
    };
    const issues = validateSemantic(out, new Set());
    expect(issues).toEqual([expect.stringContaining('duplicate slug')]);
  });
});
