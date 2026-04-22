import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Regression test for the bundled (tsup-emitted) prompt loader path.
 *
 * The dev-only unit test in `load-prompt.test.ts` exercises the source file
 * directly, so it cannot catch bundling-related path breakage (tsup inlines
 * `load-prompt.ts` into `dist/index.js`, which changes what `import.meta.url`
 * points to). This test loads the actual bundled entry and verifies that
 * `loadRefinerPrompt` can still locate the shipped prompt (currently
 * `prompts/refiner-v1.1.md`, with `refiner-v1.md` retained as archive).
 */

const packageRoot = resolve(__dirname, '..', '..');
const distEntry = resolve(packageRoot, 'dist', 'index.js');

describe('loadRefinerPrompt (bundled dist)', () => {
  beforeAll(() => {
    if (!existsSync(distEntry)) {
      // Build on demand so the test is self-sufficient.
      const result = spawnSync(
        process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        ['--filter', '@fos/core', 'build'],
        { cwd: resolve(packageRoot, '..', '..'), stdio: 'inherit', shell: false },
      );
      if (result.status !== 0) {
        throw new Error(
          `pnpm --filter @fos/core build failed with status ${result.status}`,
        );
      }
    }
  }, 120_000);

  it('loads the shipped prompt via the bundled dist entry', { timeout: 30_000 }, async () => {
    expect(existsSync(distEntry)).toBe(true);
    // Dynamic import via file URL so Node treats the path correctly on Windows.
    const mod = (await import(pathToFileURL(distEntry).href)) as {
      loadRefinerPrompt: (projectRoot: string) => Promise<{
        text: string;
        version: string;
        hash: string;
        overrideActive: boolean;
      }>;
    };

    const tmp = await mkdtemp(join(tmpdir(), 'fos-loadprompt-dist-'));
    try {
      const loaded = await mod.loadRefinerPrompt(tmp);
      expect(loaded.overrideActive).toBe(false);
      expect(loaded.version).toBe('v1.1.0');
      expect(loaded.text).toContain('refiner');
      expect(loaded.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
