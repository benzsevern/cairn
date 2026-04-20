import type { ConceptNode, SessionArtifact, Unknown } from '../types.js';
import { renderTranscriptRefs } from './render-refs.js';

function renderFrontmatter(a: SessionArtifact): string {
  const lines = [
    '---',
    `session_id: ${a.session_id}`,
    `transcript_path: ${a.transcript_path}`,
    `analyzed_at: ${a.analyzed_at}`,
    `refiner_version: ${a.refiner_version}`,
    `refiner_prompt_hash: ${a.refiner_prompt_hash}`,
    `model: ${a.model}`,
    `segment_count: ${a.segment_count}`,
    `concept_count: ${a.concept_count}`,
    `unknown_count: ${a.unknown_count}`,
    '---',
    '',
  ];
  return lines.join('\n');
}

function renderConcept(c: ConceptNode): string {
  const lines = [
    `## Concept: ${c.name}  {#${c.slug}}`,
    '',
    `**Kind:** ${c.kind}`,
    `**Confidence:** ${c.confidence}`,
    `**Depends on:** [${c.depends_on.join(', ')}]`,
    `**Files:** ${c.files.join(', ')}`,
    '',
    '**Summary**',
    c.summary,
    '',
  ];
  if (c.reasoning.length > 0) {
    lines.push('**Reasoning (why these decisions)**');
    for (const r of c.reasoning) lines.push(`- ${r}`);
    lines.push('');
  }
  lines.push(`**Transcript refs:** ${renderTranscriptRefs(c.transcript_refs)}`);
  lines.push('');
  return lines.join('\n');
}

function renderUnknown(u: Unknown): string {
  const ref = u.slug_ref ? ` (concept: ${u.slug_ref})` : '';
  return [
    `- **reasoning-unknown: ${u.question}**${ref}`,
    `  Recovery prompt: "${u.recovery_prompt}"`,
  ].join('\n');
}

export function renderSessionArtifact(a: SessionArtifact): string {
  const parts: string[] = [renderFrontmatter(a)];
  for (const c of a.concepts) parts.push(renderConcept(c));
  if (a.unknowns.length > 0) {
    parts.push('## Unknowns');
    parts.push('');
    for (const u of a.unknowns) parts.push(renderUnknown(u));
    parts.push('');
  }
  return parts.join('\n');
}
