import type { Expected } from './expected-schema.js';
import type { ValidatedRefinerOutput } from '../../src/index.js';

export interface CaseMetrics {
  slug: string;
  tags: string[];
  concept_recall: number;
  slug_reuse_precision: number | null;
  reasoning_preservation: number;
  schema_valid: boolean;
  forbidden_slug_violations: number;
  elapsed_ms?: number;
}

export function scoreCase(
  caseName: string,
  expected: Expected,
  actual: ValidatedRefinerOutput,
): Omit<CaseMetrics, 'elapsed_ms'> {
  const actualSlugs = new Set(actual.concepts.map((c) => c.slug));

  const recall = expected.required_slugs.length === 0
    ? 1
    : expected.required_slugs.filter((s) => actualSlugs.has(s)).length / expected.required_slugs.length;

  const contextRelevant = expected.slug_reuse_context.filter((s) => expected.required_slugs.includes(s));
  const slug_reuse_precision = contextRelevant.length === 0
    ? null
    : contextRelevant.filter((s) => actualSlugs.has(s)).length / contextRelevant.length;

  let total = 0, matched = 0;
  for (const [slug, substrings] of Object.entries(expected.required_reasoning_substrings)) {
    const concept = actual.concepts.find((c) => c.slug === slug);
    const body = concept ? [concept.summary, ...concept.reasoning].join(' ').toLowerCase() : '';
    for (const s of substrings) {
      total += 1;
      if (body.includes(s.toLowerCase())) matched += 1;
    }
  }
  const reasoning_preservation = total === 0 ? 1 : matched / total;

  const forbidden_slug_violations = expected.forbidden_slugs.filter((s) => actualSlugs.has(s)).length;

  return {
    slug: caseName,
    tags: expected.tags,
    concept_recall: recall,
    slug_reuse_precision,
    reasoning_preservation,
    schema_valid: true,
    forbidden_slug_violations,
  };
}

export interface Aggregate {
  concept_recall: { p50: number; p25: number; mean: number };
  slug_reuse_precision: { p50: number; p25: number; mean: number; applicable_cases: number };
  reasoning_preservation: { p50: number; p25: number; mean: number };
  schema_valid_rate: number;
  forbidden_violations: number;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export function aggregate(cases: CaseMetrics[]): Aggregate {
  const recalls = cases.map((c) => c.concept_recall);
  const reuseApplicable = cases.filter((c) => c.slug_reuse_precision !== null);
  const reuses = reuseApplicable.map((c) => c.slug_reuse_precision as number);
  const reasonings = cases.map((c) => c.reasoning_preservation);
  return {
    concept_recall: {
      p50: percentile(recalls, 0.5),
      p25: percentile(recalls, 0.25),
      mean: recalls.reduce((a, b) => a + b, 0) / (recalls.length || 1),
    },
    slug_reuse_precision: {
      p50: percentile(reuses, 0.5),
      p25: percentile(reuses, 0.25),
      mean: reuses.reduce((a, b) => a + b, 0) / (reuses.length || 1),
      applicable_cases: reuseApplicable.length,
    },
    reasoning_preservation: {
      p50: percentile(reasonings, 0.5),
      p25: percentile(reasonings, 0.25),
      mean: reasonings.reduce((a, b) => a + b, 0) / (reasonings.length || 1),
    },
    schema_valid_rate: cases.filter((c) => c.schema_valid).length / (cases.length || 1),
    forbidden_violations: cases.reduce((a, c) => a + c.forbidden_slug_violations, 0),
  };
}
