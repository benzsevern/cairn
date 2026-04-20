const PRICING = {
  'claude-opus-4-7': { in: 15, out: 75 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 0.8, out: 4 },
} as const;
export type ModelTier = keyof typeof PRICING;

export function estimateTokens(chars: number): number {
  return chars / 3.5;
}

export function estimateCost(
  inputTokens: number,
  model: string,
): { usd_low: number; usd_high: number; model_tier: string } {
  const tier =
    (PRICING as Record<string, { in: number; out: number }>)[model] ?? PRICING['claude-sonnet-4-6'];
  // Assume output ~1/5 of input for this task shape.
  const outTokens = inputTokens / 5;
  const usd = (inputTokens * tier.in + outTokens * tier.out) / 1_000_000;
  return { usd_low: usd * 0.8, usd_high: usd * 1.3, model_tier: model };
}
