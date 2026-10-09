import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist-collab-demo', rollupOptions: { input: 'collab-demo.html' } },
  server: { host: '127.0.0.1', port: 3110, strictPort: true, proxy: {
    '/demo': { target: 'http://127.0.0.1:4310' },
    '^/collab$': { target: 'ws://127.0.0.1:4310', ws: true },
  } },
});
