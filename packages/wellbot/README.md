# wellbot

[![npm version](https://img.shields.io/npm/v/wellbot.svg)](https://www.npmjs.com/package/wellbot)

Small npm CLI for the Wellbot/LocalAgent Desktop public release.

The npm package is intentionally compact. It does not ship the Electron desktop
application, local runtime state, tests, or development files. Full desktop
builds are distributed from GitHub Releases. If you want source mode, the CLI
can expand itself into the full desktop source from GitHub.

Current public release: `0.2.0`.

```bash
npx wellbot doctor
npx wellbot releases
npx wellbot expand --install
npx wellbot desktop
```

Commands:

- `wellbot expand [dir]` clones the full desktop source.
- `wellbot install [dir]` runs `npm install` in the desktop source.
- `wellbot update [dir]` runs `git pull --ff-only`.
- `wellbot desktop [dir]` runs the desktop app from source.

Desktop releases:
https://github.com/dkeiz/wellagent-desktop/releases/latest

Source:
https://github.com/dkeiz/wellagent-desktop


