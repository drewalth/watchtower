import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/static/', // Must match Django's settings.STATIC_URL.
  resolve: {
    // `@/...` -> ./assets/... (mirrors tsconfig paths so shadcn/mapcn imports resolve).
    alias: { '@': path.resolve(__dirname, './assets') },
  },
  server: {
    // Dev server runs on the host; Django (in Docker) loads modules from here,
    // so it must be reachable cross-origin from the browser at :8000.
    host: 'localhost',
    port: 5173,
    origin: 'http://localhost:5173',
    cors: true,
  },
  build: {
    // Vite writes the built bundle + manifest into Django's static dir.
    outDir: path.resolve(__dirname, './static'),
    emptyOutDir: false, // Don't clobber other collected static files.
    manifest: true, // -> static/.vite/manifest.json (read by django-vite).
    rollupOptions: {
      // Single React entry; django-vite references it as 'assets/main.tsx'.
      input: { main: path.resolve(__dirname, './assets/main.tsx') },
    },
  },
  test: {
    // Store logic is pure data + fetch orchestration — no DOM needed.
    environment: 'node',
    include: ['assets/**/*.test.{ts,tsx}'],
  },
});
