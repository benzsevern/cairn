import { mkdir, writeFile, rename } from 'node:fs/promises';
import { sessionsDir, sessionFilePath } from '../paths.js';
import type { SessionArtifact } from '../types.js';
import { renderSessionArtifact } from './session-artifact.js';

export async function writeSessionArtifact(
  projectRoot: string,
  artifact: SessionArtifact,
  isoDatePrefix: string,
): Promise<string> {
  const dir = sessionsDir(projectRoot);
  await mkdir(dir, { recursive: true });
  const target = sessionFilePath(projectRoot, artifact.session_id, isoDatePrefix);
  const tmp = `${target}.tmp`;
  const content = renderSessionArtifact(artifact);
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, target);
  return target;
}
