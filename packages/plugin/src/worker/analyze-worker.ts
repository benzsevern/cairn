import { pathToFileURL } from 'node:url';

export async function main(): Promise<void> {
  console.error('[@fos/plugin analyze-worker] not yet implemented (Phase 4)');
  process.exit(1);
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryHref) {
  main().catch((err) => { console.error(err); process.exit(2); });
}
