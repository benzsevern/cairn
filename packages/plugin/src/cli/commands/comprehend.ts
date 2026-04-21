import { stat, readdir, readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import type { Command } from 'commander';
import {
  analyzeSession,
  rebuildProjectView,
  estimateCost,
  estimateTokens,
} from '@fos/core';
import { hasProjectConsent } from '../../consent.js';
import { tryAcquireLock, readLock, releaseLock } from '../../lock.js';
import { appendLogEvent } from '../../log.js';
import { sessionsDir } from '../../plugin-paths.js';

export interface AnalyzeDeps {
  now?: () => Date;
  analyzeSessionImpl?: typeof analyzeSession;
  rebuildImpl?: typeof rebuildProjectView;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface AnalyzeOpts {
  projectRoot: string;
  sessionId?: string;
  transcriptPath?: string;
  dryRun?: boolean;
  force?: boolean;
  model?: string;
}

async function existingSessionFile(projectRoot: string, sessionId: string): Promise<string | null> {
  try {
    const entries = await readdir(sessionsDir(projectRoot));
    const match = entries.find((e) => e.endsWith(`-${sessionId}.md`));
    return match ? join(sessionsDir(projectRoot), match) : null;
  } catch {
    return null;
  }
}

function deriveSessionId(transcriptPath: string | undefined, explicit: string | undefined): string | null {
  if (explicit) return explicit;
  if (!transcriptPath) return null;
  const base = basename(transcriptPath);
  return base.endsWith('.jsonl') ? base.slice(0, -6) : base;
}

export async function runAnalyzeSubcommand(
  opts: AnalyzeOpts,
  deps: AnalyzeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const projectRoot = resolve(opts.projectRoot);
  const model = opts.model ?? 'claude-sonnet-4-6';
  const now = deps.now ?? (() => new Date());

  if (!(await hasProjectConsent(projectRoot))) {
    stderr.write(
      'Project is not opted in to FOS analysis.\n' +
        "Run `/comprehend init` to opt in.\n",
    );
    return 3;
  }

  const sessionId = deriveSessionId(opts.transcriptPath, opts.sessionId);
  if (!sessionId) {
    stderr.write('Missing --session-id or --transcript-path.\n');
    return 2;
  }
  const transcriptPath = opts.transcriptPath;

  if (opts.dryRun) {
    let sizeBytes = 0;
    if (transcriptPath) {
      try {
        sizeBytes = (await stat(transcriptPath)).size;
      } catch {
        sizeBytes = 0;
      }
    }
    const tokens = Math.round(estimateTokens(sizeBytes));
    const cost = estimateCost(tokens, model);
    const existing = await existingSessionFile(projectRoot, sessionId);
    stdout.write(
      JSON.stringify({
        session_id: sessionId,
        transcript_path: transcriptPath ?? null,
        size_bytes: sizeBytes,
        estimated_input_tokens: tokens,
        estimated_cost_usd_low: cost.usd_low,
        estimated_cost_usd_high: cost.usd_high,
        existing_session_file: existing,
        model,
      }) + '\n',
    );
    return 0;
  }

  if (!transcriptPath) {
    stderr.write('Missing --transcript-path for non-dry-run analyze.\n');
    return 2;
  }

  // Existing session guard — unless --force, skip and tell caller.
  if (!opts.force) {
    const existing = await existingSessionFile(projectRoot, sessionId);
    if (existing) {
      stdout.write(
        `Session already analyzed: ${existing}\nPass --force to re-analyze.\n`,
      );
      return 0;
    }
  }

  // Synchronous lock acquisition; fail fast if held.
  const acquired = await tryAcquireLock(
    projectRoot,
    { pid: process.pid, session_id: sessionId },
    { now },
  );
  if (!acquired) {
    const held = await readLock(projectRoot);
    stderr.write(
      'Analysis already running for this project' +
        (held ? ` (pid=${held.pid}, session=${held.session_id}).` : '.') +
        '\nRun `/comprehend status` for details.\n',
    );
    return 4;
  }

  const startTs = now();
  await appendLogEvent(projectRoot, sessionId, {
    kind: 'worker_started',
    session_id: sessionId,
    timestamp: startTs.toISOString(),
  });

  try {
    const analyzeFn = deps.analyzeSessionImpl ?? analyzeSession;
    const artifact = await analyzeFn({
      projectRoot,
      transcriptPath,
      sessionId,
      model,
      now,
    });
    const endTs = now();
    await appendLogEvent(projectRoot, sessionId, {
      kind: 'worker_success',
      session_id: sessionId,
      timestamp: endTs.toISOString(),
      concept_count: artifact.concept_count,
      unknown_count: artifact.unknown_count,
      elapsed_ms: endTs.getTime() - startTs.getTime(),
    });

    const rebuildFn = deps.rebuildImpl ?? rebuildProjectView;
    await rebuildFn({ projectRoot, now });

    stdout.write(
      `Analyzed session ${sessionId}: concepts=${artifact.concept_count} unknowns=${artifact.unknown_count}\n`,
    );
    return 0;
  } catch (err) {
    const endTs = now();
    const errName = err instanceof Error ? err.name : 'Error';
    const errMsg = err instanceof Error ? err.message : String(err);
    await appendLogEvent(projectRoot, sessionId, {
      kind: 'worker_failure',
      session_id: sessionId,
      timestamp: endTs.toISOString(),
      error_name: errName,
      message: errMsg,
      elapsed_ms: endTs.getTime() - startTs.getTime(),
    });
    stderr.write(`Analysis failed: ${errName}: ${errMsg}\n`);
    return 1;
  } finally {
    await releaseLock(projectRoot);
  }
}

export function analyzeCommand(program: Command): void {
  program
    .command('analyze')
    .description('analyze a session transcript synchronously')
    .argument('[session_id]', 'explicit session id (otherwise derived from --transcript-path)')
    .option('--transcript-path <path>', 'JSONL transcript path')
    .option('--session-id <id>', 'session id (alias for positional)')
    .option('--dry-run', 'print cost/existing-state JSON; do not invoke refiner')
    .option('--force', 're-analyze even if a session file exists')
    .option('--project-root <path>', 'project root', process.cwd())
    .option('--model <model>', 'model for cost estimation', 'claude-sonnet-4-6')
    .action(async (positional: string | undefined, opts: {
      transcriptPath?: string;
      sessionId?: string;
      dryRun?: boolean;
      force?: boolean;
      projectRoot: string;
      model: string;
    }) => {
      const analyzeOpts: AnalyzeOpts = {
        projectRoot: opts.projectRoot,
        model: opts.model,
      };
      const sid = opts.sessionId ?? positional;
      if (sid !== undefined) analyzeOpts.sessionId = sid;
      if (opts.transcriptPath !== undefined) analyzeOpts.transcriptPath = opts.transcriptPath;
      if (opts.dryRun !== undefined) analyzeOpts.dryRun = opts.dryRun;
      if (opts.force !== undefined) analyzeOpts.force = opts.force;
      const code = await runAnalyzeSubcommand(analyzeOpts);
      process.exit(code);
    });
}
