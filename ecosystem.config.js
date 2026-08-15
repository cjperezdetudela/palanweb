module.exports = {
  apps: [
    {
      name: 'palanweb',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        WEB_AUTH_REQUIRED: true,
        WEB_USERNAME: 'admin',
        WEB_PASSWORD: 'palanweb'
      }
    }
  ]
};
