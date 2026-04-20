import { describe, it, expect } from 'vitest';
import { readTranscript } from '../../src/reader/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

describe('readTranscript — happy path', () => {
  it('parses a minimal two-event transcript', async () => {
    const path = resolve(here, '../fixtures/transcripts/minimal.jsonl');
    const events = await readTranscript(path);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: 'user',
      index: 0,
      text: 'Add a fuzzy matcher for company names.',
    });
    expect(events[1]).toMatchObject({
      kind: 'assistant',
      index: 1,
      text: expect.stringContaining('Levenshtein'),
    });
    expect(events[0]?.timestamp).toBe('2026-04-20T10:00:00Z');
  });
});
