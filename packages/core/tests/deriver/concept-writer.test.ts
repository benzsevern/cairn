import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dedupePrefix,
  renderConceptFile,
  writeConceptFiles,
} from '../../src/deriver/concept-writer.js';
import { conceptsDir } from '../../src/paths.js';
import type { MergedConcept, ProjectView } from '../../src/types.js';

function merged(p: Partial<MergedConcept> & { slug: string; name: string }): MergedConcept {
  return {
    introduced_in: 's1',
    last_updated_in: 's1',
    depends_on: [],
    depended_on_by: [],
    files: [],
    confidence: 'unknown',
    history: [],
    unknowns: [],
    ...p,
  };
}

function view(...concepts: MergedConcept[]): ProjectView {
  const map = new Map<string, MergedConcept>();
  for (const c of concepts) map.set(c.slug, c);
  return { concepts: map, generated_at: '2026-04-20T12:00:00Z', project_view_version: 1 };
}

describe('dedupePrefix', () => {
  it('drops entries whose first sentence matches an earlier entry (case-insensitive)', () => {
    const out = dedupePrefix([
      'Chose SQLite because it fits local-first',
      'chose sqlite because it fits local-first. extra detail',
      'Rejected Postgres because of setup cost',
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/Chose SQLite/);
    expect(out[1]).toMatch(/Rejected Postgres/);
  });
});

describe('renderConceptFile', () => {
  it('places the latest summary above the History section', () => {
    const c = merged({
      slug: 'a',
      name: 'Alpha',
      history: [
        {
          session_id: 's1',
          analyzed_at: '2026-01-01T00:00:00Z',
          kind: 'introduced',
          summary: 'First take',
          reasoning: [],
        },
        {
          session_id: 's2',
          analyzed_at: '2026-02-01T00:00:00Z',
          kind: 'refined',
          summary: 'Latest take',
          reasoning: [],
        },
      ],
    });
    const rendered = renderConceptFile(c);
    const summaryIdx = rendered.indexOf('Latest take');
    const historyIdx = rendered.indexOf('## History');
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(historyIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeLessThan(historyIdx);
  });

  it('lists deprecated edges only under "Previously depended on"', () => {
    const c = merged({
      slug: 'child',
      name: 'Child',
      depends_on: [
        { slug: 'active-parent', status: 'active', last_asserted_in: 's2' },
        { slug: 'dropped-parent', status: 'deprecated', last_asserted_in: 's1' },
      ],
    });
    const rendered = renderConceptFile(c);

    expect(rendered).toContain('## Previously depended on');
    expect(rendered).toContain('~~dropped-parent~~');
    expect(rendered).toContain('last asserted in s1');

    const fmMatch = /depends_on: \[([^\]]*)\]/.exec(rendered);
    expect(fmMatch).not.toBeNull();
    expect(fmMatch![1]!.split(',').map((s) => s.trim())).toEqual(['active-parent']);

    const related = rendered.split('## Related')[1] ?? '';
    expect(related).not.toContain('[[dropped-parent]]');
  });
});

describe('writeConceptFiles', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-cwriter-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes one file per concept named <slug>.md', async () => {
    const v = view(merged({ slug: 'a', name: 'Alpha' }), merged({ slug: 'b', name: 'Beta' }));
    await writeConceptFiles(tmp, v);
    const files = (await readdir(conceptsDir(tmp))).sort();
    expect(files).toEqual(['a.md', 'b.md']);
    const aText = await readFile(join(conceptsDir(tmp), 'a.md'), 'utf8');
    expect(aText).toContain('# Alpha');
  });

  it('prunes obsolete concept files on re-render when a slug disappears from the view', async () => {
    await mkdir(conceptsDir(tmp), { recursive: true });
    await writeFile(join(conceptsDir(tmp), 'stale.md'), '# stale\n', 'utf8');

    const v = view(merged({ slug: 'keep', name: 'Keep' }));
    await writeConceptFiles(tmp, v);

    const files = (await readdir(conceptsDir(tmp))).sort();
    expect(files).toEqual(['keep.md']);
  });
});
