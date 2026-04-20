import { describe, it, expect } from 'vitest';
import { estimateCost, estimateTokens } from '../../src/cli/cost.js';

describe('estimator', () => {
  it('estimates ~1 token per 3.5 chars (English-ish)', () => {
    const chars = 35_000;
    expect(estimateTokens(chars)).toBeCloseTo(chars / 3.5, 0);
  });

  it('returns higher USD for opus than sonnet than haiku', () => {
    const tokens = 10_000;
    const opus = estimateCost(tokens, 'claude-opus-4-7');
    const sonnet = estimateCost(tokens, 'claude-sonnet-4-6');
    const haiku = estimateCost(tokens, 'claude-haiku-4-5');
    expect(opus.usd_high).toBeGreaterThan(sonnet.usd_high);
    expect(sonnet.usd_high).toBeGreaterThan(haiku.usd_high);
  });
});
