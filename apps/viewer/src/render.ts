import cytoscape, { type ElementsDefinition, type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);

export interface GraphJson {
  schema_version: string;
  generated_at: string;
  project_view_version: number;
  nodes: Array<{
    slug: string;
    name: string;
    confidence: string;
    introduced_in: string;
    file_count: number;
    session_touch_count: number;
    has_unknowns: boolean;
  }>;
  edges: Array<{ from: string; to: string; kind: string; status?: string }>;
}

function confidenceColor(c: string): string {
  switch (c) {
    case 'high':
      return '#4ade80';
    case 'medium':
      return '#facc15';
    case 'low':
      return '#fb923c';
    default:
      return '#94a3b8';
  }
}

export function renderGraph(graph: GraphJson): void {
  const mount = document.getElementById('graph');
  if (!mount) throw new Error('no #graph mount');

  const elements: ElementsDefinition = {
    nodes: graph.nodes.map((n) => ({
      data: {
        id: n.slug,
        label: n.name,
        color: confidenceColor(n.confidence),
        has_unknowns: n.has_unknowns,
      },
    })),
    edges: graph.edges.map((e, i) => ({
      data: {
        id: `e-${i}`,
        source: e.from,
        target: e.to,
        deprecated: e.status === 'deprecated',
      },
    })),
  };

  cytoscape({
    container: mount,
    elements,
    layout: { name: 'dagre', rankDir: 'TB', nodeSep: 40, rankSep: 80 } as unknown as LayoutOptions,
    style: [
      {
        selector: 'node',
        style: {
          'background-color': 'data(color)',
          label: 'data(label)',
          'font-size': 11,
          color: '#0b1020',
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': 110,
          width: 120,
          height: 44,
          shape: 'round-rectangle',
        },
      },
      {
        selector: 'node[has_unknowns]',
        style: {
          'border-width': 2,
          'border-color': '#ef4444',
          'border-style': 'dashed',
        },
      },
      {
        selector: 'edge',
        style: {
          width: 2,
          'line-color': '#64748b',
          'target-arrow-color': '#64748b',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
        },
      },
      {
        selector: 'edge[?deprecated]',
        style: {
          'line-style': 'dashed',
          'line-color': '#475569',
          opacity: 0.5,
        },
      },
    ],
  });
}

// When the template is loaded in prod, pick up inlined graph data.
if (typeof window !== 'undefined') {
  const script = document.getElementById('fos-graph-data');
  if (script && script.textContent) {
    try {
      renderGraph(JSON.parse(script.textContent) as GraphJson);
    } catch {
      // swallow — dev mode may not have inlined data
    }
  }
}
