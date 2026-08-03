import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    globals: false,
    setupFiles: ['tests/setup.js'],
    reporters: ['verbose'],
    sequence: { concurrent: false },
  },
});
