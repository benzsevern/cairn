import { describe, it, expect } from 'vitest';
import { serializePayload } from '../../src/segmenter/serialize.js';
import type { Segment } from '../../src/types.js';

describe('serializePayload', () => {
  const segments: Segment[] = [
    {
      index: 0,
      userEventIndex: 0,
      userText: 'build fuzzy matcher',
      assistantEventIndices: [1, 2],
      assistantActions: ['- tool-use[Edit] src/a.ts', '- working'],
      narrativeMarkers: ['Chose Levenshtein because length-sensitive.'],
    },
  ];
  const existing = [
    { slug: 'entity-resolution', name: 'Entity Resolution', summary: 'Pipeline for deduping records.', files: ['src/pipeline.ts'] },
  ];

  it('wraps existing concepts under <existing-concepts>', () => {
    const payload = serializePayload(segments, existing, 'first user goal');
    expect(payload).toContain('<existing-concepts>');
    expect(payload).toContain('entity-resolution');
    expect(payload).toContain('Pipeline for deduping records.');
  });

  it('renders each segment with user, actions, narrative', () => {
    const payload = serializePayload(segments, existing, 'first user goal');
    expect(payload).toContain('<segment index="1">');
    expect(payload).toContain('<user>build fuzzy matcher</user>');
    expect(payload).toContain('<assistant-actions>');
    expect(payload).toContain('tool-use[Edit]');
    expect(payload).toContain('<assistant-narrative>');
    expect(payload).toContain('Chose Levenshtein because');
  });

  it('omits <user-goal> when no opening user text', () => {
    const payload = serializePayload(segments, [], '');
    expect(payload).not.toContain('<user-goal>');
  });
});
