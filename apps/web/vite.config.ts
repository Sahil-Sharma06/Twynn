import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // The only chunk above Vite's 500 kB default is Three.js, loaded on demand by the landing
    // hero and the onboarding first-request moment, never on the initial page load.
    chunkSizeWarningLimit: 1000,
    // Never inline fonts as data: URIs, so production can keep a strict font-src 'self' CSP.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  server: {
    port: 5173,
    // Same-origin in dev, so the session cookie and the CSRF origin check just work.
    proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' },
  },
});
