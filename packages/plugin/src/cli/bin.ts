#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { initCommand } from './commands/comprehend-init.js';
import { analyzeCommand } from './commands/comprehend.js';
import { statusCommand } from './commands/comprehend-status.js';
import { backfillCommand } from './commands/comprehend-backfill.js';

export async function runCli(argv: readonly string[]): Promise<void> {
  const program = new Command();
  program.name('fos').description('FOS plugin CLI — drives /comprehend* slash commands');
  initCommand(program);
  analyzeCommand(program);
  statusCommand(program);
  backfillCommand(program);
  await program.parseAsync([...argv]);
}

// Windows-safe "run as main" check: normalize process.argv[1] via pathToFileURL
// before comparing against import.meta.url (plain string compare breaks on
// Windows drive-letter paths).
const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryHref) {
  runCli(process.argv).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
