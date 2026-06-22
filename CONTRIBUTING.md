# Contributing to LocalAgent Desktop

Thank you for your interest in contributing! This document will help you get started.

## 🚀 Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/wellagent-desktop.git`
3. Install dependencies: `npm install`
4. Start the app: `npm start`
5. Run tests: `npm run test:contracts`

## 📋 Development Guidelines

### Read First
- **[DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)** — Full architecture reference, runtime model, and extension paths
- **[docs/development/mcp-tools-guide.md](docs/development/mcp-tools-guide.md)** — Tool inventory and registration policy
- **[docs/development/repository-map.md](docs/development/repository-map.md)** — Repo surfaces and package boundaries

### Code Style
- **Vanilla JavaScript** — No TypeScript, no bundlers, no frameworks
- **Script-loaded renderer** — Components are loaded via `<script>` tags in order
- **File-first architecture** — Important runtime state lives on disk under `agentin/`
- **Line budget** — Keep files under 1000 lines (enforced by `line-budget-contract.test.js`)

### Before Making Changes

Ask these five questions (from the Development Guide):

1. What part of the system should own this behavior?
2. What storage is the source of truth here?
3. What application behavior should remain stable?
4. What user workflow or expectation should still feel familiar after the change?
5. What test or contract should prove the change is safe?

### Extension Points

| What you're adding | Where to put it |
|---------------------|-----------------|
| New backend service | Register in `src/main/bootstrap.js` and `src/main/service-container.js` |
| New IPC endpoint | Add to `src/main/ipc/register-*.js` |
| New MCP tool | Add to `src/main/mcp/register-*.js` |
| New provider adapter | Add to `src/main/providers/` |
| New plugin | Create under `agentin/plugins/<id>/` |
| New connector | Create under `agentin/connectors/` |
| New test | Add to `tests/contracts/` |

### Testing

```bash
# Fast contract tests (always run these)
npm run test:contracts

# Quick tests (contracts + command checks)
npm run test:quick

# Core tests (deeper integration)
npm run test:core

# Verify (same as core — CI target)
npm run verify
```

## 🔒 Privacy & Security Rules

### Never Commit
- API keys, tokens, or credentials
- Personal user data from `agentin/userabout/`
- Memory files from `agentin/memory/daily/`
- Database files (`*.db`)
- Session workspace content

### Check Before Committing
```bash
# Review what would be committed
git diff --cached

# Check for accidentally staged sensitive files
git status
```

### API Keys in Code
- API keys are stored in the SQLite database, encrypted via Electron `safeStorage`
- Provider adapters read keys from DB at runtime, never from source files
- The `.env.example` file shows what can be configured — never commit `.env`

## 📝 Pull Request Process

1. **Create a feature branch** from `main`
2. **Make focused changes** — one feature or fix per PR
3. **Run tests** — at minimum `npm run test:contracts`
4. **Update documentation** if you changed architecture or contracts
5. **Describe your changes** clearly in the PR description
6. **Reference issues** if applicable

### PR Title Format
```
feat: Add new tool for X
fix: Resolve crash when Y
refactor: Split Z into domain modules
docs: Update quick start guide
test: Add contract for W
```

## 🐛 Bug Reports

Use GitHub Issues with:
1. **What happened** — Clear description
2. **What you expected** — Expected behavior
3. **Steps to reproduce** — Minimal reproduction steps
4. **Environment** — OS, Node version, LLM provider/model
5. **Logs** — Console output or error messages

## 💡 Feature Requests

Use GitHub Issues with the `feature` label:
1. **Problem statement** — What you're trying to accomplish
2. **Proposed solution** — How you think it could work
3. **Alternatives considered** — Other approaches you thought about

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

