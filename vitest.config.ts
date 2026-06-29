import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Live smoke tests are opt-in (NEXUS_LIVE_TESTS=1). They self-skip when
    // the env var is unset, so they are safe to keep in the default include.
  },
});
