import { spawn } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyzeSession, rebuildProjectView } from '@fos/core';
import { pendingQueuePath } from './../plugin-paths.js';
import { appendLogEvent } from './../log.js';
import { releaseLock } from './../lock.js';

export interface WorkerArgs {
  projectRoot: string;
  transcriptPath: string;
  sessionId: string;
  now?: () => Date;
  // test seams — default to real implementations.
  analyzeSessionImpl?: typeof analyzeSession;
  rebuildImpl?: typeof rebuildProjectView;
  spawnChild?: (args: { projectRoot: string; transcriptPath: string; sessionId: string }) => void;
}

interface PendingQueueFile {
  queue: Array<{ session_id: string; transcript_path: string; queued_at: string }>;
}

async function readPending(projectRoot: string): Promise<PendingQueueFile> {
  try {
    const raw = await readFile(pendingQueuePath(projectRoot), 'utf8');
    return JSON.parse(raw) as PendingQueueFile;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return { queue: [] };
    throw err;
  }
}

async function writePending(projectRoot: string, q: PendingQueueFile): Promise<void> {
  const tmp = `${pendingQueuePath(projectRoot)}.tmp`;
  await writeFile(tmp, JSON.stringify(q, null, 2), 'utf8');
  await rename(tmp, pendingQueuePath(projectRoot));
}

function spawnChildDefault(args: { projectRoot: string; transcriptPath: string; sessionId: string }): void {
  // The worker file's own URL is what we re-invoke. At runtime (post-bundle)
  // this resolves to the built dist/worker/analyze-worker.js.
  const selfUrl = import.meta.url;
  const selfPath = fileURLToPath(selfUrl);
  spawn('node', [selfPath, args.projectRoot, args.transcriptPath, args.sessionId], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

async function drainOnePending(projectRoot: string, spawnChild: WorkerArgs['spawnChild']): Promise<void> {
  const pending = await readPending(projectRoot);
  if (pending.queue.length === 0) return;
  const next = pending.queue.shift()!;
  await writePending(projectRoot, pending);
  (spawnChild ?? spawnChildDefault)({
    projectRoot,
    transcriptPath: next.transcript_path,
    sessionId: next.session_id,
  });
}

export async function runWorker(args: WorkerArgs): Promise<void> {
  const now = args.now ?? (() => new Date());
  const started = now().toISOString();
  const analyze = args.analyzeSessionImpl ?? analyzeSession;
  const rebuild = args.rebuildImpl ?? rebuildProjectView;

  await appendLogEvent(args.projectRoot, args.sessionId, {
    kind: 'worker_started',
    session_id: args.sessionId,
    timestamp: started,
  });

  const startedAt = now().getTime();
  try {
    const result = await analyze({
      projectRoot: args.projectRoot,
      transcriptPath: args.transcriptPath,
      sessionId: args.sessionId,
      now,
    });
    await rebuild({ projectRoot: args.projectRoot, now });
    await appendLogEvent(args.projectRoot, args.sessionId, {
      kind: 'worker_success',
      session_id: args.sessionId,
      timestamp: now().toISOString(),
      concept_count: result.concept_count,
      unknown_count: result.unknown_count,
      elapsed_ms: now().getTime() - startedAt,
    });
  } catch (err) {
    const e = err as Error;
    await appendLogEvent(args.projectRoot, args.sessionId, {
      kind: 'worker_failure',
      session_id: args.sessionId,
      timestamp: now().toISOString(),
      error_name: e.name || 'Error',
      message: e.message || String(err),
      elapsed_ms: now().getTime() - startedAt,
    });
  }

  await releaseLock(args.projectRoot);
  await drainOnePending(args.projectRoot, args.spawnChild);
}

// CLI entry: node dist/worker/analyze-worker.js <projectRoot> <transcriptPath> <sessionId>
const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryHref) {
  const [, , projectRoot, transcriptPath, sessionId] = process.argv;
  if (!projectRoot || !transcriptPath || !sessionId) {
    console.error('usage: analyze-worker <projectRoot> <transcriptPath> <sessionId>');
    process.exit(2);
  }
  runWorker({ projectRoot, transcriptPath, sessionId }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
