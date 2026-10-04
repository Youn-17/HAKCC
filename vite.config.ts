import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => {
    return {
      server: {
        port: Number(process.env.PORT) || 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            // 本地没起后端时，DEV_API_PROXY=https://api.ideaweave.tech 配合 VITE_API_URL=/api
            // 就能用线上接口调前端，绕开浏览器对 localhost 的 CORS 限制。
            target: process.env.DEV_API_PROXY ?? 'http://localhost:4000',
            changeOrigin: true,
          },
        },
      },
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
        dedupe: ['react', 'react-dom'],
      },
      optimizeDeps: {
        include: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
      },
      build: {
        target: 'es2020',
        minify: 'esbuild' as const,
        cssMinify: true,
        sourcemap: false,
        rollupOptions: {
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom', 'react-router-dom'],
              'vendor-supabase': ['@supabase/supabase-js'],
              'vendor-icons': ['lucide-react'],
            },
            // Content-hashed filenames for long-term caching. The /v2/ path
            // segment retires every pre-2026-07 asset URL: a CDN edge had
            // cached the SPA-fallback HTML under old /assets/js/* URLs with
            // an immutable header, white-screening affected clients.
            chunkFileNames: 'assets/js/v2/[name]-[hash].js',
            entryFileNames: 'assets/js/v2/[name]-[hash].js',
            assetFileNames: 'assets/[ext]/v2/[name]-[hash].[ext]',
          },
        },
        // Warn on large chunks
        chunkSizeWarningLimit: 300,
      },
    };
});
