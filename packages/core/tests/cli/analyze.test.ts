import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAnalyze } from '../../src/cli/commands/analyze.js';
import { sessionFilePath } from '../../src/paths.js';

describe('runAnalyze', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-cli-analyze-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('runs analyze + rebuild end-to-end when given a transcript', async () => {
    const transcript = join(tmp, 't.jsonl');
    await writeFile(
      transcript,
      [
        JSON.stringify({
          type: 'user',
          timestamp: '2026-04-20T10:00:00Z',
          message: { role: 'user', content: 'hi' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-04-20T10:00:01Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        }),
      ].join('\n'),
    );

    const invoke = vi.fn().mockResolvedValue(
      JSON.stringify({
        concepts: [
          {
            slug: 'greeting',
            name: 'Greeting',
            kind: 'introduced',
            summary: 's',
            reasoning: [],
            depends_on: [],
            files: [],
            transcript_refs: [],
            confidence: 'high',
          },
        ],
        unknowns: [],
      }),
    );

    await runAnalyze({
      projectRoot: tmp,
      transcriptPath: transcript,
      sessionId: 'sess-1',
      now: () => new Date('2026-04-20T00:00:00Z'),
      invoke,
      skipRebuild: false,
    });

    await stat(sessionFilePath(tmp, 'sess-1', '2026-04-20'));
  });
});
