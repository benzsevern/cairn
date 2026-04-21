import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  analyzeSession,
  rebuildProjectView,
  readManifest,
  estimateCost,
  estimateTokens,
  sessionsDir,
} from '@fos/core';
import { hasProjectConsent } from '../../consent.js';
import { tryAcquireLock, releaseLock, readLock } from '../../lock.js';
import { appendLogEvent } from '../../log.js';

type InvokeFn = NonNullable<Parameters<typeof analyzeSession>[0]['invoke']>;

export interface RerunArgs {
  projectRoot: string;
  mode: 'rebuild' | 'session' | 'all';
  sessionId?: string;
  force?: boolean;
  confirm?: () => Promise<boolean>;
  invoke?: InvokeFn;
  now?: () => Date;
}

export interface RerunReport {
  mode: RerunArgs['mode'];
  analyzed: number;
  failed: Array<{ session_id: string; reason: string }>;
  skipped: number;
}

export interface PreviewPayload {
  mode: string;
  count: number;
  estimated_cost_usd_low: number;
  estimated_cost_usd_high: number;
  refiner_version_current: string;
  refiner_version_on_sessions: string[];
  project_root: string;
}

interface SessionEntry {
  id: string;
  path: string;
  transcriptPath: string;
  refinerVersion: string;
}

async function listSessions(projectRoot: string): Promise<SessionEntry[]> {
  const dir = sessionsDir(projectRoot);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: SessionEntry[] = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    if (name.endsWith('.failed.json')) continue;
    const full = join(dir, name);
    let raw: string;
    try {
      raw = await readFile(full, 'utf8');
    } catch {
      continue;
    }
    const idMatch = raw.match(/session_id:\s*(.+)/);
    const transcriptMatch = raw.match(/transcript_path:\s*(.+)/);
    const refinerMatch = raw.match(/refiner_version:\s*(.+)/);
    if (!idMatch || !transcriptMatch) continue;
    out.push({
      id: idMatch[1]!.trim(),
      path: full,
      transcriptPath: transcriptMatch[1]!.trim(),
      refinerVersion: refinerMatch?.[1]?.trim() ?? 'unknown',
    });
  }
  return out;
}

export async function showPreview(args: {
  projectRoot: string;
  mode: RerunArgs['mode'];
  sessionId?: string;
  model: string;
}): Promise<PreviewPayload> {
  const manifest = await readManifest(args.projectRoot);
  const sessions = await listSessions(args.projectRoot);
  const target =
    args.mode === 'session' && args.sessionId
      ? sessions.filter((s) => s.id === args.sessionId)
      : args.mode === 'all'
        ? sessions
        : [];
  let totalInputTokens = 0;
  for (const s of target) {
    try {
      const raw = await readFile(s.transcriptPath, 'utf8');
      totalInputTokens += estimateTokens(raw.length);
    } catch {
      // transcript may have been deleted; skip
    }
  }
  const cost = estimateCost(totalInputTokens, args.model);
  return {
    mode: args.mode,
    count: target.length,
    estimated_cost_usd_low: cost.usd_low,
    estimated_cost_usd_high: cost.usd_high,
    refiner_version_current: manifest.refiner_version,
    refiner_version_on_sessions: Array.from(new Set(target.map((s) => s.refinerVersion))),
    project_root: args.projectRoot,
  };
}

function exitErr(message: string, exitCode: number): Error & { exitCode: number } {
  return Object.assign(new Error(message), { exitCode });
}

export async function runRerun(args: RerunArgs): Promise<RerunReport> {
  // All modes require project opt-in (bare rebuild reads sessions + writes
  // derived view under .comprehension/, so acting on a non-opted-in dir is
  // surprising). Spec §2.2 opt-in gate.
  if (!(await hasProjectConsent(args.projectRoot))) {
    throw exitErr(
      'Project not opted in; run /comprehend-fos:comprehend-init',
      3,
    );
  }

  const now = args.now ?? (() => new Date());

  if (args.mode === 'rebuild') {
    await rebuildProjectView({ projectRoot: args.projectRoot, now });
    return { mode: 'rebuild', analyzed: 0, failed: [], skipped: 0 };
  }

  if (args.mode === 'session') {
    if (!args.sessionId) throw new Error('--session requires a session id argument');
    const sessions = await listSessions(args.projectRoot);
    const target = sessions.find((s) => s.id === args.sessionId);
    if (!target) throw new Error(`session ${args.sessionId} not found in this project`);

    const acquired = await tryAcquireLock(
      args.projectRoot,
      { pid: process.pid, session_id: args.sessionId },
      { now },
    );
    if (!acquired) {
      throw exitErr('lock held; run /comprehend-fos:comprehend-status', 4);
    }
    try {
      await analyzeSession({
        projectRoot: args.projectRoot,
        transcriptPath: target.transcriptPath,
        sessionId: target.id,
        now,
        ...(args.invoke ? { invoke: args.invoke } : {}),
      });
      await rebuildProjectView({ projectRoot: args.projectRoot, now });
      return { mode: 'session', analyzed: 1, failed: [], skipped: 0 };
    } finally {
      await releaseLock(args.projectRoot);
    }
  }

  // mode === 'all'
  const existingLock = await readLock(args.projectRoot);
  if (existingLock !== null) {
    throw exitErr('lock held', 4);
  }
  const ok = args.confirm ? await args.confirm() : true;
  if (!ok) {
    throw exitErr('cancelled', 2);
  }

  const sessions = await listSessions(args.projectRoot);
  const acquired = await tryAcquireLock(
    args.projectRoot,
    { pid: process.pid, session_id: '_batch' },
    { now },
  );
  if (!acquired) throw exitErr('lock held', 4);
  const startedAt = now().getTime();
  const failed: Array<{ session_id: string; reason: string }> = [];
  let analyzed = 0;
  try {
    for (const s of sessions) {
      try {
        await analyzeSession({
          projectRoot: args.projectRoot,
          transcriptPath: s.transcriptPath,
          sessionId: s.id,
          now,
          ...(args.invoke ? { invoke: args.invoke } : {}),
        });
        analyzed += 1;
      } catch (err) {
        failed.push({
          session_id: s.id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await rebuildProjectView({ projectRoot: args.projectRoot, now });
  } finally {
    await releaseLock(args.projectRoot);
  }
  const elapsedMs = now().getTime() - startedAt;
  await appendLogEvent(args.projectRoot, '_batch', {
    kind: 'backfill_batch',
    session_id: '_batch',
    timestamp: now().toISOString(),
    mode: 'rerun',
    analyzed,
    failed: failed.length,
    total_cost_usd: 0, // no aggregate cost tracked per-run; mode distinguishes from backfill
    elapsed_ms: elapsedMs,
  });
  return { mode: 'all', analyzed, failed, skipped: 0 };
}

interface RerunCliOpts {
  all?: boolean;
  force?: boolean;
  dryRun?: boolean;
  showPreview?: boolean;
  projectRoot: string;
  model?: string;
}

export function rerunCommand(program: Command): void {
  program
    .command('rerun [sessionId]')
    .description('re-derive project view (no refiner), or re-analyze one/all sessions')
    .option('--all', 'Re-analyze every session on disk')
    .option('--force', 'Skip the "refiner version matches" warning on --all')
    .option('--dry-run', 'Print what would run; no refiner calls')
    .option('--show-preview', 'Emit JSON preview and exit 0')
    .option('--project-root <path>', 'project root', process.cwd())
    .option('--model <model>', 'model for cost estimation', 'claude-sonnet-4-6')
    .action(async (sessionId: string | undefined, opts: RerunCliOpts) => {
      const projectRoot = resolve(opts.projectRoot);
      const model = opts.model ?? 'claude-sonnet-4-6';
      const mode: RerunArgs['mode'] = opts.all
        ? 'all'
        : sessionId
          ? 'session'
          : 'rebuild';

      try {
        // Opt-in guard fires here too so --show-preview respects it.
        if (!(await hasProjectConsent(projectRoot))) {
          console.error('Project not opted in; run /comprehend-fos:comprehend-init');
          process.exit(3);
        }

        if (opts.showPreview) {
          const payload = await showPreview({
            projectRoot,
            mode,
            ...(sessionId ? { sessionId } : {}),
            model,
          });
          process.stdout.write(JSON.stringify(payload) + '\n');
          process.exit(0);
        }

        const rerunArgs: RerunArgs = { projectRoot, mode };
        if (sessionId) rerunArgs.sessionId = sessionId;
        if (opts.force) rerunArgs.force = opts.force;
        // --force on --all skips our built-in confirmation (used when the markdown prompt already confirmed).
        if (mode === 'all' && !opts.force) {
          rerunArgs.confirm = async () => {
            console.error(
              'Re-analyzing all sessions requires --force or an external confirmation. Aborting.',
            );
            return false;
          };
        }
        const report = await runRerun(rerunArgs);
        process.stdout.write(
          `Rerun complete: mode=${report.mode} analyzed=${report.analyzed} failed=${report.failed.length}\n`,
        );
        process.exit(0);
      } catch (err) {
        const exitCode = (err as { exitCode?: number }).exitCode ?? 1;
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(exitCode);
      }
    });
}
