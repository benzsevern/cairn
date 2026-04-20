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
 * Locate the `@fos/core` package root by walking upward from the current
 * module's directory until a `package.json` with `name: '@fos/core'` is found.
 *
 * This is robust to bundling: in dev, this file lives at
 * `packages/core/src/refiner/load-prompt.ts` and walks up to
 * `packages/core/package.json`. Post-build, tsup inlines this file into
 * `packages/core/dist/index.js`, so the walk starts from `dist/` and still
 * finds `packages/core/package.json` one level up. In an installed package
 * (e.g. `node_modules/@fos/core/dist/index.js`), it finds the installed
 * package's own `package.json`.
 */
function findCorePackageRoot(startDir: string): string {
  let dir = startDir;
  const searched: string[] = [];
  const { root } = parsePath(dir);
  while (true) {
    const candidate = resolve(dir, 'package.json');
    searched.push(candidate);
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string };
        if (pkg.name === '@fos/core') {
          return dir;
        }
      } catch {
        // ignore malformed package.json and keep walking
      }
    }
    if (dir === root) {
      throw new RefinerPromptNotFoundError(
        `Unable to locate @fos/core package root starting from ${startDir}`,
        searched,
      );
    }
    dir = dirname(dir);
  }
}

function shippedPromptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = findCorePackageRoot(here);
  return resolve(pkgRoot, 'prompts', 'refiner-v1.md');
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
