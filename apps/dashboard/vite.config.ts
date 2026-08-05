import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '');

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': { target: env.VITE_DEV_API_TARGET || 'http://localhost:3000', ws: true },
        '/tile': { target: env.VITE_DEV_TILE_TARGET || 'http://localhost:3001' },
      },
    },
  };
});
