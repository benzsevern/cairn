import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  runInit,
  discoverSessions,
  estimateCost,
  estimateTokens,
  backfill as coreBackfill,
  rebuildProjectView,
  readManifest,
  writeManifest,
  type DiscoveredSession,
} from '@fos/core';
import {
  hasInstallAck,
  hasProjectConsent,
  writeInstallAck,
  writeProjectConsent,
} from '../../consent.js';
import { findClaudeCodeProjectHash } from '../../discover-project.js';

export interface InitDeps {
  now?: () => Date;
  runInitImpl?: typeof runInit;
  discoverSessionsImpl?: typeof discoverSessions;
  backfillImpl?: typeof coreBackfill;
  rebuildImpl?: typeof rebuildProjectView;
  findHashImpl?: typeof findClaudeCodeProjectHash;
  hasInstallAckImpl?: typeof hasInstallAck;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  homeOverride?: string;
  claudeProjectsDir?: string;
}

export interface InitOpts {
  showConsent?: boolean;
  accept?: boolean;
  acceptMachineConsent?: boolean;
  skipBackfill?: boolean;
  projectRoot: string;
  model?: string;
}

const CONSENT_TEXT = `FOS analyzes your Claude Code session transcripts in the background and
builds a comprehension graph in each opted-in project's .comprehension/
directory.

How analysis runs:
  - Invokes your existing \`claude -p\` command (no new API key).
  - Reads transcripts under ~/.claude/projects/.
  - Writes .comprehension/ to each opted-in project.

Data flow: unchanged from your normal Claude Code usage. The plugin does
NOT contact any third-party provider.

The full data-flow statement is at \`docs/user/data-flow.md\` inside this
plugin's install directory
(~/.claude/plugins/cache/fos-dev/comprehend-fos/<version>/docs/user/data-flow.md).`;

async function gatherPreview(
  projectRoot: string,
  model: string,
  deps: InitDeps,
): Promise<{
  sessions: DiscoveredSession[];
  estimated_cost_usd_low: number;
  estimated_cost_usd_high: number;
  backfill_count: number;
}> {
  const findHash = deps.findHashImpl ?? findClaudeCodeProjectHash;
  const discover = deps.discoverSessionsImpl ?? discoverSessions;
  const claudeDir =
    deps.claudeProjectsDir ?? join(deps.homeOverride ?? homedir(), '.claude', 'projects');

  let sessions: DiscoveredSession[] = [];
  const hashOpts: Parameters<typeof findHash>[1] = {};
  if (deps.claudeProjectsDir !== undefined) hashOpts.claudeProjectsDir = deps.claudeProjectsDir;
  const hash = await findHash(projectRoot, hashOpts);
  if (hash) {
    try {
      sessions = await discover(claudeDir, hash);
    } catch {
      sessions = [];
    }
  }
  const totalChars = sessions.reduce((a, d) => a + d.sizeBytes, 0);
  const tokens = Math.round(estimateTokens(totalChars));
  const cost = estimateCost(tokens, model);
  return {
    sessions,
    estimated_cost_usd_low: cost.usd_low,
    estimated_cost_usd_high: cost.usd_high,
    backfill_count: sessions.length,
  };
}

export async function runInitSubcommand(opts: InitOpts, deps: InitDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const projectRoot = resolve(opts.projectRoot);
  const model = opts.model ?? 'claude-sonnet-4-6';
  const ackOpts: Parameters<typeof hasInstallAck>[0] = {};
  if (deps.homeOverride !== undefined) ackOpts.homeOverride = deps.homeOverride;
  const checkAck = deps.hasInstallAckImpl ?? hasInstallAck;

  if (opts.showConsent) {
    const installAck = await checkAck(ackOpts);
    const consentExists = await hasProjectConsent(projectRoot);
    const preview = await gatherPreview(projectRoot, model, deps);
    stdout.write(
      JSON.stringify({
        install_ack: installAck,
        consent_exists: consentExists,
        consent_required_text: installAck ? null : CONSENT_TEXT,
        estimated_cost_usd_low: preview.estimated_cost_usd_low,
        estimated_cost_usd_high: preview.estimated_cost_usd_high,
        backfill_count: preview.backfill_count,
        project_root: projectRoot,
      }) + '\n',
    );
    return 0;
  }

  if (opts.accept) {
    let installAck = await checkAck(ackOpts);
    if (!installAck && opts.acceptMachineConsent) {
      await writeInstallAck(ackOpts);
      installAck = true;
    }
    if (!installAck) {
      stderr.write(
        'Install acknowledgment missing (~/.claude/fos-install-ack).\n' +
          'Re-run /comprehend-fos:comprehend-init to view the consent text,\n' +
          'or pass --accept-machine-consent to acknowledge non-interactively.\n',
      );
      return 1;
    }
    if (await hasProjectConsent(projectRoot)) {
      stdout.write(`Project already opted in at ${projectRoot}.\n`);
      return 0;
    }
    const runInitFn = deps.runInitImpl ?? runInit;
    await runInitFn({ projectRoot });
    const now = (deps.now ?? (() => new Date()))();
    await writeProjectConsent(projectRoot, { opted_in_at: now.toISOString() });
    stdout.write(`Opted in: ${projectRoot}\n`);

    if (!opts.skipBackfill) {
      const preview = await gatherPreview(projectRoot, model, deps);
      if (preview.sessions.length === 0) {
        stdout.write('No prior sessions discovered; skipping backfill.\n');
      } else {
        const backfillFn = deps.backfillImpl ?? coreBackfill;
        const report = await backfillFn({
          projectRoot,
          discovered: preview.sessions,
          model,
          confirm: async () => true,
        });
        stdout.write(
          `Backfill complete: analyzed=${report.analyzed} failed=${report.failed.length}\n`,
        );
      }
    } else {
      try {
        const manifest = await readManifest(projectRoot);
        manifest.opt_in.analyze_all_future_sessions = true;
        await writeManifest(projectRoot, manifest);
      } catch {
        /* non-fatal */
      }
    }
    return 0;
  }

  stderr.write(
    'Usage: fos init [--show-consent | --accept [--skip-backfill] [--accept-machine-consent]]\n' +
      '  --show-consent            Probe install-ack + consent + backfill preview (JSON).\n' +
      '  --accept                  Opt this project in (idempotent).\n' +
      '  --skip-backfill           With --accept, skip the backfill wizard.\n' +
      '  --accept-machine-consent  With --accept, also write the install-ack marker.\n',
  );
  return 2;
}

export function initCommand(program: Command): void {
  program
    .command('init')
    .description('opt this project in for automatic analysis')
    .option('--show-consent', 'emit JSON probe and exit 0')
    .option('--accept', 'opt this project in (idempotent)')
    .option('--skip-backfill', 'with --accept: skip the backfill wizard')
    .option('--accept-machine-consent', 'with --accept: write the install-ack marker')
    .option('--project-root <path>', 'project root', process.cwd())
    .option('--model <model>', 'model for cost estimation', 'claude-sonnet-4-6')
    .action(async (opts: {
      showConsent?: boolean;
      accept?: boolean;
      skipBackfill?: boolean;
      acceptMachineConsent?: boolean;
      projectRoot: string;
      model: string;
    }) => {
      const initOpts: InitOpts = {
        projectRoot: opts.projectRoot,
        model: opts.model,
      };
      if (opts.showConsent !== undefined) initOpts.showConsent = opts.showConsent;
      if (opts.accept !== undefined) initOpts.accept = opts.accept;
      if (opts.skipBackfill !== undefined) initOpts.skipBackfill = opts.skipBackfill;
      if (opts.acceptMachineConsent !== undefined)
        initOpts.acceptMachineConsent = opts.acceptMachineConsent;
      const code = await runInitSubcommand(initOpts);
      process.exit(code);
    });
}
