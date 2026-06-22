const { createApp } = require('./app');
const { loadConfig } = require('./config');

if (require.main === module) {
  const config = loadConfig();
  if (!config.sessionSecret) {
    console.error('WWW_SESSION_SECRET is required before starting the www gate.');
    process.exit(1);
  }
  const server = createApp(config);
  server.listen(config.port, config.host, () => {
    console.log(`[www-gate] listening on ${config.host}:${config.port}`);
  });
}

module.exports = { createApp, loadConfig };
