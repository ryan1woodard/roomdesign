import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the app is served by Vite while the API lives in the
// separate Node process (`npm run server`). Proxying /api keeps the client
// code identical to production, where one process serves both.
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': API_TARGET },
  },
});
