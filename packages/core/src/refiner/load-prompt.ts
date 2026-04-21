import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, parse as parsePath } from 'node:path';
import { overridePromptPath } from '../paths.js';

export const SHIPPED_REFINER_VERSION = 'v1.0.0';

export class RefinerPromptNotFoundError extends Error {
  readonly searchedPaths: string[];
  constructor(message: string, searchedPaths: string[]) {
    super(message);
    this.name = 'RefinerPromptNotFoundError';
    this.searchedPaths = searchedPaths;
  }
}

/**
 * Locate the shipped refiner prompt. Tries three strategies in order:
 *
 * 1. A `prompts/refiner-v1.md` file at the module's own directory or any
 *    ancestor — robust in both dev (walks up from src/) and in bundled
 *    installs where the prompt is copied sibling-to-bundle (e.g. the plugin's
 *    `dist/prompts/`, or core's `dist/prompts/` or `prompts/`).
 * 2. A `package.json` with `name: '@fos/core'` or `name: '@fos/plugin'` — the
 *    packages that ship the prompt — taking `<pkgRoot>/prompts/refiner-v1.md`.
 * 3. Give up with a typed error enumerating every searched path.
 */
function findShippedPrompt(startDir: string): string {
  let dir = startDir;
  const searched: string[] = [];
  const { root } = parsePath(dir);
  while (true) {
    const directCandidate = resolve(dir, 'prompts', 'refiner-v1.md');
    searched.push(directCandidate);
    if (existsSync(directCandidate)) return directCandidate;

    const pkgPath = resolve(dir, 'package.json');
    searched.push(pkgPath);
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (pkg.name === '@fos/core' || pkg.name === '@fos/plugin') {
          const candidate = resolve(dir, 'prompts', 'refiner-v1.md');
          searched.push(candidate);
          if (existsSync(candidate)) return candidate;
        }
      } catch {
        // ignore malformed package.json and keep walking
      }
    }

    if (dir === root) {
      throw new RefinerPromptNotFoundError(
        `Unable to locate refiner prompt starting from ${startDir}`,
        searched,
      );
    }
    dir = dirname(dir);
  }
}

function shippedPromptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return findShippedPrompt(here);
}

export interface LoadedPrompt {
  text: string;
  version: string;
  hash: string;
  overrideActive: boolean;
}

async function tryReadOverride(projectRoot: string): Promise<string | null> {
  try {
    return await readFile(overridePromptPath(projectRoot), 'utf8');
  } catch {
    return null;
  }
}

export async function loadRefinerPrompt(projectRoot: string): Promise<LoadedPrompt> {
  const override = await tryReadOverride(projectRoot);
  if (override) {
    return {
      text: override,
      version: 'override',
      hash: `sha256:${createHash('sha256').update(override).digest('hex')}`,
      overrideActive: true,
    };
  }
  const text = await readFile(shippedPromptPath(), 'utf8');
  return {
    text,
    version: SHIPPED_REFINER_VERSION,
    hash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
    overrideActive: false,
  };
}
