import { describe, it, expect } from 'vitest';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { ExpectedSchema } from './expected-schema.js';
import { scoreCase, aggregate, type CaseMetrics } from './metrics.js';
import { maybeSnapshot } from './snapshot.js';
import type { IterationCaseRecord } from './snapshot.js';
import { analyzeSession, RefinerOutputSchema, type InvokeFn } from '../../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

interface Baseline {
  refiner_version: string;
  tolerance: { concept_recall_pct: number; schema_valid_pct: number; reasoning_preservation_pct: number };
  per_case: Array<Omit<CaseMetrics, 'elapsed_ms'>>;
}

async function loadBaseline(): Promise<Baseline | null> {
  const path = process.env['FOS_EVAL_BASELINE_PATH'] ?? join(here, 'baseline.json');
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as Baseline;
  } catch { return null; }
}

export function makeEvalInvoke(caseDir: string): InvokeFn {
  if (process.env['FOS_EVAL_REAL'] !== '1') {
    return async () => readFile(join(caseDir, 'cached-response.json'), 'utf8');
  }
  const provider = process.env['FOS_EVAL_PROVIDER'] ?? 'cli';
  if (provider === 'api') {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) throw new Error('FOS_EVAL_PROVIDER=api requires ANTHROPIC_API_KEY');
    const model = process.env['FOS_EVAL_MODEL'] ?? 'claude-sonnet-4-6';
    return async (args) => {
      const { makeApiInvoke } = await import('./api-invoke.js');
      return makeApiInvoke(apiKey, model)(args);
    };
  }
  return async ({ systemPrompt, userInput }) => {
    const { invokeClaude } = await import('../../src/refiner/invoke.js');
    return invokeClaude({ systemPrompt, userInput, claudeBin: 'claude', timeoutMs: 120_000 });
  };
}

const corpusDir = join(here, 'corpus');
const caseDirs = (await readdir(corpusDir, { withFileTypes: false }))
  .filter((n) => !n.startsWith('.'))
  .sort();

const caseMetrics: IterationCaseRecord[] = [];

function stripFences(s: string): string {
  const m = s.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  return m ? m[1]!.trim() : s.trim();
}

describe('golden corpus eval', () => {
  for (const name of caseDirs) {
    it(`scores case: ${name}`, async () => {
      const caseDir = join(corpusDir, name);
      const expected = ExpectedSchema.parse(
        JSON.parse(await readFile(join(caseDir, 'expected.json'), 'utf8')),
      );
      const transcript = join(caseDir, 'transcript.jsonl');

      const tmp = await mkdtemp(join(tmpdir(), `fos-eval-${name}-`));
      try {
        const invoke = makeEvalInvoke(caseDir);
        let rawRefinerResponse = '';
        const recordingInvoke: InvokeFn = async (args) => {
          const out = await invoke(args);
          rawRefinerResponse = out;
          return out;
        };

        await analyzeSession({
          projectRoot: tmp,
          transcriptPath: transcript,
          sessionId: name,
          now: () => new Date('2026-04-21T00:00:00Z'),
          invoke: recordingInvoke,
        });

        let parsedActual: { concepts: []; unknowns: [] } | ReturnType<typeof RefinerOutputSchema.parse> = { concepts: [], unknowns: [] };
        let schemaValid = false;
        try {
          const parseResult = RefinerOutputSchema.safeParse(JSON.parse(stripFences(rawRefinerResponse)));
          if (parseResult.success) {
            parsedActual = parseResult.data;
            schemaValid = true;
          }
        } catch {
          schemaValid = false;
        }

        const base = scoreCase(name, expected, parsedActual);
        const metric: IterationCaseRecord = { ...base, schema_valid: schemaValid, raw_response: rawRefinerResponse };
        caseMetrics.push(metric);

        expect(metric.forbidden_slug_violations).toBe(0);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  }

  it('aggregate report + baseline regression check', async () => {
    const agg = aggregate(caseMetrics);
    await maybeSnapshot(caseMetrics, agg);

    if (process.env['FOS_EVAL_MODE'] === 'snapshot-delta') {
      const { writeIterationDelta } = await import('./snapshot.js');
      const { createHash } = await import('node:crypto');
      const promptPath = join(here, '..', '..', 'prompts', 'refiner-v1.md');
      const promptText = await readFile(promptPath, 'utf8');
      const refinerHash = `sha256:${createHash('sha256').update(promptText).digest('hex')}`;
      const mode: 'cached' | 'real' = process.env['FOS_EVAL_REAL'] === '1' ? 'real' : 'cached';
      const provider: 'cli' | 'api' = process.env['FOS_EVAL_PROVIDER'] === 'api' ? 'api' : 'cli';
      const model = process.env['FOS_EVAL_MODEL'] ?? 'claude-sonnet-4-6';
      await writeIterationDelta({
        targetDir: join(here, 'iterations'),
        refinerHash,
        mode,
        provider,
        model,
        metrics: caseMetrics,
        aggregate: agg,
      });
      console.log('wrote iteration delta');
    }

    const baseline = await loadBaseline();

    console.log('\n=== eval aggregate ===');
    console.log(JSON.stringify(agg, null, 2));

    if (process.env['FOS_EVAL_MODE'] === 'snapshot') {
      // In snapshot mode, baseline was just written; skip regression check.
      return;
    }
    if (process.env['FOS_EVAL_MODE'] === 'snapshot-delta') {
      // Delta mode: per-iteration log written; skip regression check.
      return;
    }

    if (!baseline) {
      console.log('(no baseline.json yet — run `pnpm eval --snapshot` to create one)');
      return;
    }

    const tol = baseline.tolerance;
    const failures: string[] = [];

    for (const current of caseMetrics) {
      const prior = baseline.per_case.find((b) => b.slug === current.slug);
      if (!prior) continue;
      if (prior.concept_recall - current.concept_recall > tol.concept_recall_pct) {
        failures.push(`${current.slug}: recall regressed ${prior.concept_recall.toFixed(2)} → ${current.concept_recall.toFixed(2)}`);
      }
      if (Number(prior.schema_valid) - Number(current.schema_valid) > tol.schema_valid_pct) {
        failures.push(`${current.slug}: schema_valid regressed`);
      }
      if (prior.reasoning_preservation - current.reasoning_preservation > tol.reasoning_preservation_pct) {
        console.warn(`  advisory: ${current.slug}: reasoning_preservation ${prior.reasoning_preservation.toFixed(2)} → ${current.reasoning_preservation.toFixed(2)}`);
      }
    }

    if (failures.length > 0) {
      throw new Error('Regression vs baseline.json:\n' + failures.join('\n'));
    }
  });
});

describe('makeEvalInvoke — provider switching', () => {
  const originalEnv = { ...process.env };
  const afterEachCleanup = () => { process.env = { ...originalEnv }; };

  it('uses cached mode when FOS_EVAL_REAL is not set', () => {
    delete process.env['FOS_EVAL_REAL'];
    delete process.env['FOS_EVAL_PROVIDER'];
    const invoke = makeEvalInvoke('/tmp/nonexistent-case-dir');
    expect(typeof invoke).toBe('function');
    afterEachCleanup();
  });

  it('uses api provider when FOS_EVAL_PROVIDER=api + ANTHROPIC_API_KEY set', () => {
    process.env['FOS_EVAL_REAL'] = '1';
    process.env['FOS_EVAL_PROVIDER'] = 'api';
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-placeholder';
    const invoke = makeEvalInvoke('/tmp/nonexistent-case-dir');
    expect(typeof invoke).toBe('function');
    afterEachCleanup();
  });

  it('throws when api provider is selected without ANTHROPIC_API_KEY', () => {
    process.env['FOS_EVAL_REAL'] = '1';
    process.env['FOS_EVAL_PROVIDER'] = 'api';
    delete process.env['ANTHROPIC_API_KEY'];
    expect(() => makeEvalInvoke('/tmp/nonexistent-case-dir')).toThrow(/ANTHROPIC_API_KEY/);
    afterEachCleanup();
  });

  it('uses cli provider when FOS_EVAL_REAL=1 and no provider set', () => {
    process.env['FOS_EVAL_REAL'] = '1';
    delete process.env['FOS_EVAL_PROVIDER'];
    const invoke = makeEvalInvoke('/tmp/nonexistent-case-dir');
    expect(typeof invoke).toBe('function');
    afterEachCleanup();
  });
});
