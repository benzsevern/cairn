import { describe, it, expect } from 'vitest';
import { compact } from '../../src/segmenter/compactor.js';
import type { Segment, TranscriptEvent } from '../../src/types.js';

describe('compact', () => {
  it('produces one-liner actions for tool_use events and strips tool_result bodies', () => {
    const events: TranscriptEvent[] = [
      { kind: 'user', index: 0, text: 'do it' },
      { kind: 'assistant', index: 1, text: 'working' },
      { kind: 'tool_use', index: 2, text: 'Edit', toolName: 'Edit', toolSummary: '{"file_path":"src/a.ts","old":"x","new":"y"}' },
      { kind: 'tool_result', index: 3, text: 'ok', toolSummary: 'ok', strippedSize: 2000 },
    ];
    const seg: Segment = {
      index: 0,
      userEventIndex: 0,
      userText: 'do it',
      assistantEventIndices: [1, 2, 3],
      assistantActions: [],
      narrativeMarkers: [],
    };
    const filled = compact(seg, events);
    expect(filled.assistantActions.length).toBe(3);
    expect(filled.assistantActions[1]).toMatch(/tool-use\[Edit\]/);
    expect(filled.assistantActions[2]).toMatch(/tool-result.*<stripped ~2000 bytes>/);
  });

  it('extracts "because" / "chose" / "rejected" markers verbatim', () => {
    const events: TranscriptEvent[] = [
      { kind: 'user', index: 0, text: 'implement fuzzy matching' },
      { kind: 'assistant', index: 1, text: 'I will use Levenshtein. Chose Levenshtein over Jaro-Winkler because the inputs are long names. Rejected `fast-levenshtein` because it lacks Unicode normalization.' },
    ];
    const seg: Segment = {
      index: 0,
      userEventIndex: 0,
      userText: 'implement fuzzy matching',
      assistantEventIndices: [1],
      assistantActions: [],
      narrativeMarkers: [],
    };
    const filled = compact(seg, events);
    expect(filled.narrativeMarkers).toEqual(expect.arrayContaining([
      expect.stringContaining('Chose Levenshtein over Jaro-Winkler because'),
      expect.stringContaining('Rejected `fast-levenshtein` because'),
    ]));
  });
});
