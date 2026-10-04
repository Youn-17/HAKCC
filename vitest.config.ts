import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['components/**/*.test.ts', 'hooks/**/*.test.ts', 'services/**/*.test.ts', 'api/src/**/*.test.ts'],
  },
});
