import { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { discoverSessions, backfill } from '../../backfill.js';

export function backfillCommand(program: Command): void {
  program
    .command('backfill')
    .description('analyze prior Claude Code sessions for this project')
    .option('--project-root <path>', 'project root', process.cwd())
    .option('--project-hash <hash>', 'Claude Code project hash under ~/.claude/projects/', '')
    .option(
      '--claude-projects-dir <path>',
      'override the default ~/.claude/projects/ location',
      join(homedir(), '.claude', 'projects'),
    )
    .option('--model <model>', 'Claude model to estimate cost for', 'claude-sonnet-4-6')
    .option('--yes', 'skip confirmation prompt', false)
    .action(
      async (opts: {
        projectRoot: string;
        projectHash: string;
        claudeProjectsDir: string;
        model: string;
        yes: boolean;
      }) => {
        if (!opts.projectHash) {
          console.error('--project-hash is required. Find it under ~/.claude/projects/.');
          process.exit(2);
        }
        const discovered = await discoverSessions(opts.claudeProjectsDir, opts.projectHash);
        if (discovered.length === 0) {
          console.log('No prior sessions found. Nothing to backfill.');
          return;
        }

        const confirmFn = opts.yes
          ? async () => true
          : async (s: {
              count: number;
              totalInputTokens: number;
              usd_low: number;
              usd_high: number;
            }) => {
              console.log(
                `Found ${s.count} prior sessions (~${s.totalInputTokens.toLocaleString()} input tokens).`,
              );
              console.log(
                `Estimated cost: $${s.usd_low.toFixed(2)}–$${s.usd_high.toFixed(2)} on ${opts.model}.`,
              );
              const rl = createInterface({ input: process.stdin, output: process.stdout });
              const answer = (await rl.question('Proceed? [y/N] ')).trim().toLowerCase();
              rl.close();
              return answer === 'y' || answer === 'yes';
            };

        const report = await backfill({
          projectRoot: opts.projectRoot,
          discovered,
          model: opts.model,
          confirm: confirmFn,
        });
        console.log(
          `Discovered ${report.discovered}, analyzed ${report.analyzed}, failed ${report.failed.length}.`,
        );
        if (report.failed.length > 0) {
          for (const f of report.failed) console.log(`  failed: ${f.session_id} — ${f.reason}`);
        }
      },
    );
}
