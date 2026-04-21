import type { Command } from 'commander';

export function analyzeCommand(program: Command): void {
  program
    .command('analyze')
    .description('analyze the current session transcript (impl in Phase 6)')
    .action(() => {
      console.error('[analyze] not yet implemented (Phase 6)');
      process.exit(1);
    });
}
