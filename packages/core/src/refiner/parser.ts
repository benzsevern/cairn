export class RefinerParseError extends Error {
  constructor(public readonly raw: string, public readonly cause: unknown) {
    super(`RefinerParseError: could not extract JSON from refiner response. Cause: ${String(cause)}`);
    this.name = 'RefinerParseError';
  }
}

function stripFences(s: string): string {
  const fenced = s.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  return fenced ? fenced[1]!.trim() : s.trim();
}

function extractOutermostJsonObject(s: string): string {
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('no JSON object found');
  }
  return s.slice(first, last + 1);
}

export function parseRefinerResponse(raw: string): unknown {
  const cleaned = stripFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    try {
      return JSON.parse(extractOutermostJsonObject(cleaned));
    } catch (e2) {
      throw new RefinerParseError(raw, e2);
    }
  }
}
