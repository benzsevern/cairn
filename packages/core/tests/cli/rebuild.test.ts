import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRebuild } from '../../src/cli/commands/rebuild.js';
import { runInit } from '../../src/cli/commands/init.js';
import { graphJsonPath, graphHtmlPath } from '../../src/paths.js';

describe('runRebuild', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-cli-rebuild-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('produces graph.json and graph.html with zero nodes for an empty .comprehension/', async () => {
    await runInit({ projectRoot: tmp });
    await runRebuild({ projectRoot: tmp, now: () => new Date('2026-04-20T00:00:00Z') });

    await stat(graphJsonPath(tmp));
    await stat(graphHtmlPath(tmp));
    const graph = JSON.parse(await readFile(graphJsonPath(tmp), 'utf8'));
    expect(graph.nodes).toEqual([]);
  });

  it('works without an init (rebuild creates outputs from an empty project)', async () => {
    // rebuild should succeed even without `init` having run — it operates on whatever sessions exist.
    await mkdir(join(tmp, '.comprehension', 'sessions'), { recursive: true });
    await runRebuild({ projectRoot: tmp, now: () => new Date('2026-04-20T00:00:00Z') });
    await stat(graphJsonPath(tmp));
    await stat(graphHtmlPath(tmp));
  });
});
