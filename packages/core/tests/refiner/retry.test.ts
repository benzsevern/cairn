import { describe, it, expect, vi } from 'vitest';
import { refineWithRetry, RefinerFailure } from '../../src/refiner/retry.js';

describe('refineWithRetry', () => {
  const systemPrompt = 'SYS';
  const validJson = JSON.stringify({
    concepts: [{ slug: 'x', name: 'X', kind: 'introduced', summary: 's', reasoning: [], depends_on: [], files: [], transcript_refs: [], confidence: 'high' }],
    unknowns: [],
  });

  it('succeeds on first try', async () => {
    const invoke = vi.fn().mockResolvedValue(validJson);
    const out = await refineWithRetry({
      systemPrompt,
      userInput: 'PAYLOAD',
      existingSlugs: new Set(),
      maxAttempts: 3,
      invoke,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(out.concepts[0]?.slug).toBe('x');
  });

  it('retries after malformed JSON, appends critique, then succeeds', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce('this is not json')
      .mockResolvedValueOnce(validJson);
    const out = await refineWithRetry({
      systemPrompt,
      userInput: 'PAYLOAD',
      existingSlugs: new Set(),
      maxAttempts: 3,
      invoke,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    const secondCall = invoke.mock.calls[1]![0] as { userInput: string };
    expect(secondCall.userInput).toContain('Your previous response failed to parse');
    expect(out.concepts).toHaveLength(1);
  });

  it('retries after schema violation with schema-specific critique', async () => {
    const badKind = JSON.stringify({
      concepts: [{ slug: 'x', name: 'X', kind: 'nonsense', summary: 's', reasoning: [], depends_on: [], files: [], transcript_refs: [], confidence: 'high' }],
      unknowns: [],
    });
    const invoke = vi.fn().mockResolvedValueOnce(badKind).mockResolvedValueOnce(validJson);
    await refineWithRetry({
      systemPrompt,
      userInput: 'PAYLOAD',
      existingSlugs: new Set(),
      maxAttempts: 3,
      invoke,
    });
    const secondCall = invoke.mock.calls[1]![0] as { userInput: string };
    expect(secondCall.userInput).toMatch(/schema/i);
  });

  it('retries after semantic violation (dangling depends_on)', async () => {
    const dangling = JSON.stringify({
      concepts: [{ slug: 'x', name: 'X', kind: 'introduced', summary: 's', reasoning: [], depends_on: ['ghost'], files: [], transcript_refs: [], confidence: 'high' }],
      unknowns: [],
    });
    const invoke = vi.fn().mockResolvedValueOnce(dangling).mockResolvedValueOnce(validJson);
    await refineWithRetry({
      systemPrompt,
      userInput: 'PAYLOAD',
      existingSlugs: new Set(),
      maxAttempts: 3,
      invoke,
    });
    const secondCall = invoke.mock.calls[1]![0] as { userInput: string };
    expect(secondCall.userInput).toContain("depends_on 'ghost'");
  });

  it('throws RefinerFailure after maxAttempts failures', async () => {
    const invoke = vi.fn().mockResolvedValue('garbage');
    await expect(
      refineWithRetry({
        systemPrompt,
        userInput: 'PAYLOAD',
        existingSlugs: new Set(),
        maxAttempts: 2,
        invoke,
      }),
    ).rejects.toBeInstanceOf(RefinerFailure);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
