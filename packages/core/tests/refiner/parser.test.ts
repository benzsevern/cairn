import { describe, it, expect } from 'vitest';
import { parseRefinerResponse } from '../../src/refiner/parser.js';

describe('parseRefinerResponse', () => {
  it('parses bare JSON', () => {
    const raw = '{"concepts":[],"unknowns":[]}';
    const parsed = parseRefinerResponse(raw);
    expect(parsed).toEqual({ concepts: [], unknowns: [] });
  });

  it('strips ```json fenced code blocks', () => {
    const raw = '```json\n{"concepts":[],"unknowns":[]}\n```';
    expect(parseRefinerResponse(raw)).toEqual({ concepts: [], unknowns: [] });
  });

  it('strips bare ``` fenced code blocks', () => {
    const raw = '```\n{"concepts":[],"unknowns":[]}\n```';
    expect(parseRefinerResponse(raw)).toEqual({ concepts: [], unknowns: [] });
  });

  it('strips leading/trailing prose and extracts the outermost JSON object', () => {
    const raw = 'Here is my analysis:\n\n{"concepts":[],"unknowns":[]}\n\nLet me know if you need more.';
    expect(parseRefinerResponse(raw)).toEqual({ concepts: [], unknowns: [] });
  });

  it('throws a typed error on unparseable input', () => {
    expect(() => parseRefinerResponse('not json at all')).toThrow(/RefinerParseError/);
  });
});
