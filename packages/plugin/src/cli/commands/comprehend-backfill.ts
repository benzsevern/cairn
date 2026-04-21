import type { Command } from 'commander';

export function backfillCommand(program: Command): void {
  program
    .command('backfill')
    .description('backfill analysis for prior sessions (impl in Phase 6)')
    .action(() => {
      console.error('[backfill] not yet implemented (Phase 6)');
      process.exit(1);
    });
}
