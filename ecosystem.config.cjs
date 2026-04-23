module.exports = {
  apps: [{
    name: 'bayes',
    // `npm start` runs `vite build` then `node server/index.js`, so every
    // pm2 start/restart rebuilds from current source — no manual build step.
    script: 'npm',
    args: 'start',
    cwd: '/home/mike/src/bayes',
    env: { NODE_ENV: 'production', BAYES_PORT: '3001' },
    autorestart: true,
    max_restarts: 10,
    // Rebuild + restart when source changes. `watch` is relative to cwd.
    watch: ['web', 'server', 'lib', 'examples', 'index.html', 'vite.config.js', 'package.json'],
    ignore_watch: ['node_modules', 'dist', '.git', '.pm2', '*.log'],
    watch_delay: 500
  }]
};
