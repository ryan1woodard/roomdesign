import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the app runs under Vite's own server (port 5173) while the sync/
// logging server (server/index.js) runs separately on port 8787 — proxy both
// so `npm run dev` behaves the same as the production single-process setup
// where Express serves the built app directly.
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': API_TARGET,
      '/ws': { target: API_TARGET, ws: true },
    },
  },
});
