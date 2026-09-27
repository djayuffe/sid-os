import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Keep the config valid for Vite's native/runner config loader as well as the
// default bundled loader. The latter used to mask this by injecting a global
// `__dirname`, while the runner loader correctly evaluates the file as ESM.
const projectDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: { port: 3000, host: '0.0.0.0' },
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(projectDir, '.') } },
});
