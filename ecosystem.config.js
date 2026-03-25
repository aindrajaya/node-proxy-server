module.exports = {
  apps: [{
    name: 'tmat-auth-proxy',
    script: './dist/index.js',
    instances: 'max',          // 1 worker per CPU core
    exec_mode: 'cluster',
    watch: false,
    env_production: {
      NODE_ENV: 'production',
    },
  }],
};
