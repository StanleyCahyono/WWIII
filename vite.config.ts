/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Loopback-only by default. No remote assets: everything is bundled.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@engine': r('./src/engine'), '@data': r('./src/data'), '@ai': r('./src/ai'), '@ui': r('./src/ui') },
  },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 8000 },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 120000,
    pool: 'threads',
  },
});
