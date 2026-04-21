import { readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { readManifest } from '@fos/core';
import { hasProjectConsent } from '../../consent.js';
import { readLock } from '../../lock.js';
import { readLogEvents } from '../../log.js';
import {
  sessionsDir,
  pendingQueuePath,
  logsDir,
  ackedAtPath,
} from '../../plugin-paths.js';

export interface StatusDeps {
  now?: () => Date;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface StatusOpts {
  projectRoot: string;
  ack?: boolean;
  json?: boolean;
}

interface RecentRun {
  session_id: string;
  outcome: 'success' | 'failure' | 'running' | 'unknown';
  timestamp: string;
  concept_count?: number;
  unknown_count?: number;
  error_name?: string;
  message?: string;
}

async function countSessions(projectRoot: string): Promise<{ analyzed: number; failed: number }> {
  try {
    const entries = await readdir(sessionsDir(projectRoot));
    return {
      analyzed: entries.filter((e) => e.endsWith('.md')).length,
      failed: entries.filter((e) => e.endsWith('.failed.json')).length,
    };
  } catch {
    return { analyzed: 0, failed: 0 };
  }
}

async function pendingCount(projectRoot: string): Promise<number> {
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(pendingQueuePath(projectRoot), 'utf8');
    const parsed = JSON.parse(raw) as { queue: unknown[] };
    return parsed.queue.length;
  } catch {
    return 0;
  }
}

async function latestWorkerRuns(projectRoot: string, limit: number): Promise<RecentRun[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(logsDir(projectRoot));
  } catch {
    return [];
  }
  const runs: RecentRun[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.log')) continue;
    const sessionId = entry.slice(0, -4);
    const events = await readLogEvents(projectRoot, sessionId);
    if (events.length === 0) continue;
    const terminal = [...events]
      .reverse()
      .find((e) => e.kind === 'worker_success' || e.kind === 'worker_failure');
    const anchor = terminal ?? events[events.length - 1]!;
    if (terminal?.kind === 'worker_success') {
      runs.push({
        session_id: sessionId,
        outcome: 'success',
        timestamp: terminal.timestamp,
        concept_count: terminal.concept_count,
        unknown_count: terminal.unknown_count,
      });
    } else if (terminal?.kind === 'worker_failure') {
      runs.push({
        session_id: sessionId,
        outcome: 'failure',
        timestamp: terminal.timestamp,
        error_name: terminal.error_name,
        message: terminal.message,
      });
    } else {
      runs.push({
        session_id: sessionId,
        outcome: anchor.kind === 'worker_started' ? 'running' : 'unknown',
        timestamp: anchor.timestamp,
      });
    }
  }
  runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return runs.slice(0, limit);
}

export async function runStatusSubcommand(
  opts: StatusOpts,
  deps: StatusDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const projectRoot = resolve(opts.projectRoot);
  const now = (deps.now ?? (() => new Date()))();

  if (!(await hasProjectConsent(projectRoot))) {
    stderr.write(
      `Project not opted in: ${projectRoot}\n` +
        'Run `/comprehend init` to opt in.\n',
    );
    return 3;
  }

  const manifest = await readManifest(projectRoot);
  const { analyzed, failed } = await countSessions(projectRoot);
  const queued = await pendingCount(projectRoot);
  const lock = await readLock(projectRoot);
  const running = lock !== null;
  const recent = await latestWorkerRuns(projectRoot, 3);

  if (opts.ack) {
    await mkdir(dirname(ackedAtPath(projectRoot)), { recursive: true });
    await writeFile(ackedAtPath(projectRoot), '', 'utf8');
    try {
      const { utimes } = await import('node:fs/promises');
      await utimes(ackedAtPath(projectRoot), now, now);
    } catch {
      /* non-fatal */
    }
  }

  if (opts.json) {
    stdout.write(
      JSON.stringify({
        project_root: projectRoot,
        refiner_version: manifest.refiner_version,
        refiner_prompt_hash: manifest.refiner_prompt_hash,
        project_view_version: manifest.project_view_version,
        last_rebuild: manifest.last_rebuild,
        override_active: manifest.override_active,
        counts: { analyzed, failed, queued, running },
        lock: lock,
        recent_runs: recent,
        ack_applied: !!opts.ack,
      }) + '\n',
    );
    return 0;
  }

  const lines: string[] = [];
  lines.push(`FOS status — ${projectRoot}`);
  lines.push(`  refiner: ${manifest.refiner_version} (${manifest.refiner_prompt_hash || '<unset>'})`);
  lines.push(
    `  project_view_version=${manifest.project_view_version}` +
      (manifest.last_rebuild ? ` last_rebuild=${manifest.last_rebuild}` : ' last_rebuild=<never>'),
  );
  lines.push(
    `  analyzed=${analyzed} failed=${failed} queued=${queued} running=${running ? 'yes' : 'no'}`,
  );
  if (lock) {
    lines.push(`  lock: pid=${lock.pid} session=${lock.session_id} acquired_at=${lock.acquired_at}`);
  }
  lines.push(`  recent runs (${recent.length}):`);
  if (recent.length === 0) {
    lines.push('    (none)');
  } else {
    for (const r of recent) {
      const base = `    ${r.outcome.toUpperCase()} ${r.session_id} @ ${r.timestamp}`;
      if (r.outcome === 'success') {
        lines.push(`${base} concepts=${r.concept_count} unknowns=${r.unknown_count}`);
      } else if (r.outcome === 'failure') {
        lines.push(`${base} ${r.error_name}: ${r.message}`);
      } else {
        lines.push(base);
      }
    }
  }
  if (opts.ack) lines.push('  (failures acknowledged)');
  stdout.write(lines.join('\n') + '\n');
  return 0;
}

export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('show FOS analysis status for the current project')
    .option('--ack', 'mark all current failures as acknowledged')
    .option('--json', 'emit machine-readable JSON')
    .option('--project-root <path>', 'project root', process.cwd())
    .action(async (opts: { ack?: boolean; json?: boolean; projectRoot: string }) => {
      const statusOpts: StatusOpts = { projectRoot: opts.projectRoot };
      if (opts.ack !== undefined) statusOpts.ack = opts.ack;
      if (opts.json !== undefined) statusOpts.json = opts.json;
      const code = await runStatusSubcommand(statusOpts);
      process.exit(code);
    });
}
