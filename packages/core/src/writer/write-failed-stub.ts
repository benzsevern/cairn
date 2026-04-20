import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { failedStubPath } from '../paths.js';

export interface FailedStubInput {
  attempts: Array<{ attempt: number; kind: string; detail?: string }>;
  lastRaw: string;
  reason: string;
}

export async function writeFailedStub(
  projectRoot: string,
  sessionId: string,
  isoDatePrefix: string,
  input: FailedStubInput,
): Promise<string> {
  const target = failedStubPath(projectRoot, sessionId, isoDatePrefix);
  await mkdir(dirname(target), { recursive: true });
  const payload = {
    session_id: sessionId,
    written_at: new Date().toISOString(),
    reason: input.reason,
    attempts: input.attempts,
    last_raw: input.lastRaw,
  };
  await writeFile(target, JSON.stringify(payload, null, 2), 'utf8');
  return target;
}
