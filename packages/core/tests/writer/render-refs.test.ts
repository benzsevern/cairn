import { describe, it, expect } from 'vitest';
import { renderTranscriptRefs } from '../../src/writer/render-refs.js';

describe('renderTranscriptRefs', () => {
  it('renders bare ints as tool-use:N', () => {
    expect(renderTranscriptRefs([12, 14, 17])).toBe('[tool-use:12, tool-use:14, tool-use:17]');
  });

  it('renders empty array as empty brackets', () => {
    expect(renderTranscriptRefs([])).toBe('[]');
  });

  it('sorts ascending and dedupes', () => {
    expect(renderTranscriptRefs([14, 12, 14, 17])).toBe('[tool-use:12, tool-use:14, tool-use:17]');
  });
});
