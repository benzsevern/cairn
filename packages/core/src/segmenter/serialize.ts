import type { Segment } from '../types.js';

export interface ExistingConceptSummary {
  slug: string;
  name: string;
  summary: string;
  files: string[];
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function serializePayload(
  segments: Segment[],
  existing: ExistingConceptSummary[],
  userGoal: string,
): string {
  const parts: string[] = [];
  parts.push('<mission>');
  if (userGoal && userGoal.trim().length > 0) {
    parts.push(`  <user-goal>${escapeXml(userGoal.trim())}</user-goal>`);
  }
  parts.push('  <existing-concepts>');
  if (existing.length === 0) {
    parts.push('    (none yet — this is the first analyzed session for this project)');
  } else {
    for (const c of existing) {
      const files = c.files.length ? ` (files: ${c.files.slice(0, 3).join(', ')})` : '';
      parts.push(`    - ${c.slug}: "${escapeXml(c.name)}"${files} — "${escapeXml(c.summary)}"`);
    }
  }
  parts.push('  </existing-concepts>');
  parts.push('</mission>');
  parts.push('');

  for (const seg of segments) {
    // +1 so the refiner sees segments indexed from 1 (matches §4.1 of the spec).
    parts.push(`<segment index="${seg.index + 1}">`);
    if (seg.userText !== null) {
      parts.push(`  <user>${escapeXml(seg.userText)}</user>`);
    }
    parts.push('  <assistant-actions>');
    for (const a of seg.assistantActions) parts.push(`    ${a}`);
    parts.push('  </assistant-actions>');
    if (seg.narrativeMarkers.length > 0) {
      parts.push('  <assistant-narrative>');
      for (const m of seg.narrativeMarkers) parts.push(`    ${escapeXml(m)}`);
      parts.push('  </assistant-narrative>');
    }
    parts.push('</segment>');
    parts.push('');
  }

  return parts.join('\n');
}
