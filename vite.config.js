import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Three.js por sí solo ronda los 550 kB minificado
    chunkSizeWarningLimit: 800,
  },
});
