import { writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaseMetrics, Aggregate } from './metrics.js';

export async function maybeSnapshot(cases: CaseMetrics[], agg: Aggregate): Promise<void> {
  if (process.env['FOS_EVAL_MODE'] !== 'snapshot') return;
  const here = dirname(fileURLToPath(import.meta.url));
  const refinerPromptPath = join(here, '..', '..', 'prompts', 'refiner-v1.md');
  const refinerText = await readFile(refinerPromptPath, 'utf8');
  const { createHash } = await import('node:crypto');
  const refinerHash = `sha256:${createHash('sha256').update(refinerText).digest('hex')}`;

  const baseline = {
    generated_at: new Date().toISOString(),
    refiner_version: 'v1.0.0',
    refiner_prompt_hash: refinerHash,
    mode: process.env['FOS_EVAL_REAL'] === '1' ? 'real' : 'cached',
    corpus_size: cases.length,
    tolerance: {
      concept_recall_pct: 0.05,
      schema_valid_pct: 0.02,
      reasoning_preservation_pct: 0.10,
    },
    aggregate: agg,
    per_case: cases.map((c) => {
      const { elapsed_ms: _elapsed, ...rest } = c;
      return rest;
    }),
  };
  await writeFile(join(here, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  console.log('wrote baseline.json');
}
