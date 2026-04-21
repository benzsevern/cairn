import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeIterationDelta } from './snapshot.js';

describe('writeIterationDelta', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'fos-iter-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('writes a timestamped + hashed JSON file under iterations/', async () => {
    await writeIterationDelta({
      targetDir: tmp,
      refinerHash: 'sha256:abc1234567890def',
      mode: 'real',
      provider: 'api',
      model: 'claude-sonnet-4-6',
      metrics: [
        {
          slug: 'sess-01',
          tags: [],
          concept_recall: 0.8,
          slug_reuse_precision: null,
          reasoning_preservation: 0.6,
          schema_valid: true,
          forbidden_slug_violations: 0,
          raw_response: '{"concepts":[],"unknowns":[]}',
        },
      ],
      aggregate: {
        concept_recall: { p50: 0.8, p25: 0.8, mean: 0.8 },
        slug_reuse_precision: { p50: 0, p25: 0, mean: 0, applicable_cases: 0 },
        reasoning_preservation: { p50: 0.6, p25: 0.6, mean: 0.6 },
        schema_valid_rate: 1,
        forbidden_violations: 0,
      },
    });
    const files = await readdir(tmp);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.*\.json$/);
    const parsed = JSON.parse(await readFile(join(tmp, files[0]!), 'utf8'));
    expect(parsed.refiner_hash).toBe('sha256:abc1234567890def');
    expect(parsed.mode).toBe('real');
    expect(parsed.provider).toBe('api');
    expect(parsed.aggregate.concept_recall.mean).toBe(0.8);
    expect(parsed.per_case[0].raw_response).toBe('{"concepts":[],"unknowns":[]}');
  });
});
