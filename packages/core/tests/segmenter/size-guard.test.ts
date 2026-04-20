import { describe, it, expect } from 'vitest';
import { serializePayloadWithGuard, PAYLOAD_SOFT_CAP_CHARS } from '../../src/segmenter/serialize.js';
import type { Segment } from '../../src/types.js';

describe('payload size guard', () => {
  it('throws a specific error type when payload exceeds cap', () => {
    const huge: Segment = {
      index: 0,
      userEventIndex: 0,
      userText: 'x'.repeat(PAYLOAD_SOFT_CAP_CHARS + 10),
      assistantEventIndices: [],
      assistantActions: [],
      narrativeMarkers: [],
    };
    expect(() => serializePayloadWithGuard([huge], [], 'x')).toThrow(/PayloadTooLarge/);
  });

  it('allows payloads at or below the cap', () => {
    const small: Segment = {
      index: 0,
      userEventIndex: 0,
      userText: 'small ask',
      assistantEventIndices: [],
      assistantActions: [],
      narrativeMarkers: [],
    };
    expect(() => serializePayloadWithGuard([small], [], 'small')).not.toThrow();
  });
});
