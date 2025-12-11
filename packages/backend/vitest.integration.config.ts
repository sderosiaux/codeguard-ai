import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 300000, // 5 minutes for LLM calls
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run serially to avoid rate limits
      },
    },
  },
});
