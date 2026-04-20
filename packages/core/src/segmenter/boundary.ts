import type { Segment, TranscriptEvent } from '../types.js';

export function segmentByUserTurn(events: TranscriptEvent[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  let segIndex = 0;

  const newSegment = (userEvent: TranscriptEvent | null): Segment => ({
    index: segIndex++,
    userEventIndex: userEvent?.index ?? null,
    userText: userEvent?.text ?? null,
    assistantEventIndices: [],
    assistantActions: [],
    narrativeMarkers: [],
  });

  for (const ev of events) {
    if (ev.kind === 'user') {
      if (current) segments.push(current);
      current = newSegment(ev);
    } else {
      if (!current) current = newSegment(null);
      current.assistantEventIndices.push(ev.index);
    }
  }
  if (current) segments.push(current);
  return segments;
}
