import type { Command } from 'commander';

export function initCommand(program: Command): void {
  program
    .command('init')
    .description('opt this project in for automatic analysis (impl in Phase 6)')
    .option('--show-consent')
    .option('--accept')
    .option('--skip-backfill')
    .action(() => {
      console.error('[init] not yet implemented (Phase 6)');
      process.exit(1);
    });
}
