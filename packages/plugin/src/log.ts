import { mkdir, readFile, appendFile, readdir } from 'node:fs/promises';
import { logsDir, logFilePath } from './plugin-paths.js';

export type LogEvent =
  | { kind: 'spawned_at'; session_id: string; timestamp: string; transcript_path?: string }
  | { kind: 'worker_started'; session_id: string; timestamp: string }
  | { kind: 'worker_success'; session_id: string; timestamp: string; concept_count: number; unknown_count: number; elapsed_ms: number }
  | { kind: 'worker_failure'; session_id: string; timestamp: string; error_name: string; message: string; elapsed_ms: number }
  | { kind: 'backfill_batch'; session_id: '_batch'; timestamp: string; analyzed: number; failed: number; total_cost_usd: number; elapsed_ms: number };

export async function appendLogEvent(projectRoot: string, sessionId: string, event: LogEvent): Promise<void> {
  await mkdir(logsDir(projectRoot), { recursive: true });
  await appendFile(logFilePath(projectRoot, sessionId), JSON.stringify(event) + '\n', 'utf8');
}

export async function readLogEvents(projectRoot: string, sessionId: string): Promise<LogEvent[]> {
  try {
    const raw = await readFile(logFilePath(projectRoot, sessionId), 'utf8');
    return raw.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as LogEvent);
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err;
  }
}

export async function latestEvent(projectRoot: string, sessionId: string): Promise<LogEvent | null> {
  const events = await readLogEvents(projectRoot, sessionId);
  return events.length > 0 ? events[events.length - 1]! : null;
}

export async function latestFailureTimestamp(projectRoot: string): Promise<string | null> {
  let entries: string[] = [];
  try { entries = await readdir(logsDir(projectRoot)); } catch { return null; }
  let latest: string | null = null;
  for (const entry of entries) {
    if (!entry.endsWith('.log')) continue;
    const sessionId = entry.slice(0, -4);
    const events = await readLogEvents(projectRoot, sessionId);
    for (const ev of events) {
      if (ev.kind === 'worker_failure') {
        if (!latest || ev.timestamp > latest) latest = ev.timestamp;
      }
    }
  }
  return latest;
}
