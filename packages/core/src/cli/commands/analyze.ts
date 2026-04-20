import { Command } from 'commander';
import { analyzeSession, type AnalyzeSessionArgs } from '../../analyze-session.js';
import { rebuildProjectView } from '../../rebuild-project-view.js';

export interface RunAnalyzeArgs extends AnalyzeSessionArgs {
  skipRebuild?: boolean;
}

export async function runAnalyze(args: RunAnalyzeArgs): Promise<void> {
  const result = await analyzeSession(args);
  console.log(
    `Analyzed session ${result.session_id} → ${result.concept_count} concepts, ${result.unknown_count} unknowns`,
  );
  if (!args.skipRebuild) {
    const rebuildArgs: Parameters<typeof rebuildProjectView>[0] = { projectRoot: args.projectRoot };
    if (args.now !== undefined) rebuildArgs.now = args.now;
    await rebuildProjectView(rebuildArgs);
    console.log(`Rebuilt project view.`);
  }
}

export function analyzeCommand(program: Command): void {
  program
    .command('analyze <transcriptPath>')
    .description('analyze one Claude Code JSONL transcript')
    .option('--session-id <id>', 'session id (default: derived from filename)')
    .option('--project-root <path>', 'project root', process.cwd())
    .option('--model <model>', 'model label (metadata only)', 'unknown')
    .option('--skip-rebuild', 'do not rebuild project view after analysis', false)
    .action(
      async (
        transcriptPath: string,
        opts: {
          sessionId?: string;
          projectRoot: string;
          model: string;
          skipRebuild: boolean;
        },
      ) => {
        const sessionId = opts.sessionId ?? deriveSessionId(transcriptPath);
        await runAnalyze({
          projectRoot: opts.projectRoot,
          transcriptPath,
          sessionId,
          model: opts.model,
          skipRebuild: opts.skipRebuild,
        });
      },
    );
}

function deriveSessionId(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? 'session';
  return base.replace(/\.jsonl$/, '');
}
