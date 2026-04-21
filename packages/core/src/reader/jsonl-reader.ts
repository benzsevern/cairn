import { readFile } from 'node:fs/promises';
import { TranscriptLineSchema } from './event-schema.js';
import type { TranscriptEvent, TranscriptEventKind } from '../types.js';

export class MalformedTranscriptError extends Error {
  readonly lineIndex: number;
  readonly cause: unknown;
  constructor(message: string, lineIndex: number, cause: unknown) {
    super(message);
    this.name = 'MalformedTranscriptError';
    this.lineIndex = lineIndex;
    this.cause = cause;
  }
}

const MAX_TOOL_SUMMARY = 120;

function summarize(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > MAX_TOOL_SUMMARY ? one.slice(0, MAX_TOOL_SUMMARY - 1) + '…' : one;
}

function withTs<T extends object>(obj: T, timestamp: string | undefined): T & { timestamp?: string } {
  return timestamp === undefined ? obj : { ...obj, timestamp };
}

function expandUserEvent(line: { message: { content: unknown } }, index: number, timestamp: string | undefined): TranscriptEvent[] {
  const { content } = line.message;
  if (typeof content === 'string') {
    return [withTs({ kind: 'user' as TranscriptEventKind, index, text: content }, timestamp)];
  }
  if (Array.isArray(content)) {
    const out: TranscriptEvent[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object' || !('type' in block) || typeof (block as { type: unknown }).type !== 'string') continue;
      const type = (block as { type: string }).type;
      if (type === 'tool_result') {
        const raw = typeof (block as { content: unknown }).content === 'string'
          ? ((block as { content: string }).content)
          : JSON.stringify((block as { content: unknown }).content ?? '');
        out.push(withTs({
          kind: 'tool_result' as TranscriptEventKind,
          index: index + out.length,
          text: summarize(raw),
          toolSummary: summarize(raw),
          strippedSize: raw.length,
        }, timestamp));
      }
      // Unknown user-side block types (e.g., `image`) are skipped.
    }
    if (out.length === 0) {
      return [withTs({ kind: 'user' as TranscriptEventKind, index, text: '' }, timestamp)];
    }
    return out;
  }
  return [withTs({ kind: 'user' as TranscriptEventKind, index, text: '' }, timestamp)];
}

function expandAssistantEvent(line: { message: { content: unknown } }, index: number, timestamp: string | undefined): TranscriptEvent[] {
  const { content } = line.message;
  if (typeof content === 'string') {
    return [withTs({ kind: 'assistant' as TranscriptEventKind, index, text: content }, timestamp)];
  }
  if (!Array.isArray(content)) {
    return [withTs({ kind: 'assistant' as TranscriptEventKind, index, text: '' }, timestamp)];
  }
  const out: TranscriptEvent[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object' || !('type' in block) || typeof (block as { type: unknown }).type !== 'string') continue;
    const b = block as { type: string; text?: unknown; name?: unknown; input?: unknown };
    if (b.type === 'tool_use') {
      const argSummary = summarize(JSON.stringify(b.input ?? {}));
      const name = typeof b.name === 'string' ? b.name : undefined;
      out.push(withTs({
        kind: 'tool_use' as TranscriptEventKind,
        index: index + out.length,
        text: name ?? '',
        ...(name !== undefined ? { toolName: name } : {}),
        toolSummary: argSummary,
      }, timestamp));
    } else if (b.type === 'text') {
      out.push(withTs({
        kind: 'assistant' as TranscriptEventKind,
        index: index + out.length,
        text: typeof b.text === 'string' ? b.text : '',
      }, timestamp));
    }
    // Other assistant-side block types (thinking, redacted_thinking, image, ...) are skipped.
  }
  return out;
}

/**
 * Event `type` values we recognize and parse. Real Claude Code transcripts
 * also contain `attachment`, `permission-mode`, `file-history-snapshot`,
 * `last-prompt`, etc. — those are skipped silently (they carry no information
 * useful for concept extraction). Unknown types with no `type` field at all
 * still throw, since that signals a genuinely malformed line.
 */
const KNOWN_KINDS = new Set(['user', 'assistant', 'system']);

export async function readTranscript(path: string): Promise<TranscriptEvent[]> {
  const raw = await readFile(path, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: TranscriptEvent[] = [];
  let index = 0;

  for (const line of lines) {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (e) {
      throw new MalformedTranscriptError(
        `Malformed JSON at line ${index + 1}`,
        index,
        e,
      );
    }

    const kind = (json && typeof json === 'object' && 'type' in json && typeof (json as { type: unknown }).type === 'string')
      ? (json as { type: string }).type
      : null;

    if (kind === null) {
      throw new MalformedTranscriptError(
        `Line ${index + 1} has no string "type" field`,
        index,
        json,
      );
    }

    // Unknown-but-typed events (attachment, permission-mode, etc.) are skipped.
    if (!KNOWN_KINDS.has(kind)) continue;

    const parsed = TranscriptLineSchema.safeParse(json);
    if (!parsed.success) {
      throw new MalformedTranscriptError(
        `Unrecognized transcript event at line ${index + 1}: ${parsed.error.message}`,
        index,
        parsed.error,
      );
    }
    const data = parsed.data;

    if (data.type === 'user') {
      const expanded = expandUserEvent(data, index, data.timestamp);
      out.push(...expanded);
      index += expanded.length;
    } else if (data.type === 'assistant') {
      const expanded = expandAssistantEvent(data, index, data.timestamp);
      out.push(...expanded);
      index += expanded.length;
    } else if (data.type === 'system') {
      out.push(withTs({
        kind: 'system' as TranscriptEventKind,
        index,
        text: data.content ?? data.subtype ?? '',
      }, data.timestamp));
      index += 1;
    }
  }

  return out;
}
