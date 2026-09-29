import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['three-player-controller', 'three-mesh-bvh'] },
  publicDir: 'model-gs-ply',
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { main: 'index.html', collider: 'collider-preview.html' } },
  },
});
