import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/hooks/stop.ts',
    'src/hooks/session-start.ts',
    'src/cli/bin.ts',
    'src/worker/analyze-worker.ts',
  ],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node20',
  noExternal: [/^@fos\//, 'zod', 'gray-matter', 'execa', 'commander'],
});
