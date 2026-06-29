import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Live smoke tests are opt-in (NEXUS_LIVE_TESTS=1). They self-skip when
    // the env var is unset, so they are safe to keep in the default include.
  },
});
