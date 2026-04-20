import type { Segment, TranscriptEvent } from '../types.js';

const NARRATIVE_PATTERNS = [
  /\b(chose|choosing|picked|selected)\b[^.]*?\bbecause\b[^.]*\./gi,
  /\b(rejected|avoided|skipped|discarded)\b[^.]*?\bbecause\b[^.]*\./gi,
  /\bbecause\b[^.]*\./gi,
];

function extractMarkers(text: string): string[] {
  const found = new Set<string>();
  for (const pat of NARRATIVE_PATTERNS) {
    const matches = text.match(pat);
    if (matches) for (const m of matches) found.add(m.trim());
  }
  return [...found];
}

function formatAction(ev: TranscriptEvent): string {
  if (ev.kind === 'tool_use') {
    return `- tool-use[${ev.toolName ?? '?'}] ${ev.toolSummary ?? ''}`.trim();
  }
  if (ev.kind === 'tool_result') {
    return `- tool-result${ev.strippedSize ? ` <stripped ~${ev.strippedSize} bytes>` : ''}`;
  }
  const oneLine = ev.text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 160 ? `- ${oneLine.slice(0, 159)}…` : `- ${oneLine}`;
}

export function compact(seg: Segment, events: TranscriptEvent[]): Segment {
  const byIndex = new Map(events.map((e) => [e.index, e]));
  const actions: string[] = [];
  const markers: string[] = [];

  for (const idx of seg.assistantEventIndices) {
    const ev = byIndex.get(idx);
    if (!ev) continue;
    actions.push(formatAction(ev));
    if (ev.kind === 'assistant') {
      markers.push(...extractMarkers(ev.text));
    }
  }

  return { ...seg, assistantActions: actions, narrativeMarkers: Array.from(new Set(markers)) };
}
