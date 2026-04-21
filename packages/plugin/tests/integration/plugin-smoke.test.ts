import { describe, it, expect } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const pluginRoot = resolve(__dirname, '..', '..');

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function readJson(p: string): Promise<unknown> {
  const raw = await readFile(p, 'utf8');
  return JSON.parse(raw);
}

const DIST_ENTRIES = [
  'dist/hooks/stop.js',
  'dist/hooks/session-start.js',
  'dist/cli/bin.js',
  'dist/worker/analyze-worker.js',
] as const;

const COMMAND_FILES = [
  'commands/comprehend.md',
  'commands/comprehend-init.md',
  'commands/comprehend-status.md',
  'commands/comprehend-backfill.md',
] as const;

describe('@fos/plugin packaging smoke', () => {
  describe('manifests', () => {
    it('plugin.json exists, is valid JSON, and has name === "comprehend-fos"', async () => {
      const p = join(pluginRoot, '.claude-plugin', 'plugin.json');
      expect(await fileExists(p)).toBe(true);
      const json = (await readJson(p)) as { name?: unknown };
      expect(json.name).toBe('comprehend-fos');
    });

    it('marketplace.json exists and is valid JSON', async () => {
      const p = join(pluginRoot, '.claude-plugin', 'marketplace.json');
      expect(await fileExists(p)).toBe(true);
      const json = (await readJson(p)) as Record<string, unknown>;
      expect(json).toBeTypeOf('object');
    });

    it('hooks/hooks.json exists, is valid JSON, and references expected Stop + SessionStart dist paths', async () => {
      const p = join(pluginRoot, 'hooks', 'hooks.json');
      expect(await fileExists(p)).toBe(true);
      const json = (await readJson(p)) as {
        hooks?: {
          Stop?: Array<{ hooks?: Array<{ command?: string }> }>;
          SessionStart?: Array<{ hooks?: Array<{ command?: string }> }>;
        };
      };
      const stopCmd = json.hooks?.Stop?.[0]?.hooks?.[0]?.command ?? '';
      const sessionCmd = json.hooks?.SessionStart?.[0]?.hooks?.[0]?.command ?? '';
      expect(stopCmd).toContain('${CLAUDE_PLUGIN_ROOT}/dist/hooks/stop.js');
      expect(sessionCmd).toContain('${CLAUDE_PLUGIN_ROOT}/dist/hooks/session-start.js');
    });
  });

  describe('built dist/ entries', () => {
    for (const rel of DIST_ENTRIES) {
      it(`${rel} exists and can be import()-ed`, async () => {
        const abs = join(pluginRoot, rel);
        const exists = await fileExists(abs);
        if (!exists) {
          throw new Error(
            `Missing ${rel}. Run "pnpm --filter @fos/plugin build" before running the smoke test.`,
          );
        }
        await expect(import(pathToFileURL(abs).href)).resolves.toBeDefined();
      });
    }
  });

  describe('command markdown', () => {
    for (const rel of COMMAND_FILES) {
      it(`${rel} exists and has > 100 chars`, async () => {
        const abs = join(pluginRoot, rel);
        expect(await fileExists(abs)).toBe(true);
        const body = await readFile(abs, 'utf8');
        expect(body.length).toBeGreaterThan(100);
      });
    }
  });

  describe('install scaffolding', () => {
    it('no install/ directory ships (post-install script was deleted)', () => {
      expect(existsSync(resolve(pluginRoot, 'install'))).toBe(false);
    });
  });
});
