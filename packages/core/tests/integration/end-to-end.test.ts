import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../src/cli/commands/init.js';
import { analyzeSession } from '../../src/analyze-session.js';
import { rebuildProjectView } from '../../src/rebuild-project-view.js';
import { readManifest } from '../../src/writer/manifest.js';
import {
  sessionsDir,
  conceptFilePath,
  graphJsonPath,
  graphHtmlPath,
} from '../../src/paths.js';
import type { InvokeFn } from '../../src/refiner/index.js';

const FIXTURE_INTRODUCE = [
  {
    type: 'user',
    timestamp: '2026-04-18T10:00:00Z',
    message: { role: 'user', content: 'Build a fuzzy matcher for company names.' },
  },
  {
    type: 'assistant',
    timestamp: '2026-04-18T10:00:05Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: "I'll implement a Levenshtein-based matcher. I chose Levenshtein over Jaro-Winkler because our inputs are short and we want simple insertion/deletion costs. Rejected using cosine similarity because our strings are too short.",
        },
      ],
    },
  },
]
  .map((e) => JSON.stringify(e))
  .join('\n');

const FIXTURE_REFINE = [
  {
    type: 'user',
    timestamp: '2026-04-19T10:00:00Z',
    message: { role: 'user', content: 'Tune the fuzzy matcher threshold — too many false positives.' },
  },
  {
    type: 'assistant',
    timestamp: '2026-04-19T10:00:05Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: "Raising threshold from 0.70 to 0.82 based on observed FP rate. Also normalizing case and stripping corporate suffixes before scoring.",
        },
      ],
    },
  },
]
  .map((e) => JSON.stringify(e))
  .join('\n');

const fakeRefinerThatIntroducesFuzzy: InvokeFn = async () =>
  JSON.stringify({
    concepts: [
      {
        slug: 'fuzzy-matching',
        name: 'Fuzzy matching',
        kind: 'introduced',
        summary: 'Levenshtein-based company name matcher.',
        reasoning: [
          'Chose Levenshtein over Jaro-Winkler because inputs are short',
          'Rejected cosine similarity because strings are too short',
        ],
        depends_on: [],
        files: ['src/match.ts'],
        transcript_refs: [],
        confidence: 'high',
      },
    ],
    unknowns: [],
  });

const fakeRefinerThatReusesFuzzy: InvokeFn = async () =>
  JSON.stringify({
    concepts: [
      {
        slug: 'fuzzy-matching',
        name: 'Fuzzy matching',
        kind: 'refined',
        summary: 'Threshold tuned to 0.82 with normalization preprocessing.',
        reasoning: [
          'Raised threshold from 0.70 to 0.82 to reduce false positives',
          'Added case normalization and corporate-suffix stripping',
        ],
        depends_on: [],
        files: ['src/match.ts'],
        transcript_refs: [],
        confidence: 'high',
      },
    ],
    unknowns: [],
  });

describe('end-to-end pipeline', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-e2e-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('two sessions produce a project view with canonical slug reuse and graph.html', async () => {
    // init
    await runInit({ projectRoot: tmp });

    // Write the two transcript fixtures into tmp
    const introducePath = join(tmp, 'introduce.jsonl');
    const refinePath = join(tmp, 'refine.jsonl');
    await writeFile(introducePath, FIXTURE_INTRODUCE, 'utf8');
    await writeFile(refinePath, FIXTURE_REFINE, 'utf8');

    // Session 1 — introduces "fuzzy-matching"
    const s1 = await analyzeSession({
      projectRoot: tmp,
      transcriptPath: introducePath,
      sessionId: 'sess-1',
      model: 'claude-sonnet-4-6',
      now: () => new Date('2026-04-18T10:00:00.000Z'),
      invoke: fakeRefinerThatIntroducesFuzzy,
    });
    expect(s1.refiner_version).toBe('v1.0.0');

    // Session 2 — refines "fuzzy-matching" (same slug, kind: refined)
    const s2 = await analyzeSession({
      projectRoot: tmp,
      transcriptPath: refinePath,
      sessionId: 'sess-2',
      model: 'claude-sonnet-4-6',
      now: () => new Date('2026-04-19T10:00:00.000Z'),
      invoke: fakeRefinerThatReusesFuzzy,
    });
    expect(s2.refiner_version).toBe('v1.0.0');

    // Rebuild
    await rebuildProjectView({
      projectRoot: tmp,
      now: () => new Date('2026-04-19T12:00:00.000Z'),
    });

    // Two session markdown files exist
    const sessionFiles = (await readdir(sessionsDir(tmp))).sort();
    expect(sessionFiles).toEqual([
      '2026-04-18-sess-1.md',
      '2026-04-19-sess-2.md',
    ]);

    // concepts/fuzzy-matching.md exists with History containing both entries
    const conceptText = await readFile(conceptFilePath(tmp, 'fuzzy-matching'), 'utf8');
    expect(conceptText).toContain('## History');
    expect(conceptText).toContain('**2026-04-18**');
    expect(conceptText).toContain('**2026-04-19**');
    expect(conceptText).toContain('(introduced)');
    expect(conceptText).toContain('(refined)');

    // graph.json has 1 node and 0 edges
    const graph = JSON.parse(await readFile(graphJsonPath(tmp), 'utf8')) as {
      nodes: Array<{ slug: string }>;
      edges: unknown[];
      project_view_version: number;
    };
    expect(graph.nodes.map((n) => n.slug)).toEqual(['fuzzy-matching']);
    expect(graph.edges).toEqual([]);

    // graph.html exists and embeds fos-graph-data
    const html = await readFile(graphHtmlPath(tmp), 'utf8');
    expect(html).toContain('<script id="fos-graph-data"');
    expect(html).toContain('fuzzy-matching');

    // manifest project_view_version incremented to 1
    const manifest = await readManifest(tmp);
    expect(manifest.project_view_version).toBe(1);
    expect(manifest.refiner_version).toBe('v1.0.0');
  });
});
