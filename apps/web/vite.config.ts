import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: true, // Listen on all network addresses (LAN access for mobile)
    proxy: {
      '/api': {
        target: 'http://localhost:48280',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:48280',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});

