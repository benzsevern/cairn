import {
  loadAllSessions,
  mergeSessions,
  writeConceptFiles,
  buildGraphJson,
  writeGraphJson,
  renderGraphHtml,
} from './deriver/index.js';
import { readManifest, writeManifest } from './writer/index.js';

export interface RebuildArgs {
  projectRoot: string;
  now?: () => Date;
}

export async function rebuildProjectView(args: RebuildArgs): Promise<void> {
  const now = args.now ?? (() => new Date());
  const manifest = await readManifest(args.projectRoot);
  const nextVersion = manifest.project_view_version + 1;

  const sessions = await loadAllSessions(args.projectRoot);
  const view = mergeSessions(sessions);
  view.project_view_version = nextVersion;
  view.generated_at = now().toISOString();

  await writeConceptFiles(args.projectRoot, view);
  await writeGraphJson(args.projectRoot, view);
  await renderGraphHtml(args.projectRoot, buildGraphJson(view));

  manifest.project_view_version = nextVersion;
  manifest.last_rebuild = view.generated_at;
  await writeManifest(args.projectRoot, manifest);
}
