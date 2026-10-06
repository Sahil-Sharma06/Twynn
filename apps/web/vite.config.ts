import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // Never inline fonts as data: URIs, so production can keep a strict font-src 'self' CSP.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  server: {
    port: 5173,
    // Same-origin in dev, so the session cookie and the CSRF origin check just work.
    proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' },
  },
});
