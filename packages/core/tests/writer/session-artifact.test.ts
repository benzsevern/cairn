import { describe, it, expect } from 'vitest';
import { renderSessionArtifact } from '../../src/writer/session-artifact.js';
import type { SessionArtifact } from '../../src/types.js';

const artifact: SessionArtifact = {
  session_id: 'sess-abc',
  transcript_path: '~/.claude/projects/hash/sess-abc.jsonl',
  analyzed_at: '2026-04-20T15:42:11Z',
  refiner_version: 'v1.0.0',
  refiner_prompt_hash: 'sha256:deadbeef',
  model: 'claude-opus-4-7',
  segment_count: 3,
  concept_count: 1,
  unknown_count: 1,
  concepts: [
    {
      slug: 'fuzzy-matching',
      name: 'Fuzzy Matching',
      kind: 'introduced',
      summary: 'Levenshtein matcher for company names.',
      reasoning: ['Chose Levenshtein because X.', 'Rejected Y because Z.'],
      depends_on: ['entity-resolution'],
      files: ['src/matching/fuzzy.ts', 'src/matching/types.ts'],
      transcript_refs: [12, 14, 17],
      confidence: 'high',
    },
  ],
  unknowns: [
    {
      slug_ref: 'fuzzy-matching',
      question: 'Why threshold 0.82?',
      recovery_prompt: 'What led you to 0.82 specifically?',
    },
  ],
};

describe('renderSessionArtifact', () => {
  it('emits YAML frontmatter with all required fields', () => {
    const md = renderSessionArtifact(artifact);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('session_id: sess-abc');
    expect(md).toContain('refiner_version: v1.0.0');
    expect(md).toContain('refiner_prompt_hash: sha256:deadbeef');
    expect(md).toContain('segment_count: 3');
  });

  it('renders each concept as an H2 with a slug anchor', () => {
    const md = renderSessionArtifact(artifact);
    expect(md).toContain('## Concept: Fuzzy Matching  {#fuzzy-matching}');
    expect(md).toContain('**Kind:** introduced');
    expect(md).toContain('**Depends on:** [entity-resolution]');
    expect(md).toContain('**Files:** src/matching/fuzzy.ts, src/matching/types.ts');
  });

  it('renders summary, reasoning bullets, and transcript refs in tool-use:N form', () => {
    const md = renderSessionArtifact(artifact);
    expect(md).toContain('Levenshtein matcher for company names.');
    expect(md).toContain('- Chose Levenshtein because X.');
    expect(md).toContain('- Rejected Y because Z.');
    expect(md).toContain('**Transcript refs:** [tool-use:12, tool-use:14, tool-use:17]');
  });

  it('renders the unknowns section when present', () => {
    const md = renderSessionArtifact(artifact);
    expect(md).toContain('## Unknowns');
    expect(md).toContain('**reasoning-unknown: Why threshold 0.82?**');
    expect(md).toContain('Recovery prompt: "What led you to 0.82 specifically?"');
  });

  it('omits the unknowns section when there are none', () => {
    const md = renderSessionArtifact({ ...artifact, unknowns: [], unknown_count: 0 });
    expect(md).not.toContain('## Unknowns');
  });

  it('handles no depends_on as an empty list', () => {
    const md = renderSessionArtifact({
      ...artifact,
      concepts: [{ ...artifact.concepts[0]!, depends_on: [] }],
    });
    expect(md).toContain('**Depends on:** []');
  });
});
