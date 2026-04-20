import type { ConceptNode, MergedConcept, ProjectView, SessionArtifact } from '../types.js';

function initMerged(slug: string, name: string, sessionId: string): MergedConcept {
  return {
    slug,
    name,
    introduced_in: sessionId,
    last_updated_in: sessionId,
    depends_on: [],
    depended_on_by: [],
    files: [],
    confidence: 'unknown',
    history: [],
    unknowns: [],
  };
}

function unionStrings(a: readonly string[], b: readonly string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

function mergeConceptInto(
  target: MergedConcept,
  c: ConceptNode,
  session: SessionArtifact,
): void {
  target.name = c.name;
  target.last_updated_in = session.session_id;
  target.files = unionStrings(target.files, c.files);
  target.confidence = c.confidence;

  const edges = new Map(target.depends_on.map((e) => [e.slug, e]));
  const assertedNow = new Set(c.depends_on);
  for (const dep of c.depends_on) {
    edges.set(dep, { slug: dep, status: 'active', last_asserted_in: session.session_id });
  }
  for (const [slug, edge] of edges) {
    if (!assertedNow.has(slug) && edge.status === 'active') {
      edges.set(slug, { ...edge, status: 'deprecated' });
    }
  }
  target.depends_on = [...edges.values()];

  target.history.push({
    session_id: session.session_id,
    analyzed_at: session.analyzed_at,
    kind: c.kind,
    summary: c.summary,
    reasoning: c.reasoning,
  });

  for (const u of session.unknowns) {
    if (u.slug_ref === c.slug) target.unknowns.push(u);
  }
}

export function mergeSessions(sessions: readonly SessionArtifact[]): ProjectView {
  const concepts = new Map<string, MergedConcept>();
  for (const s of sessions) {
    for (const c of s.concepts) {
      const existing = concepts.get(c.slug);
      if (existing) {
        mergeConceptInto(existing, c, s);
      } else {
        const fresh = initMerged(c.slug, c.name, s.session_id);
        concepts.set(c.slug, fresh);
        mergeConceptInto(fresh, c, s);
      }
    }
  }

  for (const merged of concepts.values()) {
    for (const edge of merged.depends_on) {
      if (edge.status !== 'active') continue;
      const parent = concepts.get(edge.slug);
      if (parent && !parent.depended_on_by.includes(merged.slug)) {
        parent.depended_on_by.push(merged.slug);
      }
    }
  }

  return {
    concepts,
    generated_at: new Date().toISOString(),
    project_view_version: 0,
  };
}
