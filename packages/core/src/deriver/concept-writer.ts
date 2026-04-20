import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { conceptFilePath, conceptsDir } from '../paths.js';
import type { MergedConcept, ProjectView } from '../types.js';

/** Dedupe reasoning bullets by first-sentence lowercased prefix. */
export function dedupePrefix(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const firstSentence = trimmed.split(/[.!?]/)[0] ?? trimmed;
    const key = firstSentence.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function isoDate(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? (m[1] ?? iso) : iso;
}

export function renderFrontmatter(m: MergedConcept): string {
  const activeDeps = m.depends_on.filter((e) => e.status === 'active').map((e) => e.slug);
  const lines = [
    '---',
    `slug: ${m.slug}`,
    `name: ${m.name}`,
    `confidence: ${m.confidence}`,
    `introduced_in: ${m.introduced_in}`,
    `last_updated_in: ${m.last_updated_in}`,
    `depends_on: [${activeDeps.join(', ')}]`,
    `files: [${m.files.join(', ')}]`,
    '---',
    '',
  ];
  return lines.join('\n');
}

export function renderBody(m: MergedConcept): string {
  const parts: string[] = [];
  parts.push(`# ${m.name}`, '');

  const latest = m.history[m.history.length - 1];
  if (latest && latest.summary) {
    parts.push('## Summary', '', latest.summary, '');
  }

  const allReasoning = m.history.flatMap((h) => h.reasoning);
  const deduped = dedupePrefix(allReasoning);
  if (deduped.length > 0) {
    parts.push('## Reasoning', '');
    for (const r of deduped) parts.push(`- ${r}`);
    parts.push('');
  }

  if (m.history.length > 0) {
    parts.push('## History', '');
    for (const h of m.history) {
      parts.push(`- **${isoDate(h.analyzed_at)}** (${h.kind}): ${h.summary}`);
    }
    parts.push('');
  }

  const deprecated = m.depends_on.filter((e) => e.status === 'deprecated');
  if (deprecated.length > 0) {
    parts.push('## Previously depended on', '');
    for (const e of deprecated) {
      parts.push(`- ~~${e.slug}~~ (last asserted in ${e.last_asserted_in})`);
    }
    parts.push('');
  }

  const activeDeps = m.depends_on.filter((e) => e.status === 'active');
  const related = [
    ...activeDeps.map((e) => `- depends on [[${e.slug}]]`),
    ...m.depended_on_by.map((s) => `- depended on by [[${s}]]`),
  ];
  if (related.length > 0) {
    parts.push('## Related', '');
    parts.push(...related);
    parts.push('');
  }

  if (m.unknowns.length > 0) {
    parts.push('## Open questions', '');
    for (const u of m.unknowns) {
      parts.push(`- ${u.question}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

export function renderConceptFile(m: MergedConcept): string {
  return renderFrontmatter(m) + renderBody(m);
}

export async function writeConceptFiles(projectRoot: string, view: ProjectView): Promise<void> {
  const dir = conceptsDir(projectRoot);
  await mkdir(dir, { recursive: true });

  const keepSlugs = new Set<string>();
  for (const merged of view.concepts.values()) {
    keepSlugs.add(merged.slug);
    const target = conceptFilePath(projectRoot, merged.slug);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, renderConceptFile(merged), 'utf8');
    await rename(tmp, target);
  }

  const listing = await readdir(dir);
  for (const name of listing) {
    if (!name.endsWith('.md')) continue;
    const slug = name.slice(0, -3);
    if (!keepSlugs.has(slug)) {
      await rm(join(dir, name), { force: true });
    }
  }
}
