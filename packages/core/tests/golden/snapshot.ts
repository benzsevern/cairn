import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaseMetrics, Aggregate } from './metrics.js';
import { SHIPPED_REFINER_VERSION } from '../../src/refiner/load-prompt.js';

export interface IterationCaseRecord extends CaseMetrics {
  raw_response?: string;
}

export interface IterationDeltaArgs {
  targetDir: string;
  refinerHash: string;
  mode: 'cached' | 'real';
  provider: 'cli' | 'api';
  model: string;
  metrics: IterationCaseRecord[];
  aggregate: Aggregate;
}

export async function writeIterationDelta(args: IterationDeltaArgs): Promise<string> {
  await mkdir(args.targetDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const shortHash = args.refinerHash.replace('sha256:', '').slice(0, 12);
  const filename = `${ts}-${shortHash}.json`;
  const path = join(args.targetDir, filename);
  const payload = {
    written_at: new Date().toISOString(),
    refiner_hash: args.refinerHash,
    mode: args.mode,
    provider: args.provider,
    model: args.model,
    aggregate: args.aggregate,
    per_case: args.metrics,
  };
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
  return path;
}

export async function maybeSnapshot(cases: CaseMetrics[], agg: Aggregate): Promise<void> {
  if (process.env['FOS_EVAL_MODE'] !== 'snapshot') return;
  const here = dirname(fileURLToPath(import.meta.url));
  const refinerPromptPath = join(here, '..', '..', 'prompts', 'refiner-v1.1.md');
  const refinerText = await readFile(refinerPromptPath, 'utf8');
  const { createHash } = await import('node:crypto');
  const refinerHash = `sha256:${createHash('sha256').update(refinerText).digest('hex')}`;

  const baseline = {
    generated_at: new Date().toISOString(),
    refiner_version: SHIPPED_REFINER_VERSION,
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
