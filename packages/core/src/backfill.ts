import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { analyzeSession } from './analyze-session.js';
import { rebuildProjectView } from './rebuild-project-view.js';
import { readManifest, writeManifest } from './writer/manifest.js';
import { estimateCost, estimateTokens } from './cli/cost.js';
import type { BackfillReport } from './types.js';

export interface DiscoveredSession {
  sessionId: string;
  transcriptPath: string;
  sizeBytes: number;
  analyzedAt: string; // file mtime ISO
}

export async function discoverSessions(
  claudeProjectsDir: string,
  projectHash: string,
): Promise<DiscoveredSession[]> {
  const dir = join(claudeProjectsDir, projectHash);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err;
  }
  const jsonl = entries.filter((f) => f.endsWith('.jsonl'));
  const out: DiscoveredSession[] = [];
  for (const f of jsonl) {
    const path = join(dir, f);
    const st = await stat(path);
    out.push({
      sessionId: f.replace(/\.jsonl$/, ''),
      transcriptPath: path,
      sizeBytes: st.size,
      analyzedAt: st.mtime.toISOString(),
    });
  }
  out.sort((a, b) => a.analyzedAt.localeCompare(b.analyzedAt));
  return out;
}

export interface BackfillArgs {
  projectRoot: string;
  discovered: DiscoveredSession[];
  model: string;
  confirm: (summary: {
    count: number;
    totalInputTokens: number;
    usd_low: number;
    usd_high: number;
  }) => Promise<boolean>;
  invoke?: Parameters<typeof analyzeSession>[0]['invoke'];
  signal?: AbortSignal;
  now?: () => Date;
}

export async function backfill(args: BackfillArgs): Promise<BackfillReport> {
  const totalChars = args.discovered.reduce((a, d) => a + d.sizeBytes, 0);
  const totalInputTokens = Math.round(estimateTokens(totalChars));
  const cost = estimateCost(totalInputTokens, args.model);

  const ok = await args.confirm({
    count: args.discovered.length,
    totalInputTokens,
    usd_low: cost.usd_low,
    usd_high: cost.usd_high,
  });

  if (!ok) {
    return {
      discovered: args.discovered.length,
      analyzed: 0,
      skipped: [],
      failed: [],
      total_cost_usd: 0,
    };
  }

  const failed: BackfillReport['failed'] = [];
  let analyzed = 0;
  for (const d of args.discovered) {
    if (args.signal?.aborted) break;
    try {
      const analyzeArgs: Parameters<typeof analyzeSession>[0] = {
        projectRoot: args.projectRoot,
        transcriptPath: d.transcriptPath,
        sessionId: d.sessionId,
        model: args.model,
      };
      if (args.now !== undefined) analyzeArgs.now = args.now;
      if (args.invoke !== undefined) analyzeArgs.invoke = args.invoke;
      await analyzeSession(analyzeArgs);
      analyzed += 1;
    } catch (err) {
      failed.push({
        session_id: d.sessionId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (analyzed > 0) {
    const rebuildArgs: Parameters<typeof rebuildProjectView>[0] = { projectRoot: args.projectRoot };
    if (args.now !== undefined) rebuildArgs.now = args.now;
    await rebuildProjectView(rebuildArgs);
  }

  const m = await readManifest(args.projectRoot);
  m.opt_in.backfill_completed = true;
  m.opt_in.backfilled_session_count += analyzed;
  await writeManifest(args.projectRoot, m);

  // usd_high is the upper bound a user should plan around
  return {
    discovered: args.discovered.length,
    analyzed,
    skipped: [],
    failed,
    total_cost_usd: cost.usd_high,
  };
}
