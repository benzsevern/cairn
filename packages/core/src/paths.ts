import { join } from 'node:path';

export function comprehensionDir(projectRoot: string): string {
  return join(projectRoot, '.comprehension');
}

export function sessionsDir(projectRoot: string): string {
  return join(comprehensionDir(projectRoot), 'sessions');
}

export function conceptsDir(projectRoot: string): string {
  return join(comprehensionDir(projectRoot), 'concepts');
}

export function fosDir(projectRoot: string): string {
  return join(comprehensionDir(projectRoot), '.fos');
}

export function cacheDir(projectRoot: string): string {
  return join(fosDir(projectRoot), 'cache');
}

export function manifestPath(projectRoot: string): string {
  return join(comprehensionDir(projectRoot), 'manifest.json');
}

export function graphJsonPath(projectRoot: string): string {
  return join(comprehensionDir(projectRoot), 'graph.json');
}

export function graphHtmlPath(projectRoot: string): string {
  return join(comprehensionDir(projectRoot), 'graph.html');
}

export function sessionFilePath(projectRoot: string, sessionId: string, isoDatePrefix: string): string {
  return join(sessionsDir(projectRoot), `${isoDatePrefix}-${sessionId}.md`);
}

export function conceptFilePath(projectRoot: string, slug: string): string {
  return join(conceptsDir(projectRoot), `${slug}.md`);
}

export function overridePromptPath(projectRoot: string): string {
  return join(fosDir(projectRoot), 'refiner-prompt.md');
}

export function failedStubPath(projectRoot: string, sessionId: string, isoDatePrefix: string): string {
  return join(sessionsDir(projectRoot), `${isoDatePrefix}-${sessionId}.failed.json`);
}
