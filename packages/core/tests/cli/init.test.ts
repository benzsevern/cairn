import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../src/cli/commands/init.js';
import { comprehensionDir, fosDir, manifestPath } from '../../src/paths.js';

describe('runInit', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-init-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('creates .comprehension/, .fos/, and an empty manifest', async () => {
    await runInit({ projectRoot: tmp });
    await stat(comprehensionDir(tmp));
    await stat(fosDir(tmp));
    const m = JSON.parse(await readFile(manifestPath(tmp), 'utf8'));
    expect(m.schema_version).toBe('1.0.0');
  });

  it('is idempotent (safe to run twice)', async () => {
    await runInit({ projectRoot: tmp });
    await runInit({ projectRoot: tmp });
  });

  it('does not overwrite an existing manifest', async () => {
    await runInit({ projectRoot: tmp });
    const existing = JSON.parse(await readFile(manifestPath(tmp), 'utf8'));
    existing.opt_in.backfill_completed = true;
    await writeFile(manifestPath(tmp), JSON.stringify(existing));
    await runInit({ projectRoot: tmp });
    const after = JSON.parse(await readFile(manifestPath(tmp), 'utf8'));
    expect(after.opt_in.backfill_completed).toBe(true);
  });
});
