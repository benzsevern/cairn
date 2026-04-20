import { Command } from 'commander';
import { rebuildProjectView } from '../../rebuild-project-view.js';

export interface RunRebuildArgs {
  projectRoot: string;
  now?: () => Date;
}

export async function runRebuild(args: RunRebuildArgs): Promise<void> {
  const rebuildArgs: Parameters<typeof rebuildProjectView>[0] = { projectRoot: args.projectRoot };
  if (args.now !== undefined) rebuildArgs.now = args.now;
  await rebuildProjectView(rebuildArgs);
  console.log(`Project view rebuilt in ${args.projectRoot}.`);
}

export function rebuildCommand(program: Command): void {
  program
    .command('rebuild')
    .description('regenerate concepts/*.md, graph.json, and graph.html from session artifacts')
    .option('--project-root <path>', 'project root', process.cwd())
    .action(async (opts: { projectRoot: string }) => {
      await runRebuild({ projectRoot: opts.projectRoot });
    });
}
