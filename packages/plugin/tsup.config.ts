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
  // commander is CJS; keep it external so Node resolves it at runtime from
  // the hoisted node_modules. The rest are inlined per spec §3 "self-contained
  // executables".
  noExternal: [/^@fos\//, 'zod', 'gray-matter', 'execa'],
});
