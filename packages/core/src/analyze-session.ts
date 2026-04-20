import { readTranscript } from './reader/index.js';
import {
  segment,
  firstUserGoal,
  serializePayloadWithGuard,
  PayloadTooLargeError,
} from './segmenter/index.js';
import {
  loadAllSessions,
  mergeSessions,
  existingConceptSummaries,
} from './deriver/index.js';
import {
  loadRefinerPrompt,
  refineWithRetry,
  RefinerFailure,
  type InvokeFn,
  invokeClaude,
  type Runner,
} from './refiner/index.js';
import {
  writeSessionArtifact,
  writeFailedStub,
  readManifest,
  writeManifest,
} from './writer/index.js';
import type { SessionArtifact } from './types.js';

export interface AnalyzeSessionArgs {
  projectRoot: string;
  transcriptPath: string;
  sessionId: string;
  model?: string;
  now?: () => Date;
  /** Override the LLM call (for tests). When omitted, uses `claude -p` via execa. */
  invoke?: InvokeFn;
  claudeBin?: string;
  timeoutMs?: number;
  runner?: Runner;
  maxAttempts?: number;
}

function isoDatePrefix(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function analyzeSession(args: AnalyzeSessionArgs): Promise<SessionArtifact> {
  const now = args.now ?? (() => new Date());
  const datePrefix = isoDatePrefix(now());
  const analyzedAt = now().toISOString();

  const existingSessions = await loadAllSessions(args.projectRoot);
  const existingView = mergeSessions(existingSessions);
  const existing = existingConceptSummaries(existingView);
  const existingSlugs = new Set(existingView.concepts.keys());

  const events = await readTranscript(args.transcriptPath);
  const segments = segment(events);
  const goal = firstUserGoal(events);

  const prompt = await loadRefinerPrompt(args.projectRoot);

  let userInput: string;
  try {
    userInput = serializePayloadWithGuard(segments, existing, goal);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      await writeFailedStub(args.projectRoot, args.sessionId, datePrefix, {
        attempts: [{ attempt: 0, kind: 'payload_too_large', detail: err.message }],
        lastRaw: '',
        reason: 'PayloadTooLargeError',
      });
    }
    throw err;
  }

  const defaultInvoke: InvokeFn = async ({ systemPrompt, userInput: ui }) => {
    const invokeArgs: Parameters<typeof invokeClaude>[0] = {
      systemPrompt,
      userInput: ui,
      claudeBin: args.claudeBin ?? 'claude',
      timeoutMs: args.timeoutMs ?? 120_000,
    };
    if (args.runner !== undefined) invokeArgs.runner = args.runner;
    return invokeClaude(invokeArgs);
  };

  try {
    const output = await refineWithRetry({
      systemPrompt: prompt.text,
      userInput,
      existingSlugs,
      maxAttempts: args.maxAttempts ?? 2,
      invoke: args.invoke ?? defaultInvoke,
    });

    const artifact: SessionArtifact = {
      session_id: args.sessionId,
      transcript_path: args.transcriptPath,
      analyzed_at: analyzedAt,
      refiner_version: prompt.version,
      refiner_prompt_hash: prompt.hash,
      model: args.model ?? 'unknown',
      segment_count: segments.length,
      concept_count: output.concepts.length,
      unknown_count: output.unknowns.length,
      concepts: output.concepts,
      unknowns: output.unknowns,
    };

    await writeSessionArtifact(args.projectRoot, artifact, datePrefix);

    const manifest = await readManifest(args.projectRoot);
    manifest.refiner_version = prompt.version;
    manifest.refiner_prompt_hash = prompt.hash;
    manifest.override_active = prompt.overrideActive;
    await writeManifest(args.projectRoot, manifest);

    return artifact;
  } catch (err) {
    if (err instanceof RefinerFailure) {
      await writeFailedStub(args.projectRoot, args.sessionId, datePrefix, {
        attempts: err.attempts.map((a) => {
          const entry: { attempt: number; kind: string; detail?: string } = {
            attempt: a.attempt,
            kind: a.kind,
          };
          if (a.detail !== undefined) entry.detail = a.detail;
          return entry;
        }),
        lastRaw: err.lastRaw,
        reason: 'RefinerFailure',
      });
    }
    throw err;
  }
}
