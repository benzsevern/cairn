import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSessions } from '../../src/backfill.js';

describe('discoverSessions', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-discover-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns [] when project hash directory does not exist', async () => {
    const r = await discoverSessions(tmp, 'nonexistent-hash');
    expect(r).toEqual([]);
  });

  it('discovers .jsonl files, sorted by mtime ascending', async () => {
    const hashDir = join(tmp, 'proj-abc');
    await mkdir(hashDir, { recursive: true });
    const a = join(hashDir, 'sess-a.jsonl');
    const b = join(hashDir, 'sess-b.jsonl');
    const c = join(hashDir, 'not-a-transcript.txt');
    await writeFile(a, 'a-content');
    await writeFile(b, 'b-content-longer');
    await writeFile(c, 'ignore me');
    // Force b to be older than a.
    const older = new Date('2026-01-01T00:00:00Z');
    const newer = new Date('2026-02-01T00:00:00Z');
    await utimes(b, older, older);
    await utimes(a, newer, newer);

    const r = await discoverSessions(tmp, 'proj-abc');
    expect(r.map((d) => d.sessionId)).toEqual(['sess-b', 'sess-a']);
    expect(r[0]?.transcriptPath).toBe(b);
    expect(r[0]?.sizeBytes).toBeGreaterThan(0);
    expect(r[1]?.analyzedAt).toBe(newer.toISOString());
  });

  it('ignores non-jsonl entries', async () => {
    const hashDir = join(tmp, 'proj-xyz');
    await mkdir(hashDir, { recursive: true });
    await writeFile(join(hashDir, 'foo.txt'), 'x');
    await writeFile(join(hashDir, 'bar.json'), 'x');
    const r = await discoverSessions(tmp, 'proj-xyz');
    expect(r).toEqual([]);
  });
});
