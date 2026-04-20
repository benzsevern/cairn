export function renderTranscriptRefs(refs: readonly number[]): string {
  if (refs.length === 0) return '[]';
  const sorted = [...new Set(refs)].sort((a, b) => a - b);
  return `[${sorted.map((n) => `tool-use:${n}`).join(', ')}]`;
}
