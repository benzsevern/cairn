import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { manifestPath } from '../paths.js';

export interface Manifest {
  schema_version: string;
  refiner_version: string;
  refiner_prompt_hash: string;
  last_rebuild: string | null;
  project_view_version: number;
  override_active: boolean;
  opt_in: {
    analyze_all_future_sessions: boolean;
    backfill_completed: boolean;
    backfilled_session_count: number;
    skipped_sessions: string[];
  };
}

export function defaultManifest(): Manifest {
  return {
    schema_version: '1.0.0',
    refiner_version: 'v1.0.0',
    refiner_prompt_hash: '',
    last_rebuild: null,
    project_view_version: 0,
    override_active: false,
    opt_in: {
      analyze_all_future_sessions: false,
      backfill_completed: false,
      backfilled_session_count: 0,
      skipped_sessions: [],
    },
  };
}

export async function readManifest(projectRoot: string): Promise<Manifest> {
  try {
    const raw = await readFile(manifestPath(projectRoot), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Manifest>;
    return { ...defaultManifest(), ...parsed, opt_in: { ...defaultManifest().opt_in, ...(parsed.opt_in ?? {}) } };
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return defaultManifest();
    throw err;
  }
}

export async function writeManifest(projectRoot: string, m: Manifest): Promise<void> {
  const target = manifestPath(projectRoot);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(m, null, 2), 'utf8');
  await rename(tmp, target);
}
