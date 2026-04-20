import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir, writeFile, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backfill, discoverSessions, type DiscoveredSession } from '../../src/backfill.js';
import { readManifest } from '../../src/writer/manifest.js';
import { sessionsDir } from '../../src/paths.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRANSCRIPT_FIXTURE = join(HERE, '..', 'fixtures', 'transcripts', 'minimal.jsonl');

const goodRefinerJson = JSON.stringify({
  concepts: [
    {
      slug: 'concept-a',
      name: 'Concept A',
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
});

async function makeDiscovered(
  claudeDir: string,
  projectHash: string,
  ids: string[],
): Promise<DiscoveredSession[]> {
  const dir = join(claudeDir, projectHash);
  await mkdir(dir, { recursive: true });
  let t = new Date('2026-04-01T00:00:00Z').getTime();
  for (const id of ids) {
    const p = join(dir, `${id}.jsonl`);
    // Copy fixture content into the "transcript" files used by analyzeSession.
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(TRANSCRIPT_FIXTURE, 'utf8');
    await writeFile(p, content);
    const d = new Date(t);
    await utimes(p, d, d);
    t += 1000;
  }
  return discoverSessions(claudeDir, projectHash);
}

describe('backfill runner', () => {
  let tmp: string;
  let claude: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-backfill-run-'));
    claude = await mkdtemp(join(tmpdir(), 'fos-claude-proj-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
    await rm(claude, { recursive: true, force: true });
  });

  it('returns { analyzed: 0 } and touches nothing when confirm returns false', async () => {
    const discovered = await makeDiscovered(claude, 'p1', ['s1', 's2']);
    const invoke = vi.fn().mockResolvedValue(goodRefinerJson);
    const report = await backfill({
      projectRoot: tmp,
      discovered,
      model: 'claude-sonnet-4-6',
      confirm: async () => false,
      invoke,
      now: () => new Date('2026-04-20T00:00:00Z'),
    });
    expect(report.analyzed).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
    // sessions dir should not exist or should be empty
    let names: string[] = [];
    try {
      names = await readdir(sessionsDir(tmp));
    } catch {
      /* ok — not created */
    }
    expect(names).toEqual([]);
  });

  it('with confirm=true, analyzes all discovered sessions serially', async () => {
    const discovered = await makeDiscovered(claude, 'p2', ['s1', 's2', 's3']);
    const invoke = vi.fn().mockResolvedValue(goodRefinerJson);
    const report = await backfill({
      projectRoot: tmp,
      discovered,
      model: 'claude-sonnet-4-6',
      confirm: async () => true,
      invoke,
      now: () => new Date('2026-04-20T00:00:00Z'),
    });
    expect(report.analyzed).toBe(3);
    expect(report.failed).toEqual([]);
    const files = await readdir(sessionsDir(tmp));
    expect(files.length).toBe(3);
    const m = await readManifest(tmp);
    expect(m.opt_in.backfill_completed).toBe(true);
    expect(m.opt_in.backfilled_session_count).toBe(3);
  });

  it('records failures but keeps successful sessions committed', async () => {
    const discovered = await makeDiscovered(claude, 'p3', ['s1', 's2', 's3']);
    let call = 0;
    const invoke = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 2) throw new Error('boom');
      return goodRefinerJson;
    });
    const report = await backfill({
      projectRoot: tmp,
      discovered,
      model: 'claude-sonnet-4-6',
      confirm: async () => true,
      invoke,
      now: () => new Date('2026-04-20T00:00:00Z'),
    });
    expect(report.analyzed).toBe(2);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.session_id).toBe('s2');
    const files = await readdir(sessionsDir(tmp));
    // 2 committed session artifacts + 1 failed stub
    const artifacts = files.filter((f) => f.endsWith('.md'));
    expect(artifacts).toHaveLength(2);
  });

  it('respects AbortSignal — stops between sessions', async () => {
    const discovered = await makeDiscovered(claude, 'p4', ['s1', 's2', 's3']);
    const controller = new AbortController();
    let calls = 0;
    const invoke = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) controller.abort();
      return goodRefinerJson;
    });
    const report = await backfill({
      projectRoot: tmp,
      discovered,
      model: 'claude-sonnet-4-6',
      confirm: async () => true,
      invoke,
      signal: controller.signal,
      now: () => new Date('2026-04-20T00:00:00Z'),
    });
    expect(report.analyzed).toBe(1);
    expect(report.analyzed).toBeLessThan(discovered.length);
  });
});
