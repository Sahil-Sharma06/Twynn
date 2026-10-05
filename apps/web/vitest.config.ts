import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts: Vitest runs on its own Vite, so JSX is compiled by esbuild here.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
