import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readManifest, writeManifest, defaultManifest } from '../../src/writer/manifest.js';

describe('manifest', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'fos-manifest-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('returns defaultManifest when no file exists', async () => {
    const m = await readManifest(tmp);
    expect(m).toEqual(defaultManifest());
  });

  it('round-trips a manifest', async () => {
    const m = defaultManifest();
    m.refiner_version = 'v1.0.0';
    m.last_rebuild = '2026-04-20T10:00:00Z';
    m.opt_in.backfill_completed = true;
    m.opt_in.backfilled_session_count = 12;
    await writeManifest(tmp, m);
    const loaded = await readManifest(tmp);
    expect(loaded).toEqual(m);
  });

  it('increments project_view_version via helper', async () => {
    const m = defaultManifest();
    m.project_view_version = 5;
    await writeManifest(tmp, m);
    const again = await readManifest(tmp);
    again.project_view_version += 1;
    await writeManifest(tmp, again);
    const final = await readManifest(tmp);
    expect(final.project_view_version).toBe(6);
  });
});
