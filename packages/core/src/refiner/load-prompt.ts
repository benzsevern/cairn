import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, parse as parsePath } from 'node:path';
import { overridePromptPath } from '../paths.js';

export const SHIPPED_REFINER_VERSION = 'v1.1.0';

export class RefinerPromptNotFoundError extends Error {
  readonly searchedPaths: string[];
  constructor(message: string, searchedPaths: string[]) {
    super(message);
    this.name = 'RefinerPromptNotFoundError';
    this.searchedPaths = searchedPaths;
  }
}

// v1.1.md ships first; v1.md is an archival copy of the pre-Plan-4 baseline.
// Loader prefers v1.1 when both are present.
const PROMPT_CANDIDATES = ['refiner-v1.1.md', 'refiner-v1.md'] as const;

/**
 * Locate the shipped refiner prompt. Walks up from the module's own directory;
 * at each level checks for a `prompts/<candidate>` file (preferring v1.1 over
 * v1.0), then falls back to finding the `@fos/core` or `@fos/plugin`
 * package.json and retrying relative to that root. Errors with every searched
 * path if nothing matches.
 */
function findShippedPrompt(startDir: string): string {
  let dir = startDir;
  const searched: string[] = [];
  const { root } = parsePath(dir);
  while (true) {
    for (const name of PROMPT_CANDIDATES) {
      const directCandidate = resolve(dir, 'prompts', name);
      searched.push(directCandidate);
      if (existsSync(directCandidate)) return directCandidate;
    }

    const pkgPath = resolve(dir, 'package.json');
    searched.push(pkgPath);
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (pkg.name === '@fos/core' || pkg.name === '@fos/plugin') {
          for (const name of PROMPT_CANDIDATES) {
            const candidate = resolve(dir, 'prompts', name);
            searched.push(candidate);
            if (existsSync(candidate)) return candidate;
          }
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
