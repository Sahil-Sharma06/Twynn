import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,
  // Shared is a source-only workspace package, so it must be bundled.
  noExternal: ['@twynn/shared'],
});
