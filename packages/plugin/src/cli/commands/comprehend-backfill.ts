import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  backfill as coreBackfill,
  discoverSessions,
  estimateCost,
  estimateTokens,
  type DiscoveredSession,
} from '@fos/core';
import { hasProjectConsent } from '../../consent.js';
import { tryAcquireLock, readLock, releaseLock } from '../../lock.js';
import { appendLogEvent } from '../../log.js';
import { findClaudeCodeProjectHash } from '../../discover-project.js';

export interface BackfillDeps {
  now?: () => Date;
  discoverSessionsImpl?: typeof discoverSessions;
  backfillImpl?: typeof coreBackfill;
  findHashImpl?: typeof findClaudeCodeProjectHash;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  homeOverride?: string;
  claudeProjectsDir?: string;
}

export interface BackfillOpts {
  projectRoot: string;
  showPreview?: boolean;
  yes?: boolean;
  recent?: number;
  model?: string;
  projectHash?: string;
}

async function resolveHash(
  projectRoot: string,
  explicit: string | undefined,
  deps: BackfillDeps,
): Promise<string | null> {
  if (explicit) return explicit;
  const find = deps.findHashImpl ?? findClaudeCodeProjectHash;
  const hashOpts: Parameters<typeof find>[1] = {};
  if (deps.claudeProjectsDir !== undefined) hashOpts.claudeProjectsDir = deps.claudeProjectsDir;
  return find(projectRoot, hashOpts);
}

function claudeProjectsDirFor(deps: BackfillDeps): string {
  return deps.claudeProjectsDir ?? join(deps.homeOverride ?? homedir(), '.claude', 'projects');
}

function narrow(sessions: DiscoveredSession[], recent: number | undefined): DiscoveredSession[] {
  if (recent === undefined || recent <= 0) return sessions;
  return sessions.slice(-recent);
}

export async function runBackfillSubcommand(
  opts: BackfillOpts,
  deps: BackfillDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const projectRoot = resolve(opts.projectRoot);
  const model = opts.model ?? 'claude-sonnet-4-6';
  const now = deps.now ?? (() => new Date());

  if (!(await hasProjectConsent(projectRoot))) {
    stderr.write(
      `Project not opted in: ${projectRoot}\n` +
        'Run `/comprehend init` to opt in.\n',
    );
    return 3;
  }

  const resolvedHash = await resolveHash(projectRoot, opts.projectHash, deps);
  const claudeDir = claudeProjectsDirFor(deps);
  const discover = deps.discoverSessionsImpl ?? discoverSessions;
  let sessions: DiscoveredSession[] = [];
  if (resolvedHash) {
    try {
      sessions = await discover(claudeDir, resolvedHash);
    } catch {
      sessions = [];
    }
  }
  const selected = narrow(sessions, opts.recent);

  const totalChars = selected.reduce((a, d) => a + d.sizeBytes, 0);
  const tokens = Math.round(estimateTokens(totalChars));
  const cost = estimateCost(tokens, model);

  if (opts.showPreview) {
    stdout.write(
      JSON.stringify({
        count: selected.length,
        total_input_tokens: tokens,
        estimated_cost_usd_low: cost.usd_low,
        estimated_cost_usd_high: cost.usd_high,
        resolved_project_hash: resolvedHash,
        project_root: projectRoot,
        model,
      }) + '\n',
    );
    return 0;
  }

  if (!opts.yes) {
    stderr.write(
      'Cost-estimate confirmation required.\n' +
        'Run with --show-preview first, then re-invoke with --yes.\n',
    );
    return 2;
  }

  if (!resolvedHash) {
    stderr.write(
      `Could not resolve Claude Code project hash for ${projectRoot}.\n` +
        'Pass --project-hash explicitly.\n',
    );
    return 1;
  }

  // Acquire project-level lock for the whole backfill run.
  const acquired = await tryAcquireLock(
    projectRoot,
    { pid: process.pid, session_id: 'backfill' },
    { now },
  );
  if (!acquired) {
    const held = await readLock(projectRoot);
    stderr.write(
      'Another analysis is in progress' +
        (held ? ` (pid=${held.pid}, session=${held.session_id}).` : '.') +
        '\nTry again later.\n',
    );
    return 1;
  }

  try {
    if (selected.length === 0) {
      stdout.write('No sessions to backfill.\n');
      return 0;
    }

    const backfillFn = deps.backfillImpl ?? coreBackfill;
    const runStartMs = now().getTime();
    const report = await backfillFn({
      projectRoot,
      discovered: selected,
      model,
      confirm: async () => true,
      now,
    });

    // Core's BackfillReport doesn't expose per-session concept/unknown counts, so
    // writing fabricated worker_success / worker_failure events would mislead
    // downstream scanners. Instead, emit one aggregate batch event per run.
    const elapsedMs = Math.max(0, now().getTime() - runStartMs);
    await appendLogEvent(projectRoot, '_batch', {
      kind: 'backfill_batch',
      session_id: '_batch',
      timestamp: now().toISOString(),
      analyzed: report.analyzed,
      failed: report.failed.length,
      total_cost_usd: report.total_cost_usd,
      elapsed_ms: elapsedMs,
    });

    stdout.write(
      `Backfill complete: discovered=${report.discovered} analyzed=${report.analyzed} failed=${report.failed.length} cost_usd=${report.total_cost_usd.toFixed(4)}\n`,
    );
    return 0;
  } catch (err) {
    stderr.write(
      `Backfill aborted: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  } finally {
    await releaseLock(projectRoot);
  }
}

export function backfillCommand(program: Command): void {
  program
    .command('backfill')
    .description('backfill analysis for prior sessions')
    .option('--show-preview', 'emit JSON preview and exit 0')
    .option('--yes', 'skip interactive confirmation (markdown-driven confirm upstream)')
    .option('--recent <n>', 'only backfill the N most recent sessions', (v) => parseInt(v, 10))
    .option('--model <model>', 'model for cost estimation + analysis', 'claude-sonnet-4-6')
    .option('--project-hash <hash>', 'Claude Code project hash (auto-detected if omitted)')
    .option('--project-root <path>', 'project root', process.cwd())
    .action(async (opts: {
      showPreview?: boolean;
      yes?: boolean;
      recent?: number;
      model: string;
      projectHash?: string;
      projectRoot: string;
    }) => {
      const bfOpts: BackfillOpts = {
        projectRoot: opts.projectRoot,
        model: opts.model,
      };
      if (opts.showPreview !== undefined) bfOpts.showPreview = opts.showPreview;
      if (opts.yes !== undefined) bfOpts.yes = opts.yes;
      if (opts.recent !== undefined) bfOpts.recent = opts.recent;
      if (opts.projectHash !== undefined) bfOpts.projectHash = opts.projectHash;
      const code = await runBackfillSubcommand(bfOpts);
      process.exit(code);
    });
}
