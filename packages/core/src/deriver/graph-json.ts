import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { graphJsonPath } from '../paths.js';
import type { ProjectView } from '../types.js';

export interface GraphJsonNode {
  slug: string;
  name: string;
  confidence: string;
  introduced_in: string;
  file_count: number;
  session_touch_count: number;
  has_unknowns: boolean;
}

export interface GraphJsonEdge {
  from: string;
  to: string;
  kind: 'depends_on';
  status: 'active' | 'deprecated';
}

export interface GraphJson {
  schema_version: '1.0.0';
  generated_at: string;
  project_view_version: number;
  nodes: GraphJsonNode[];
  edges: GraphJsonEdge[];
}

export function buildGraphJson(view: ProjectView): GraphJson {
  const nodes: GraphJsonNode[] = [];
  const edges: GraphJsonEdge[] = [];
  for (const m of view.concepts.values()) {
    nodes.push({
      slug: m.slug,
      name: m.name,
      confidence: m.confidence,
      introduced_in: m.introduced_in,
      file_count: m.files.length,
      session_touch_count: m.history.length,
      has_unknowns: m.unknowns.length > 0,
    });
    for (const edge of m.depends_on) {
      edges.push({ from: m.slug, to: edge.slug, kind: 'depends_on', status: edge.status });
    }
  }
  nodes.sort((a, b) => a.slug.localeCompare(b.slug));
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return {
    schema_version: '1.0.0',
    generated_at: view.generated_at,
    project_view_version: view.project_view_version,
    nodes,
    edges,
  };
}

export async function writeGraphJson(projectRoot: string, view: ProjectView): Promise<void> {
  const target = graphJsonPath(projectRoot);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(buildGraphJson(view), null, 2), 'utf8');
  await rename(tmp, target);
}
