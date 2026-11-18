import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', strictPort: true, port: 5173 }
});
