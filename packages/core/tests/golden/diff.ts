import { readFile } from 'node:fs/promises';
import type { CaseMetrics } from './metrics.js';

interface BaselineFile {
  per_case: Array<Omit<CaseMetrics, 'elapsed_ms'>>;
}

/**
 * Diff two baseline.json files at the per-case level. Prints a markdown table
 * of changed cases to stdout. Returns the number of changed cases.
 */
export async function diffBaselines(priorPath: string, currentPath: string): Promise<number> {
  const prior = JSON.parse(await readFile(priorPath, 'utf8')) as BaselineFile;
  const current = JSON.parse(await readFile(currentPath, 'utf8')) as BaselineFile;

  const priorMap = new Map(prior.per_case.map((c) => [c.slug, c]));
  const rows: Array<[string, string, string, string]> = [];

  for (const cur of current.per_case) {
    const p = priorMap.get(cur.slug);
    if (!p) {
      rows.push([cur.slug, 'new', cur.concept_recall.toFixed(2), cur.reasoning_preservation.toFixed(2)]);
      continue;
    }
    const recallDelta = cur.concept_recall - p.concept_recall;
    const reasoningDelta = cur.reasoning_preservation - p.reasoning_preservation;
    const schemaDelta = Number(cur.schema_valid) - Number(p.schema_valid);
    if (recallDelta !== 0 || reasoningDelta !== 0 || schemaDelta !== 0) {
      rows.push([
        cur.slug,
        'changed',
        `${p.concept_recall.toFixed(2)} → ${cur.concept_recall.toFixed(2)}`,
        `${p.reasoning_preservation.toFixed(2)} → ${cur.reasoning_preservation.toFixed(2)}`,
      ]);
    }
  }

  if (rows.length === 0) {
    console.log('all cases unchanged vs prior baseline.');
    return 0;
  }

  console.log('\n| case | status | recall | reasoning |');
  console.log('| --- | --- | --- | --- |');
  for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`);
  return rows.length;
}
