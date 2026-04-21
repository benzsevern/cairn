import type { Command } from 'commander';

export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('show FOS analysis status for the current project (impl in Phase 6)')
    .action(() => {
      console.error('[status] not yet implemented (Phase 6)');
      process.exit(1);
    });
}
