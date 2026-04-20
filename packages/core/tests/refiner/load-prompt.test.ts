import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRefinerPrompt, SHIPPED_REFINER_VERSION } from '../../src/refiner/load-prompt.js';
import { fosDir } from '../../src/paths.js';

describe('loadRefinerPrompt', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-loadprompt-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns the shipped prompt when no override is present', async () => {
    const loaded = await loadRefinerPrompt(tmp);
    expect(loaded.overrideActive).toBe(false);
    expect(loaded.version).toBe(SHIPPED_REFINER_VERSION);
    expect(loaded.text).toContain('refiner');
    expect(loaded.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('honors a .fos/refiner-prompt.md override', async () => {
    await mkdir(fosDir(tmp), { recursive: true });
    await writeFile(join(fosDir(tmp), 'refiner-prompt.md'), 'CUSTOM PROMPT');
    const loaded = await loadRefinerPrompt(tmp);
    expect(loaded.overrideActive).toBe(true);
    expect(loaded.version).toBe('override');
    expect(loaded.text).toBe('CUSTOM PROMPT');
  });
});
