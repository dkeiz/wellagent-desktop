const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'mobile-companion-websocket-fallback-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const clientSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'api', 'client.ts'), 'utf8');
    const chatSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'screens', 'ChatScreen.tsx'), 'utf8');

    assert.includes(clientSource, 'let disconnectedNotified = false;', 'Expected native websocket client to dedupe disconnect notifications');
    assert.includes(clientSource, 'const notifyDisconnected = () => {', 'Expected native websocket client to centralize disconnect notification');
    assert.includes(clientSource, 'if (this.ws) {', 'Expected native websocket reconnect path to replace stale sockets');
    assert.includes(chatSource, "const [wsConnected, setWsConnected] = useState(false);", 'Expected native chat screen to track websocket connectivity');
    assert.includes(chatSource, 'const refreshConversationFallback = useCallback(async () => {', 'Expected native chat screen to define a polling fallback');
    assert.includes(chatSource, 'if (pollInFlightRef.current) return;', 'Expected native chat polling fallback to avoid overlapping refreshes');
    assert.includes(chatSource, 'const fallbackTimer = setInterval(() => {', 'Expected native chat to poll when live websocket updates are unavailable');
    assert.includes(chatSource, "if (previous !== next) console.log('[WS]', next ? 'Connected' : 'Disconnected');", 'Expected native chat logging to emit only state transitions');
  }
};
