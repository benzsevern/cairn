import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { sessionsDir } from '../paths.js';
import type {
  ConceptKind,
  ConceptNode,
  Confidence,
  SessionArtifact,
  Unknown,
} from '../types.js';

const CONCEPT_HEADER_RE = /^## Concept: (.+?)\s+\{#([a-z0-9-]+)\}\s*$/gm;
const UNKNOWN_HEADER_RE = /^## Unknowns\s*$/m;
const REFS_RE = /\*\*Transcript refs:\*\*\s+\[([^\]]*)\]/;
const KIND_RE = /\*\*Kind:\*\*\s+(introduced|refined|referenced)/;
const CONFIDENCE_RE = /\*\*Confidence:\*\*\s+(high|medium|low|unknown)/;
const DEPENDS_RE = /\*\*Depends on:\*\*\s+\[([^\]]*)\]/;
const FILES_RE = /\*\*Files:\*\*\s+(.+)$/m;
const SUMMARY_RE = /\*\*Summary\*\*\s*\n([\s\S]*?)(?:\n\*\*|$)/;
const REASONING_RE = /\*\*Reasoning[^*]*\*\*\s*\n((?:- .+\n?)+)/;
const UNKNOWN_BULLET_RE =
  /- \*\*reasoning-unknown: (.+?)\*\*(?:\s+\(concept: ([a-z0-9-]+)\))?\s*\n\s+Recovery prompt: "(.*?)"/g;

function parseCsvList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseRefs(raw: string): number[] {
  return parseCsvList(raw)
    .map((token) => {
      const m = /^tool-use:(\d+)$/.exec(token);
      return m ? Number.parseInt(m[1]!, 10) : Number.NaN;
    })
    .filter((n) => Number.isFinite(n));
}

function parseConceptSlice(name: string, slug: string, body: string): ConceptNode {
  const kindMatch = KIND_RE.exec(body);
  const kind: ConceptKind = (kindMatch?.[1] as ConceptKind | undefined) ?? 'referenced';

  const confMatch = CONFIDENCE_RE.exec(body);
  const confidence: Confidence = (confMatch?.[1] as Confidence | undefined) ?? 'unknown';

  const dependsMatch = DEPENDS_RE.exec(body);
  const depends_on = dependsMatch ? parseCsvList(dependsMatch[1] ?? '') : [];

  const filesMatch = FILES_RE.exec(body);
  const files = filesMatch ? parseCsvList(filesMatch[1] ?? '') : [];

  const summaryMatch = SUMMARY_RE.exec(body);
  const summary = summaryMatch ? (summaryMatch[1] ?? '').trim() : '';

  const reasoningMatch = REASONING_RE.exec(body);
  const reasoning = reasoningMatch
    ? (reasoningMatch[1] ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2).trim())
    : [];

  const refsMatch = REFS_RE.exec(body);
  const transcript_refs = refsMatch ? parseRefs(refsMatch[1] ?? '') : [];

  return {
    slug,
    name,
    kind,
    summary,
    reasoning,
    depends_on,
    files,
    transcript_refs,
    confidence,
  };
}

function parseUnknowns(area: string): Unknown[] {
  const out: Unknown[] = [];
  UNKNOWN_BULLET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UNKNOWN_BULLET_RE.exec(area)) !== null) {
    out.push({
      question: m[1] ?? '',
      slug_ref: (m[2] as string | undefined) ?? null,
      recovery_prompt: m[3] ?? '',
    });
  }
  return out;
}

function asString(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return v.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return String(v);
}

export function parseSessionMarkdown(raw: string): SessionArtifact {
  const { data, content } = matter(raw);

  const unknownHeaderMatch = UNKNOWN_HEADER_RE.exec(content);
  const conceptArea = unknownHeaderMatch
    ? content.slice(0, unknownHeaderMatch.index)
    : content;
  const unknownsArea = unknownHeaderMatch
    ? content.slice(unknownHeaderMatch.index + unknownHeaderMatch[0].length)
    : '';

  // Walk all `## Concept: Name {#slug}` headers and slice between consecutive ones.
  const headerMatches: Array<{ name: string; slug: string; headerStart: number; bodyStart: number }> = [];
  CONCEPT_HEADER_RE.lastIndex = 0;
  let hm: RegExpExecArray | null;
  while ((hm = CONCEPT_HEADER_RE.exec(conceptArea)) !== null) {
    headerMatches.push({
      name: (hm[1] ?? '').trim(),
      slug: hm[2] ?? '',
      headerStart: hm.index,
      bodyStart: hm.index + hm[0].length,
    });
  }

  const concepts: ConceptNode[] = headerMatches.map((h, i) => {
    const next = headerMatches[i + 1];
    const end = next ? next.headerStart : conceptArea.length;
    return parseConceptSlice(h.name, h.slug, conceptArea.slice(h.bodyStart, end));
  });

  const unknowns = parseUnknowns(unknownsArea);

  return {
    session_id: asString(data['session_id']),
    transcript_path: asString(data['transcript_path']),
    analyzed_at: asString(data['analyzed_at']),
    refiner_version: asString(data['refiner_version']),
    refiner_prompt_hash: asString(data['refiner_prompt_hash']),
    model: asString(data['model']),
    segment_count: Number(data['segment_count'] ?? 0),
    concept_count: Number(data['concept_count'] ?? concepts.length),
    unknown_count: Number(data['unknown_count'] ?? unknowns.length),
    concepts,
    unknowns,
  };
}

export async function loadAllSessions(projectRoot: string): Promise<SessionArtifact[]> {
  const dir = sessionsDir(projectRoot);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const mdFiles = entries.filter((n) => n.endsWith('.md') && !n.endsWith('.failed.json'));
  const artifacts: SessionArtifact[] = [];
  for (const name of mdFiles) {
    const raw = await readFile(join(dir, name), 'utf8');
    artifacts.push(parseSessionMarkdown(raw));
  }
  artifacts.sort((a, b) => a.analyzed_at.localeCompare(b.analyzed_at));
  return artifacts;
}
