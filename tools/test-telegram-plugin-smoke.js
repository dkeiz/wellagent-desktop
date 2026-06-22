'use strict';

const mtproto = require('../agentin/plugins/telegram-relay/lib/mtproto-runtime');

function env(name, fallback = '') {
  return String(process.env[name] || fallback || '').trim();
}

async function main() {
  const config = {
    mtprotoEnabled: true,
    mtprotoMode: env('LA_TG_MODE', 'user'),
    apiId: env('LA_TG_API_ID'),
    apiHash: env('LA_TG_API_HASH'),
    sessionString: env('LA_TG_SESSION'),
    defaultPeer: env('LA_TG_PEER'),
    proxyType: env('LA_TG_PROXY_TYPE', 'none'),
    proxyHost: env('LA_TG_PROXY_HOST'),
    proxyPort: env('LA_TG_PROXY_PORT'),
    proxyUsername: env('LA_TG_PROXY_USER'),
    proxyPassword: env('LA_TG_PROXY_PASS'),
    proxySecret: env('LA_TG_PROXY_SECRET'),
    proxyTimeoutSec: env('LA_TG_PROXY_TIMEOUT', '5')
  };

  if (!config.apiId || !config.apiHash || !config.sessionString) {
    throw new Error('Set LA_TG_API_ID, LA_TG_API_HASH, and LA_TG_SESSION first');
  }

  const status = await mtproto.testSession(config);
  console.log('[Telegram Smoke] Connected:', status.connected);
  console.log('[Telegram Smoke] Identity:', status.identity || '(unknown)');
  console.log('[Telegram Smoke] Proxy:', JSON.stringify(status.proxy));

  const message = env('LA_TG_MESSAGE');
  if (message) {
    const sent = await mtproto.sendDirectMessage(config, {
      peer: env('LA_TG_PEER'),
      message
    });
    console.log('[Telegram Smoke] Message sent:', JSON.stringify(sent));
  }

  await mtproto.invalidateRuntime();
}

main().catch(async (error) => {
  console.error('[Telegram Smoke] FAILED:', error.message);
  try {
    await mtproto.invalidateRuntime();
  } catch (_) {}
  process.exitCode = 1;
});
