import { mkdir, readFile, writeFile, access, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { consentPath, fosDir, installAckPath } from './plugin-paths.js';

export interface ProjectConsent {
  opted_in_at: string;
  acknowledged_install: true;
  scope: 'this-project';
}

interface HomeOpts { homeOverride?: string }

function ackPathFor(opts: HomeOpts): string {
  if (opts.homeOverride) return join(opts.homeOverride, '.claude', 'fos-install-ack');
  return installAckPath();
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function hasInstallAck(opts: HomeOpts = {}): Promise<boolean> {
  return exists(ackPathFor(opts));
}

export async function writeInstallAck(opts: HomeOpts = {}): Promise<void> {
  const target = ackPathFor(opts);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, '', 'utf8');
}

export async function hasProjectConsent(projectRoot: string): Promise<boolean> {
  return exists(consentPath(projectRoot));
}

export async function writeProjectConsent(
  projectRoot: string,
  partial: { opted_in_at: string },
): Promise<void> {
  await mkdir(fosDir(projectRoot), { recursive: true });
  const record: ProjectConsent = {
    opted_in_at: partial.opted_in_at,
    acknowledged_install: true,
    scope: 'this-project',
  };
  const tmp = `${consentPath(projectRoot)}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
  await rename(tmp, consentPath(projectRoot));
}

export async function readProjectConsent(projectRoot: string): Promise<ProjectConsent> {
  const raw = await readFile(consentPath(projectRoot), 'utf8');
  return JSON.parse(raw) as ProjectConsent;
}
