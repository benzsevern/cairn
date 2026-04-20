import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

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
