import type { Segment, TranscriptEvent } from '../types.js';
import { segmentByUserTurn } from './boundary.js';
import { compact } from './compactor.js';

export { segmentByUserTurn } from './boundary.js';
export { compact } from './compactor.js';
export { serializePayload } from './serialize.js';
export type { ExistingConceptSummary } from './serialize.js';
export { serializePayloadWithGuard, PayloadTooLargeError, PAYLOAD_SOFT_CAP_CHARS } from './serialize.js';

export function segment(events: TranscriptEvent[]): Segment[] {
  return segmentByUserTurn(events).map((s) => compact(s, events));
}

export function firstUserGoal(events: TranscriptEvent[]): string {
  const first = events.find((e) => e.kind === 'user' && e.text.trim().length > 0);
  return first?.text ?? '';
}
