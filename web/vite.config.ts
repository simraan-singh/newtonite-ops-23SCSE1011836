import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser calls /api/...; Vite forwards it to the Express server on port 3000.
// Same origin for the browser, so no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
});
