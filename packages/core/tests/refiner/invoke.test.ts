import { describe, it, expect, vi } from 'vitest';
import { invokeClaude } from '../../src/refiner/invoke.js';

describe('invokeClaude', () => {
  it('feeds the combined system prompt + input to the runner on stdin and returns stdout', async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: '{"ok":true}', stderr: '', exitCode: 0 });
    const out = await invokeClaude({
      systemPrompt: 'SYS',
      userInput: 'PAYLOAD',
      claudeBin: 'claude',
      runner,
      timeoutMs: 60_000,
    });
    expect(out).toBe('{"ok":true}');
    expect(runner).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', '--output-format', 'text']),
      expect.objectContaining({ input: expect.stringContaining('SYS') }),
    );
    const input = runner.mock.calls[0]![2].input as string;
    expect(input).toContain('SYS');
    expect(input).toContain('PAYLOAD');
  });

  it('throws a typed ClaudeInvokeError on nonzero exit', async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: '', stderr: 'oops', exitCode: 1 });
    await expect(
      invokeClaude({ systemPrompt: 's', userInput: 'p', claudeBin: 'claude', runner, timeoutMs: 1000 }),
    ).rejects.toThrow(/ClaudeInvokeError/);
  });

  it('throws ClaudeInvokeError on timeout rejection', async () => {
    const runner = vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { timedOut: true }));
    await expect(
      invokeClaude({ systemPrompt: 's', userInput: 'p', claudeBin: 'claude', runner, timeoutMs: 100 }),
    ).rejects.toThrow(/ClaudeInvokeError/);
  });
});
