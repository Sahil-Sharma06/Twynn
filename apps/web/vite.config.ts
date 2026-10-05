import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in dev, so the session cookie and the CSRF origin check just work.
    proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' },
  },
});
