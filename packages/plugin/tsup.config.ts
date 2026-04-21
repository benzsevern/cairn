import { defineConfig } from 'tsup';
import { resolve } from 'node:path';

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
  // pnpm on Windows with `symlink=false` + `node-linker=hoisted` does not
  // create an `@fos/core` entry in node_modules, so esbuild cannot resolve
  // the bare specifier. Alias it to the built ESM so `noExternal` can inline
  // the core engine into the worker bundle.
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      '@fos/core': resolve(__dirname, '../core/dist/index.js'),
    };
  },
});
