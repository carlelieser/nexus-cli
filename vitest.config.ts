import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = {
  '@app': resolve(__dirname, 'src/app'),
  '@core': resolve(__dirname, 'src/core'),
  '@config': resolve(__dirname, 'src/config'),
  '@adapters': resolve(__dirname, 'src/adapters'),
  '@cli': resolve(__dirname, 'src/cli'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Live smoke tests are opt-in (NEXUS_LIVE_TESTS=1). They self-skip when
    // the env var is unset, so they are safe to keep in the default include.
  },
});
