import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  root: path.resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@conductor/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@conductor/ide-core': path.resolve(__dirname, '../../packages/ide-core/src/index.ts'),
      '@conductor/adapters': path.resolve(__dirname, '../../packages/adapters/src/index.ts'),
      '@conductor/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
});
