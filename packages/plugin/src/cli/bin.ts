#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { initCommand } from './commands/comprehend-init.js';
import { analyzeCommand } from './commands/comprehend.js';
import { statusCommand } from './commands/comprehend-status.js';
import { backfillCommand } from './commands/comprehend-backfill.js';
import { rerunCommand } from './commands/comprehend-rerun.js';

export async function runCli(argv: readonly string[]): Promise<void> {
  const program = new Command();
  program.name('fos').description('FOS plugin CLI — drives /comprehend* slash commands');
  initCommand(program);
  analyzeCommand(program);
  statusCommand(program);
  backfillCommand(program);
  rerunCommand(program);
  await program.parseAsync([...argv]);
}

// Basename check survives tsup's bundle-time dead-code elimination of
// `import.meta.url === pathToFileURL(argv[1]).href` (see plugin/src/hooks/stop.ts).
const _argv1 = process.argv[1] ?? '';
if (_argv1.endsWith('bin.js') || _argv1.endsWith('bin.ts')) {
  runCli(process.argv).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
