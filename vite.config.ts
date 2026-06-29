import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const external = [
  'camoufox-js',
  'ora',
  'yargs',
  'yargs/helpers',
  'playwright-core',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

// Path aliases mirror tsconfig `paths`. Kept here (not imported from a shared
// module) so the build has no runtime dependency on tsconfig parsing.
const alias = {
  '@app': resolve(__dirname, 'src/app'),
  '@core': resolve(__dirname, 'src/core'),
  '@config': resolve(__dirname, 'src/config'),
  '@adapters': resolve(__dirname, 'src/adapters'),
  '@cli': resolve(__dirname, 'src/cli'),
};

// Library/CLI build: emit ESM, keep node deps external, preserve the
// `cli/index.js` entry so the `nexus` bin resolves.
export default defineConfig({
  resolve: { alias },
  build: {
    target: 'node20',
    outDir: 'dist',
    sourcemap: true,
    minify: false,
    lib: {
      entry: { 'cli/index': resolve(__dirname, 'src/cli/index.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      external,
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        banner: (chunk) => (chunk.fileName === 'cli/index.js' ? '#!/usr/bin/env node' : ''),
      },
    },
  },
});
