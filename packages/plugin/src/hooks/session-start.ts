import { readFile, readdir, stat, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hasProjectConsent } from '../consent.js';
import { readLock } from '../lock.js';
import { latestFailureTimestamp, readLogEvents } from '../log.js';
import {
  sessionsDir,
  ackedAtPath,
  pendingQueuePath,
  logsDir,
} from '../plugin-paths.js';
import { readPayloadFromClaudeCode, PayloadReadError } from './stop.js';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

async function ackedAtMtime(projectRoot: string): Promise<Date | null> {
  try {
    return (await stat(ackedAtPath(projectRoot))).mtime;
  } catch {
    return null;
  }
}

async function pendingQueueLength(projectRoot: string): Promise<number> {
  try {
    const raw = await readFile(pendingQueuePath(projectRoot), 'utf8');
    const parsed = JSON.parse(raw) as { queue: unknown[] };
    return parsed.queue.length;
  } catch {
    return 0;
  }
}

async function hasAnalyzedSessions(projectRoot: string): Promise<boolean> {
  try {
    const entries = await readdir(sessionsDir(projectRoot));
    return entries.some((e) => e.endsWith('.md'));
  } catch {
    return false;
  }
}

async function findStalledDetach(projectRoot: string, now: Date): Promise<boolean> {
  let entries: string[] = [];
  try {
    entries = await readdir(logsDir(projectRoot));
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.log')) continue;
    const sessionId = entry.slice(0, -4);
    const events = await readLogEvents(projectRoot, sessionId);
    const hasSpawn = events.find((e) => e.kind === 'spawned_at');
    const hasStart = events.find((e) => e.kind === 'worker_started');
    const hasTerminal = events.find((e) => e.kind === 'worker_success' || e.kind === 'worker_failure');
    if (hasSpawn && !hasStart && !hasTerminal) {
      const age = now.getTime() - new Date(hasSpawn.timestamp).getTime();
      if (age > FIVE_MINUTES_MS) return true;
    }
  }
  return false;
}

export interface SessionStartArgs {
  projectRoot: string;
  now?: () => Date;
  stdout?: NodeJS.WritableStream;
}

export async function pickSessionStartMessage(args: SessionStartArgs): Promise<string | null> {
  const now = (args.now ?? (() => new Date()))();
  if (!(await hasProjectConsent(args.projectRoot))) return null;

  // Priority 1: failure_seen — failure timestamp newer than acked_at mtime
  const lastFail = await latestFailureTimestamp(args.projectRoot);
  const ackedMtime = await ackedAtMtime(args.projectRoot);
  const failureSeen = !!lastFail && (!ackedMtime || new Date(lastFail) > ackedMtime);
  if (failureSeen) {
    return '⚠ Last FOS analysis failed — run /comprehend status to see why.';
  }

  // Priority 2: stalled_detach — spawned_at > 5min without worker_started
  if (await findStalledDetach(args.projectRoot, now)) {
    return '⚠ FOS worker appears stalled — run /comprehend status.';
  }

  // Priority 3: pending > 0
  const pending = await pendingQueueLength(args.projectRoot);
  if (pending > 0) {
    return `FOS: ${pending} session(s) queued, analysis running in background.`;
  }

  // Priority 4: first_session — consent exists but no sessions yet
  if (!(await hasAnalyzedSessions(args.projectRoot))) {
    return 'FOS: opted in but no sessions analyzed yet — your first session will be analyzed on Stop.';
  }

  // Priority 5: running — lock exists and none of the above
  const lock = await readLock(args.projectRoot);
  if (lock) {
    const since = Math.floor((now.getTime() - new Date(lock.acquired_at).getTime()) / 1000);
    return `FOS: background analysis running for ${since}s.`;
  }

  // Priority 6: silent
  return null;
}

/**
 * SessionStart hooks surface context via a JSON envelope on stdout (per Phase 0
 * probe findings §2.4). Claude Code reads `hookSpecificOutput.additionalContext`
 * and injects it into the session. When there is nothing to say we write
 * nothing at all — Claude Code won't surface empty output to the user.
 *
 * TODO(plan-3): Cursor uses a different shape — top-level `additional_context`.
 * Branch on CLAUDE_PLUGIN_ROOT vs CURSOR_PLUGIN_ROOT env vars once Cursor
 * support lands.
 */
function emitAdditionalContext(msg: string, stdout: NodeJS.WritableStream): void {
  const envelope = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: msg,
    },
  };
  stdout.write(JSON.stringify(envelope) + '\n');
}

export async function runSessionStart(args: SessionStartArgs): Promise<number> {
  const msg = await pickSessionStartMessage(args);
  if (msg !== null) {
    emitAdditionalContext(msg, args.stdout ?? process.stdout);
  }
  return 0;
}

// See note in stop.ts — basename check survives tsup's bundle-time dead-code elimination.
const _argv1 = process.argv[1] ?? '';
if (_argv1.endsWith('session-start.js') || _argv1.endsWith('session-start.ts')) {
  void (async () => {
    try {
      const { discoverProjectRoot } = await import('../discover-project.js');
      let cwd = process.cwd();
      try {
        const payload = await readPayloadFromClaudeCode();
        if (payload.cwd) cwd = payload.cwd;
      } catch (err) {
        // If stdin is missing or malformed we still attempt discovery from cwd.
        if (!(err instanceof PayloadReadError)) throw err;
      }
      const projectRoot = await discoverProjectRoot(cwd);
      const code = await runSessionStart({ projectRoot });
      process.exit(code);
    } catch (err) {
      // Never block Claude Code startup on an internal error. Log + exit 0.
      try {
        const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? homedir();
        const crashPath = join(home, '.fos-plugin-crash.log');
        await appendFile(
          crashPath,
          `[${new Date().toISOString()}] session-start: ${String(err)}\n`,
          'utf8',
        );
      } catch {
        /* ignore */
      }
      process.exit(0);
    }
  })();
}
