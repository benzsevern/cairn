import { describe, it, expect } from 'vitest';
import { segmentByUserTurn } from '../../src/segmenter/boundary.js';
import type { TranscriptEvent } from '../../src/types.js';

function e(kind: TranscriptEvent['kind'], index: number, text = ''): TranscriptEvent {
  return { kind, index, text };
}

describe('segmentByUserTurn', () => {
  it('starts a new segment at every user event', () => {
    const events: TranscriptEvent[] = [
      e('user', 0, 'first ask'),
      e('assistant', 1, 'sure'),
      e('tool_use', 2),
      e('tool_result', 3),
      e('user', 4, 'second ask'),
      e('assistant', 5, 'ok'),
    ];
    const segments = segmentByUserTurn(events);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.userText).toBe('first ask');
    expect(segments[0]?.assistantEventIndices).toEqual([1, 2, 3]);
    expect(segments[1]?.userText).toBe('second ask');
    expect(segments[1]?.assistantEventIndices).toEqual([5]);
  });

  it('emits a leading synthetic segment if the transcript opens with assistant events', () => {
    const events: TranscriptEvent[] = [
      e('assistant', 0, 'preamble'),
      e('user', 1, 'real ask'),
    ];
    const segments = segmentByUserTurn(events);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.userEventIndex).toBeNull();
    expect(segments[0]?.userText).toBeNull();
    expect(segments[0]?.assistantEventIndices).toEqual([0]);
    expect(segments[1]?.userText).toBe('real ask');
  });

  it('treats tool_result events as assistant-side activity, not new turns', () => {
    const events: TranscriptEvent[] = [
      e('user', 0, 'ask'),
      e('assistant', 1),
      e('tool_use', 2),
      e('tool_result', 3),
      e('assistant', 4),
    ];
    const segments = segmentByUserTurn(events);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.assistantEventIndices).toEqual([1, 2, 3, 4]);
  });
});
