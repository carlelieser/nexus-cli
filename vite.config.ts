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

// Library/CLI build: emit ESM, keep node deps external, preserve the
// `cli/index.js` entry so the `nexus` bin resolves.
export default defineConfig({
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
