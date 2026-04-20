import { describe, it, expect } from 'vitest';
import { readTranscript, MalformedTranscriptError } from '../../src/reader/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

describe('readTranscript — happy path', () => {
  it('parses a minimal two-event transcript', async () => {
    const path = resolve(here, '../fixtures/transcripts/minimal.jsonl');
    const events = await readTranscript(path);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: 'user',
      index: 0,
      text: 'Add a fuzzy matcher for company names.',
    });
    expect(events[1]).toMatchObject({
      kind: 'assistant',
      index: 1,
      text: expect.stringContaining('Levenshtein'),
    });
    expect(events[0]?.timestamp).toBe('2026-04-20T10:00:00Z');
  });
});

describe('readTranscript — tool events', () => {
  it('emits tool_use events with tool name', async () => {
    const path = resolve(here, '../fixtures/transcripts/tool-use.jsonl');
    const events = await readTranscript(path);
    const toolUses = events.filter((e) => e.kind === 'tool_use');
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0]?.toolName).toBe('Read');
    expect(toolUses[0]?.text).toBe('Read');
    expect(toolUses[0]?.toolSummary).toContain('src/app.ts');
  });

  it('emits tool_result events and records strippedSize', async () => {
    const path = resolve(here, '../fixtures/transcripts/tool-use.jsonl');
    const events = await readTranscript(path);
    const results = events.filter((e) => e.kind === 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0]?.strippedSize).toBeGreaterThan(0);
  });

  it('assigns monotonically increasing indices', async () => {
    const path = resolve(here, '../fixtures/transcripts/tool-use.jsonl');
    const events = await readTranscript(path);
    const indices = events.map((e) => e.index);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]!);
    }
  });
});

describe('readTranscript — unknown types are skipped', () => {
  it('silently skips attachment / permission-mode / other unknown types', async () => {
    const path = resolve(here, '../fixtures/transcripts/malformed.jsonl');
    const events = await readTranscript(path);
    // malformed.jsonl has 2 user events + 3 unknown-typed events (totally_unknown_kind, attachment, permission-mode).
    // Only the 2 user events should be emitted.
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'user', text: 'hi' });
    expect(events[1]).toMatchObject({ kind: 'user', text: 'after the unknowns' });
  });
});

describe('readTranscript — rejection', () => {
  it('throws MalformedTranscriptError on a known type with broken shape', async () => {
    const path = resolve(here, '../fixtures/transcripts/broken-user.jsonl');
    await expect(readTranscript(path)).rejects.toBeInstanceOf(MalformedTranscriptError);
    try {
      await readTranscript(path);
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedTranscriptError);
      const e = err as MalformedTranscriptError;
      expect(typeof e.lineIndex).toBe('number');
      expect(e.cause).toBeDefined();
    }
  });

  it('throws MalformedTranscriptError on invalid JSON lines', async () => {
    const tmp = resolve(here, '../fixtures/transcripts/invalid-line.jsonl');
    const { writeFile, unlink } = await import('node:fs/promises');
    await writeFile(tmp, 'not-json\n', 'utf8');
    try {
      await expect(readTranscript(tmp)).rejects.toBeInstanceOf(MalformedTranscriptError);
    } finally {
      await unlink(tmp);
    }
  });

  it('throws MalformedTranscriptError on lines with no "type" field', async () => {
    const tmp = resolve(here, '../fixtures/transcripts/no-type.jsonl');
    const { writeFile, unlink } = await import('node:fs/promises');
    await writeFile(tmp, '{"message":{"role":"user","content":"hi"}}\n', 'utf8');
    try {
      await expect(readTranscript(tmp)).rejects.toThrow(/no string "type" field/);
    } finally {
      await unlink(tmp);
    }
  });
});
