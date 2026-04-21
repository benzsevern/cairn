import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFile, readFile, mkdir, rename, appendFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { hasProjectConsent } from '../consent.js';
import { tryAcquireLock, tryAcquireQueueLock, releaseQueueLock } from '../lock.js';
import { appendLogEvent } from '../log.js';
import { pendingQueuePath } from '../plugin-paths.js';

export interface StopArgs {
  projectRoot: string;
  sessionId: string;
  transcriptPath: string;
  now?: () => Date;
  spawnChild?: (args: { projectRoot: string; transcriptPath: string; sessionId: string }) => void;
  homeOverride?: string;
}

export interface StopHookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  hook_event_name?: string;
  reason?: string;
}

export class PayloadReadError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PayloadReadError';
  }
}

async function queuePending(
  projectRoot: string,
  sessionId: string,
  transcriptPath: string,
  queuedAt: string,
  now: () => Date,
): Promise<void> {
  // Serialize concurrent Stop hooks via a short-lived queue.lock file so two
  // racing writers can't each read the same pending.json and clobber one another.
  const acquired = await tryAcquireQueueLock(
    projectRoot,
    { pid: process.pid, session_id: sessionId },
    { now },
  );
  // If we still can't get the lock after retries, fall through and best-effort
  // write — losing a queued entry is preferable to blocking Claude Code shutdown.
  try {
    let current: { queue: Array<{ session_id: string; transcript_path: string; queued_at: string }> } = { queue: [] };
    try {
      const raw = await readFile(pendingQueuePath(projectRoot), 'utf8');
      current = JSON.parse(raw);
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
    }
    current.queue.push({ session_id: sessionId, transcript_path: transcriptPath, queued_at: queuedAt });
    await mkdir(dirname(pendingQueuePath(projectRoot)), { recursive: true });
    const tmp = `${pendingQueuePath(projectRoot)}.tmp`;
    await writeFile(tmp, JSON.stringify(current, null, 2), 'utf8');
    await rename(tmp, pendingQueuePath(projectRoot));
  } finally {
    if (acquired) await releaseQueueLock(projectRoot);
  }
}

function spawnChildDefault(args: { projectRoot: string; transcriptPath: string; sessionId: string }): void {
  const selfPath = fileURLToPath(import.meta.url);
  const workerPath = resolve(dirname(selfPath), '..', 'worker', 'analyze-worker.js');
  spawn(process.execPath, [workerPath, args.projectRoot, args.transcriptPath, args.sessionId], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

export async function runStop(args: StopArgs): Promise<number> {
  const now = args.now ?? (() => new Date());
  if (!(await hasProjectConsent(args.projectRoot))) return 0;

  const acquired = await tryAcquireLock(
    args.projectRoot,
    { pid: process.pid, session_id: args.sessionId },
    { now },
  );

  const spawnChild = args.spawnChild ?? spawnChildDefault;

  if (!acquired) {
    await queuePending(args.projectRoot, args.sessionId, args.transcriptPath, now().toISOString(), now);
    return 0;
  }

  await appendLogEvent(args.projectRoot, args.sessionId, {
    kind: 'spawned_at',
    session_id: args.sessionId,
    timestamp: now().toISOString(),
    transcript_path: args.transcriptPath,
  });

  spawnChild({
    projectRoot: args.projectRoot,
    transcriptPath: args.transcriptPath,
    sessionId: args.sessionId,
  });

  return 0;
}

/**
 * Read the Stop hook payload from stdin.
 *
 * Per Phase 0 probe findings §2.2, Claude Code delivers the payload as a
 * single JSON object on stdin terminated by EOF. We guard with a 1-second
 * timeout so a mis-configured invocation can never hang Claude Code shutdown.
 * Any failure (timeout, non-JSON, IO error) throws a PayloadReadError that
 * the CLI entrypoint's catch converts into a silent exit 0 + crash log.
 */
export async function readPayloadFromClaudeCode(
  opts: { stdin?: NodeJS.ReadableStream; timeoutMs?: number } = {},
): Promise<StopHookPayload> {
  const stdin = opts.stdin ?? process.stdin;
  const timeoutMs = opts.timeoutMs ?? 1000;

  const raw = await new Promise<string>((res, rej) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const timer = setTimeout(() => {
      settle(() => rej(new PayloadReadError(`stdin timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    // Don't keep the event loop alive just for this timer.
    if (typeof timer.unref === 'function') timer.unref();

    stdin.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    stdin.on('end', () => {
      clearTimeout(timer);
      settle(() => res(Buffer.concat(chunks).toString('utf8')));
    });
    stdin.on('error', (err) => {
      clearTimeout(timer);
      settle(() => rej(new PayloadReadError('stdin error', err)));
    });
  });

  if (raw.trim().length === 0) {
    throw new PayloadReadError('stdin payload was empty');
  }
  try {
    return JSON.parse(raw) as StopHookPayload;
  } catch (err) {
    throw new PayloadReadError('stdin payload was not valid JSON', err);
  }
}

// Detect "running as the bundled script" via a basename check on argv[1].
// We can't use `import.meta.url === pathToFileURL(process.argv[1]).href` because
// tsup/esbuild evaluates the comparison at bundle time and tree-shakes the
// block. basename matching on process.argv[1] survives bundling and doesn't
// fire during vitest (which runs its own runner as argv[1], not our script).
const _argv1 = process.argv[1] ?? '';
if (_argv1.endsWith('stop.js') || _argv1.endsWith('stop.ts')) {
  void (async () => {
    try {
      const { discoverProjectRoot, sessionContextFromPayload } = await import('../discover-project.js');
      const payload = await readPayloadFromClaudeCode();
      const cwd = payload.cwd ?? process.cwd();
      const projectRoot = await discoverProjectRoot(cwd);
      const ctxPayload: {
        sessionId?: string;
        transcriptPath?: string;
        cwd?: string;
        projectRoot: string;
      } = { projectRoot, cwd };
      if (payload.session_id !== undefined) ctxPayload.sessionId = payload.session_id;
      if (payload.transcript_path !== undefined) ctxPayload.transcriptPath = payload.transcript_path;
      const ctx = sessionContextFromPayload(ctxPayload);
      const code = await runStop(ctx);
      process.exit(code);
    } catch (err) {
      // Never block Claude Code shutdown on an internal error. Log + exit 0.
      try {
        const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? homedir();
        const crashPath = join(home, '.fos-plugin-crash.log');
        await appendFile(crashPath, `[${new Date().toISOString()}] stop: ${String(err)}\n`, 'utf8');
      } catch { /* ignore */ }
      process.exit(0);
    }
  })();
}
