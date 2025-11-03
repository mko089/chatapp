import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const buildDate =
    env.VITE_BUILD_DATE && env.VITE_BUILD_DATE.length > 0
      ? env.VITE_BUILD_DATE
      : new Date().toISOString();
  process.env.VITE_BUILD_DATE = buildDate;

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_BUILD_DATE': JSON.stringify(buildDate),
    },
    build: {
      // Allow overriding outDir when local dist permissions are locked down
      outDir: env.VITE_OUTDIR && env.VITE_OUTDIR.length > 0 ? env.VITE_OUTDIR : 'dist',
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      // Allow LAN/VPN hostnames during dev
      allowedHosts: ['all', 'chat.garden'],
      // Proxy same-origin API calls in dev so frontend can use VITE_CHATAPI_URL=/api
      proxy: {
        '/api': {
          target: 'http://chat-backend:4025',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    preview: {
      port: 4173,
      host: '0.0.0.0',
      // Allow reverse proxy hostnames in prod (e.g., chat.garden)
      allowedHosts: ['all', 'chat.garden'],
    },
    test: {
      environment: 'jsdom',
      setupFiles: './vitest.setup.ts',
      globals: true,
      cache: false,
      coverage: {
        reporter: ['text', 'html'],
      },
    },
  };
});
