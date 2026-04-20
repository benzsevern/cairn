import type { ProjectView } from '../types.js';
import type { ExistingConceptSummary } from '../segmenter/serialize.js';

const MAX_SUMMARY = 180;

export function existingConceptSummaries(view: ProjectView): ExistingConceptSummary[] {
  const out: ExistingConceptSummary[] = [];
  for (const m of view.concepts.values()) {
    const latest = m.history[m.history.length - 1]?.summary ?? '';
    const summary =
      latest.length > MAX_SUMMARY ? latest.slice(0, MAX_SUMMARY - 1) + '…' : latest;
    out.push({ slug: m.slug, name: m.name, summary, files: m.files.slice(0, 3) });
  }
  return out;
}
