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
  // Inlined CJS dependencies (execa → cross-spawn) use `require()` at runtime.
  // In an ESM bundle `require` is not defined, which makes esbuild's
  // dynamic-require shim throw. Inject `createRequire(import.meta.url)` at
  // the top of every entry so those lookups resolve against the bundle's
  // location. See <https://github.com/evanw/esbuild/issues/1921>.
  banner: {
    js: "import { createRequire as __fosCreateRequire } from 'node:module'; const require = __fosCreateRequire(import.meta.url);",
  },
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
