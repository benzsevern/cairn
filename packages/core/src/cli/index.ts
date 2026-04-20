import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { analyzeCommand } from './commands/analyze.js';
import { rebuildCommand } from './commands/rebuild.js';
import { backfillCommand } from './commands/backfill.js';
import { VERSION } from '../index.js';

export async function runCli(argv: readonly string[]): Promise<void> {
  const program = new Command();
  program.name('fos').version(VERSION).description('FOS — comprehension layer for Claude Code sessions');
  initCommand(program);
  analyzeCommand(program);
  rebuildCommand(program);
  backfillCommand(program);
  await program.parseAsync([...argv]);
}
