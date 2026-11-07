import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@conductor/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@conductor/ide-core': path.resolve(__dirname, 'packages/ide-core/src/index.ts'),
      '@conductor/adapters': path.resolve(__dirname, 'packages/adapters/src/index.ts'),
      '@conductor/ui': path.resolve(__dirname, 'packages/ui/src/index.ts'),
      '@conductor/mock-cli': path.resolve(__dirname, 'packages/mock-cli/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/__tests__/**/*.test.{ts,tsx}', 'apps/*/src/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    environment: 'node',
    globals: true,
  },
});
