# npm Publishing

This repository has two release surfaces:

- GitHub Releases: full Electron desktop builds and source releases.
- npm: compact CLI/bootstrap package named `wellbot`.

The root package is private on purpose. Publishing the root would include the
desktop app source, runtime directories, tests, and local development files. To
publish npm, publish only `packages/wellbot`. The root `.npmignore` is a second
guardrail against accidental root tarballs.

## Check Package Contents

```bash
npm run pack:wellbot
```

The package should contain only:

- `package.json`
- `bin/wellbot.js`
- `README.md`
- `LICENSE`

The CLI may bootstrap the full app from GitHub with:

```bash
npx wellbot expand --install
npx wellbot desktop
```

Do not move the Electron app itself into the npm tarball.

## Publish

```bash
cd packages/wellbot
npm publish --access public
```

Do not publish root `localagent-desktop`.

## Future Packages

Add more packages only after their boundaries are clean:

- `@wellbot/plugin-sdk`
- `@wellbot/agent-pack-default`
- `@wellbot/core`

Runtime data must never be published: A2A task history, events, memory,
workspaces, run folders, `.env`, IDE files, bytecode caches, and local state.
