import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const nativeExternal = ['camoufox-js', 'playwright-core'];

export default defineConfig({
  plugins: [tsconfigPaths()],
  build: {
    target: 'node20',
    outDir: 'build/bundle',
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    lib: {
      entry: { index: resolve(__dirname, 'src/cli/bundle.ts') },
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [...nativeExternal, ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: {
        entryFileNames: '[name].cjs',
        chunkFileNames: '[name].cjs',
        inlineDynamicImports: true,
      },
    },
  },
});
