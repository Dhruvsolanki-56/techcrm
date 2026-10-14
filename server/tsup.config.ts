import { defineConfig } from 'tsup';

// One bundled ES module for production; node_modules stay external, the shared workspace package is bundled in.
export default defineConfig({
  entry: ['src/main.ts', 'src/cli/migrate.ts', 'src/cli/seed.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@crm/shared'],
  splitting: true,
});
