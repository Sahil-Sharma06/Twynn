import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each suite boots an in-process Postgres and runs every migration; allow for busy machines.
    hookTimeout: 30_000,
  },
});
