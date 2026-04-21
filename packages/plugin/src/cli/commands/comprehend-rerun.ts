import type { Command } from 'commander';

export function rerunCommand(program: Command): void {
  program
    .command('rerun [sessionId]')
    .description('re-derive project view (no refiner), or re-analyze one/all sessions')
    .option('--all', 'Re-analyze every session on disk')
    .option('--force', 'Skip the "refiner version matches" warning on --all')
    .option('--dry-run', 'Print what would run; no refiner calls')
    .option('--show-preview', 'Emit JSON preview and exit 0')
    .option('--project-root <path>', 'project root', process.cwd())
    .action(() => {
      console.error('[rerun] not yet implemented');
      process.exit(1);
    });
}
