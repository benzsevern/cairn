import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderGraphHtml } from '../../src/viewer/render-html.js';
import { graphHtmlPath } from '../../src/paths.js';
import type { GraphJson } from '../../src/deriver/graph-json.js';

describe('renderGraphHtml', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-html-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('injects graph.json into the template via fos-graph-data script tag', async () => {
    const graph: GraphJson = {
      schema_version: '1.0.0',
      generated_at: 't',
      project_view_version: 1,
      nodes: [],
      edges: [],
    };
    await renderGraphHtml(tmp, graph);
    const html = await readFile(graphHtmlPath(tmp), 'utf8');
    expect(html).toContain('<script id="fos-graph-data" type="application/json">');
    expect(html).toContain('"schema_version":"1.0.0"');
    expect(html).not.toContain('FOS_GRAPH_JSON_PLACEHOLDER');
  });

  it('escapes </script> sequences in the JSON payload', async () => {
    const graph: GraphJson = {
      schema_version: '1.0.0',
      generated_at: 't',
      project_view_version: 1,
      nodes: [
        {
          slug: 'x',
          name: '</script>',
          confidence: 'high',
          introduced_in: 'a',
          file_count: 0,
          session_touch_count: 1,
          has_unknowns: false,
        },
      ],
      edges: [],
    };
    await renderGraphHtml(tmp, graph);
    const html = await readFile(graphHtmlPath(tmp), 'utf8');
    // No unescaped </script> should appear inside the embedded JSON payload.
    // Everything between the opening fos-graph-data script tag and its closing </script>
    // should contain no bare </script>.
    const start = html.indexOf('<script id="fos-graph-data" type="application/json">');
    expect(start).toBeGreaterThanOrEqual(0);
    const afterOpen = start + '<script id="fos-graph-data" type="application/json">'.length;
    const close = html.indexOf('</script>', afterOpen);
    expect(close).toBeGreaterThan(afterOpen);
    const payload = html.slice(afterOpen, close);
    expect(payload).not.toMatch(/<\/script>/i);
    expect(payload).toContain('<\\/script>');
  });

  it('produces valid HTML with zero nodes', async () => {
    await renderGraphHtml(tmp, {
      schema_version: '1.0.0',
      generated_at: 't',
      project_view_version: 0,
      nodes: [],
      edges: [],
    });
    const html = await readFile(graphHtmlPath(tmp), 'utf8');
    expect(html).toContain('"nodes":[]');
    expect(html).toContain('"edges":[]');
  });
});
