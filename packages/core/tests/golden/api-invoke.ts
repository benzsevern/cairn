import Anthropic from '@anthropic-ai/sdk';
import type { InvokeFn } from '../../src/index.js';

export function makeApiInvoke(apiKey: string, model = 'claude-sonnet-4-6'): InvokeFn {
  const client = new Anthropic({ apiKey });
  return async ({ systemPrompt, userInput }) => {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userInput }],
    });
    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error(`Anthropic API returned non-text content: ${block?.type ?? 'empty'}`);
    }
    return block.text;
  };
}
