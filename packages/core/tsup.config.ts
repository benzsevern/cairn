import { defineConfig } from 'tsup';
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/bin.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  async onSuccess() {
    const viewerSrc = resolve(__dirname, '../../apps/viewer/dist/template.html');
    const viewerDstDir = resolve(__dirname, 'dist/viewer');
    const viewerDst = resolve(viewerDstDir, 'template.html');
    await mkdir(viewerDstDir, { recursive: true });
    await copyFile(viewerSrc, viewerDst);
  },
});
