import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: 'model-gs-ply',
  build: { chunkSizeWarningLimit: 2000 },
});
