import { access, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

export async function discoverProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd);
  // walk up at most 40 levels
  for (let i = 0; i < 40; i++) {
    if (await exists(join(current, '.git')) || await exists(join(current, '.comprehension'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(cwd);
}

export async function findClaudeCodeProjectHash(
  projectRoot: string,
  opts: { claudeProjectsDir?: string } = {},
): Promise<string | null> {
  const dir = opts.claudeProjectsDir ?? join(homedir(), '.claude', 'projects');
  let hashes: string[] = [];
  try { hashes = await readdir(dir); } catch { return null; }

  const wantNormalized = resolve(projectRoot).toLowerCase();

  for (const hash of hashes) {
    const hashDir = join(dir, hash);
    let files: string[] = [];
    try { const st = await stat(hashDir); if (!st.isDirectory()) continue; files = await readdir(hashDir); }
    catch { continue; }
    const jsonl = files.find((f) => f.endsWith('.jsonl'));
    if (!jsonl) continue;
    try {
      const content = await readFile(join(hashDir, jsonl), 'utf8');
      const firstLine = content.split('\n', 1)[0]!;
      const parsed = JSON.parse(firstLine) as { cwd?: string };
      if (parsed.cwd && resolve(parsed.cwd).toLowerCase() === wantNormalized) return hash;
    } catch { /* skip */ }
  }
  return null;
}

export interface SessionContext {
  projectRoot: string;
  sessionId: string;
  transcriptPath: string;
}

/**
 * Build a SessionContext from whatever payload Claude Code passes to hooks.
 * The exact payload shape is documented in probe-findings.md — this function
 * accepts a superset (stdin JSON, argv, env) and normalizes.
 */
export function sessionContextFromPayload(payload: {
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  projectRoot: string;
}): SessionContext {
  return {
    projectRoot: payload.projectRoot,
    sessionId: payload.sessionId ?? 'unknown-session',
    transcriptPath: payload.transcriptPath ?? '',
  };
}
