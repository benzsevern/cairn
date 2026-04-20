export interface GraphJson {
  schema_version: string;
  generated_at: string;
  project_view_version: number;
  nodes: Array<{ slug: string; name: string; confidence: string; file_count: number; session_touch_count: number; has_unknowns: boolean }>;
  edges: Array<{ from: string; to: string; kind: string; status?: string }>;
}

export function renderGraph(graph: GraphJson): void {
  const mount = document.getElementById('graph');
  if (!mount) throw new Error('no #graph mount');
  mount.textContent = `nodes=${graph.nodes.length} edges=${graph.edges.length}`;
}

if (typeof window !== 'undefined' && !window.location.pathname.includes('main.ts')) {
  const script = document.getElementById('fos-graph-data');
  if (script) {
    const data = JSON.parse(script.textContent ?? '{}');
    renderGraph(data as GraphJson);
  }
}
