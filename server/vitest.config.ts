import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@crm/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/cli/**', 'src/main.ts'] },
  },
});
