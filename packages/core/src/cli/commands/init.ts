import { mkdir } from 'node:fs/promises';
import { Command } from 'commander';
import {
  comprehensionDir,
  sessionsDir,
  conceptsDir,
  fosDir,
  cacheDir,
  manifestPath,
} from '../../paths.js';
import { defaultManifest, writeManifest, readManifest } from '../../writer/manifest.js';

export interface InitArgs {
  projectRoot: string;
}

export async function runInit(args: InitArgs): Promise<void> {
  await mkdir(comprehensionDir(args.projectRoot), { recursive: true });
  await mkdir(sessionsDir(args.projectRoot), { recursive: true });
  await mkdir(conceptsDir(args.projectRoot), { recursive: true });
  await mkdir(fosDir(args.projectRoot), { recursive: true });
  await mkdir(cacheDir(args.projectRoot), { recursive: true });

  // Only write a fresh manifest if none exists; otherwise leave user's customizations alone.
  try {
    const { readFile } = await import('node:fs/promises');
    await readFile(manifestPath(args.projectRoot), 'utf8');
    // manifest exists — merge in defaults for any missing fields
    const current = await readManifest(args.projectRoot);
    await writeManifest(args.projectRoot, current);
  } catch {
    await writeManifest(args.projectRoot, defaultManifest());
  }

  console.log(`Initialized .comprehension/ in ${args.projectRoot}`);
}

export function initCommand(program: Command): void {
  program
    .command('init')
    .description('scaffold .comprehension/ in the current directory')
    .option('--project-root <path>', 'project root', process.cwd())
    .action(async (opts: { projectRoot: string }) => {
      await runInit({ projectRoot: opts.projectRoot });
    });
}
