import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphHtmlPath } from '../paths.js';
import type { GraphJson } from '../deriver/graph-json.js';

const PLACEHOLDER = '<!-- FOS_GRAPH_JSON_PLACEHOLDER -->';

async function templatePath(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  // In prod (running from dist/): dist/viewer/template.html lives next to the compiled JS.
  const candidates = [
    resolve(here, '..', 'viewer', 'template.html'),
    // In dev (running from src/ via vitest): fall back to the package's built template, or the viewer app's dist.
    resolve(here, '..', '..', 'dist', 'viewer', 'template.html'),
    resolve(here, '..', '..', '..', '..', 'apps', 'viewer', 'dist', 'template.html'),
  ];
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch {
      // try next
    }
  }
  throw new Error(
    `viewer template.html not found (looked in: ${candidates.join(', ')}). Run \`pnpm --filter @fos/viewer build\` and \`pnpm --filter @fos/core build\` first.`,
  );
}

function safeEmbed(graph: GraphJson): string {
  // </script> inside embedded JSON would close the tag. Escape defensively.
  const json = JSON.stringify(graph).replace(/<\/script>/gi, '<\\/script>');
  return `<script id="fos-graph-data" type="application/json">${json}</script>`;
}

export async function renderGraphHtml(projectRoot: string, graph: GraphJson): Promise<string> {
  const template = await readFile(await templatePath(), 'utf8');
  const html = template.replace(PLACEHOLDER, safeEmbed(graph));
  const target = graphHtmlPath(projectRoot);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, html, 'utf8');
  await rename(tmp, target);
  return target;
}
