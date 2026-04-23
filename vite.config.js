export default {
  root: '.',
  // Relative base so the built bundle works under any URL prefix
  // (e.g. served at `/` or `/bayes/` without rebuilding).
  base: './',
  server: {
    port: 5173,
    host: true,
    open: false,
    // Forward AI calls to the companion API process (server/index.js).
    // If that process isn't running the proxy fails — handled gracefully
    // by the frontend via /api/status probing.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Don't let the parent Vite logger flood stdout if the API is down.
        configure(proxy) { proxy.on('error', () => {}); }
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
};
