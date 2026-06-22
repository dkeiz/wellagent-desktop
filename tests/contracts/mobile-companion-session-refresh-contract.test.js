const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'mobile-companion-session-refresh-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const clientSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'api', 'client.ts'), 'utf8');
    const settingsSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
    const lockSource = fs.readFileSync(path.join(rootDir, 'mobile', 'src', 'screens', 'LockScreen.tsx'), 'utf8');
    const mobilePackageSource = fs.readFileSync(path.join(rootDir, 'mobile', 'package.json'), 'utf8');
    const installSource = fs.readFileSync(path.join(rootDir, 'tools', 'install-android-apk.ps1'), 'utf8');

    assert.includes(clientSource, "private sessionToken: string = ''", 'Expected companion client to retain durable session token state');
    assert.includes(clientSource, "private sessionDeviceId: string = ''", 'Expected companion client to retain durable device id state');
    assert.includes(clientSource, 'private authRefreshPromise: Promise<boolean> | null = null;', 'Expected companion client to dedupe concurrent auth refreshes');
    assert.includes(clientSource, 'resetAuth() {', 'Expected companion client to expose runtime auth reset');
    assert.includes(clientSource, 'private async reauthenticate(): Promise<boolean>', 'Expected companion client to support automatic re-authentication');
    assert.includes(clientSource, 'await this.authenticateSession({ sessionToken, deviceId });', 'Expected automatic re-authentication to reuse stored durable credentials');
    assert.includes(clientSource, "includeAccessToken: false, allowAuthRefresh: false", 'Expected public pair/auth calls to bypass stale bearer-token retry logic');
    assert.includes(clientSource, 'if (!result.success || !result.wsTicket) {', 'Expected websocket reconnect to handle ws-ticket refresh failures explicitly');
    assert.includes(clientSource, 'if (this.shouldReconnect) this._scheduleReconnect();', 'Expected websocket reconnect to keep retrying after transient failures');
    assert.includes(settingsSource, 'client.resetAuth();', 'Expected unpair flow to clear in-memory durable auth state');
    assert.includes(lockSource, 'client.resetAuth();', 'Expected expired-session lock flow to clear in-memory auth state');
    assert.includes(lockSource, 'getClient().resetAuth();', 'Expected manual reset flow to clear in-memory auth state');
    assert.includes(mobilePackageSource, '"install:debug": "powershell -ExecutionPolicy Bypass -File ..\\\\tools\\\\install-android-apk.ps1 -Variant debug -GrantPermissions"', 'Expected mobile package to expose replace-install debug script');
    assert.includes(mobilePackageSource, '"install:release": "powershell -ExecutionPolicy Bypass -File ..\\\\tools\\\\install-android-apk.ps1 -Variant release -GrantPermissions"', 'Expected mobile package to expose replace-install release script');
    assert.includes(installSource, "$arguments = @('install', '-r')", 'Expected APK install helper to use adb replace-install mode');
    assert.includes(installSource, "E:\\AndroidDev\\SDK\\platform-tools\\adb.exe", 'Expected APK install helper to probe the known E: SDK location');
  }
};
