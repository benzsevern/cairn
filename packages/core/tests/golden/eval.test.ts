import { describe, it, expect } from 'vitest';
import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeSession, rebuildProjectView } from '../../src/index.js';
import type { InvokeFn } from '../../src/refiner/index.js';

const here = dirname(fileURLToPath(import.meta.url));

interface Expected {
  required_slugs: string[];
  slug_reuse_context: string[];
  required_reasoning_substrings: Record<string, string[]>;
  forbidden_slugs: string[];
}

async function loadCase(dir: string): Promise<{ transcript: string; expected: Expected }> {
  const transcript = join(dir, 'transcript.jsonl');
  const expected = JSON.parse(await readFile(join(dir, 'expected.json'), 'utf8')) as Expected;
  return { transcript, expected };
}

/**
 * Eval invoke: shells out to the real `claude -p` only when FOS_EVAL_REAL=1.
 * Otherwise, reads a cached response from the case dir (keeps CI deterministic
 * and cheap; manual `pnpm eval` runs against the real model).
 */
function makeEvalInvoke(caseDir: string): InvokeFn {
  if (process.env['FOS_EVAL_REAL'] === '1') {
    return async ({ systemPrompt, userInput }) => {
      const { invokeClaude } = await import('../../src/refiner/invoke.js');
      return invokeClaude({ systemPrompt, userInput, claudeBin: 'claude', timeoutMs: 120_000 });
    };
  }
  return async () => readFile(join(caseDir, 'cached-response.json'), 'utf8');
}

function extractConceptSection(md: string, slug: string): string {
  const start = md.indexOf(`{#${slug}}`);
  if (start === -1) return '';
  const nextHeader = md.indexOf('\n## ', start + 1);
  return nextHeader === -1 ? md.slice(start) : md.slice(start, nextHeader);
}

describe('golden corpus eval', async () => {
  const corpusDir = join(here, 'corpus');
  const cases = (await readdir(corpusDir)).filter((n) => !n.startsWith('.'));

  for (const name of cases) {
    const caseDir = join(corpusDir, name);
    const { transcript, expected } = await loadCase(caseDir);

    it(`case ${name}: required slugs appear`, async () => {
      const tmp = await mkdtemp(join(tmpdir(), 'fos-eval-'));
      try {
        const invoke = makeEvalInvoke(caseDir);
        await analyzeSession({
          projectRoot: tmp,
          transcriptPath: transcript,
          sessionId: name,
          now: () => new Date('2026-04-20T00:00:00Z'),
          invoke,
        });
        await rebuildProjectView({ projectRoot: tmp, now: () => new Date('2026-04-20T00:00:00Z') });

        const sessionFiles = await readdir(join(tmp, '.comprehension/sessions'));
        const md = await readFile(join(tmp, '.comprehension/sessions', sessionFiles[0]!), 'utf8');

        for (const slug of expected.required_slugs) {
          expect(md).toContain(`{#${slug}}`);
        }
        for (const slug of expected.forbidden_slugs) {
          expect(md).not.toContain(`{#${slug}}`);
        }
        for (const [slug, substrings] of Object.entries(expected.required_reasoning_substrings)) {
          const conceptSection = extractConceptSection(md, slug);
          for (const sub of substrings) {
            expect(conceptSection.toLowerCase()).toContain(sub.toLowerCase());
          }
        }
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  }
});
