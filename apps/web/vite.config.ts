import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.ULYSSE_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['ulysse-source'] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/v1': api, '/auth': api, '/health': api },
  },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
});
