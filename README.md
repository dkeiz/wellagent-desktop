# LocalAgent Desktop

Local-first AI workspace with desktop UI, superagent orchestration, plugins, workflows, and browser or Android companion access.

`0.1.0-beta.1` is beta.

## Core Features

- Superagent runtime with subagents, tool routing, workflows, and task orchestration.
- Plugin system for companion features, TTS, RAG, Telegram, research, and custom extensions.
- Companion access from desktop browser UI, LAN web sessions, and Android app handoff.
- Multiple run modes: full Electron desktop, no-window runtime, and headless Docker service.

## Quick Start

Requirements: Node.js 18+, npm, and one model backend such as Ollama, LM Studio, or an OpenAI-compatible endpoint.

```bash
git clone https://github.com/dkeiz/wellagent-desktop.git
cd wellagent-desktop
npm install
npm start
```

Useful commands:

- `npm start` for the desktop app.
- `npm run start:cli` for no-window mode.
- `npm run start:companion-qr` for companion pairing.
- `docker compose up -d` for headless container mode on `:8788`.

## Distribution

- Windows portable build: GitHub Releases.
- Android APK: `releases/android/` in this repo and optional GitHub Release asset.
- npm CLI: `wellbot` in `packages/wellbot`.
- Source, docs, plugins, and companion code: this repository.

## Repository Layout

- `src/` desktop app and backend runtime.
- `mobile/` Android companion source.
- `packages/` publishable subpackages.
- `agentin/` bundled agent, plugin, workflow, and prompt content.
- `docs/` setup, companion, and development documentation.

## Docs

- [Quick Start](QUICK_START.md)
- [Companion Guide](COMPANION.md)
- [Android Companion](docs/companion/android-companion.md)
- [Documentation Index](docs/README.md)

## License

MIT. See [LICENSE](LICENSE).
