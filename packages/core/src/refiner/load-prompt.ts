import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { overridePromptPath } from '../paths.js';

export const SHIPPED_REFINER_VERSION = 'v1.0.0';

function shippedPromptPath(): string {
  // dist/refiner/load-prompt.js → up three to @fos/core, then prompts/refiner-v1.md
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', 'prompts', 'refiner-v1.md');
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
