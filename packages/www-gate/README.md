# LocalAgent WWW Gate

Public information portal, registry, admin panel, and registered-user shell for
LocalAgent / wellbot.

This package is separate from the desktop companion and remote gateway. It is
intended for a public VPS/domain. The existing companion gateway remains the
local/relay path for desktop and mobile access.

## Run Locally

From this repository checkout, use the root script. It runs through Electron so
the existing desktop-built `better-sqlite3` native module can be reused without
rebuilding `node_modules`.

```bash
set WWW_SESSION_SECRET=replace-with-long-random-secret
set WWW_ADMIN_SECRET=replace-with-another-long-random-secret
npm run start:www-gate
```

In a standalone VPS or Docker install, use the package entrypoint:

```bash
node src/index.js
```

Defaults:

- Host: `0.0.0.0`
- Port: `8080`
- SQLite DB: `packages/www-gate/data/www-gate.sqlite`

Open:

```text
http://localhost:8080/
http://localhost:8080/admin
```

## Environment

- `WWW_GATE_HOST`: bind host, default `0.0.0.0`
- `WWW_GATE_PORT`: bind port, default `8080`
- `WWW_GATE_DB`: SQLite path, default package-local data directory
- `WWW_PUBLIC_BASE_URL`: public URL used by deployment notes
- `WWW_ADMIN_SECRET`: required for admin routes
- `WWW_SESSION_SECRET`: required before server startup

## What V1 Includes

- Public project description and status pages
- Download/GitHub/npm links
- Registry pages for skills, plugins, users, and projects
- Public signup with `pending` user status
- Login for admin-approved active users
- Registered `/account` and `/webgate` pages
- Admin CRUD for content blocks, links, registry entries, and users
- SQLite schema and seed data
- Docker deployment path for VPS hosting

The registered webgate page is intentionally a placeholder in V1. It proves the
auth boundary and gives a URL for future chosen-user features, but it does not
connect to desktop companion servers or mobile apps yet.

## Docker

Build from this package directory:

```bash
docker build -t localagent-www-gate .
docker run --rm -p 8080:8080 ^
  -v localagent-www-data:/data ^
  -e WWW_SESSION_SECRET=replace-with-long-random-secret ^
  -e WWW_ADMIN_SECRET=replace-with-another-long-random-secret ^
  localagent-www-gate
```

For public use, run behind Caddy, nginx, or another TLS reverse proxy.

## Data

SQLite data should be backed up from the configured `WWW_GATE_DB` path. The
package-local `data/` directory is ignored by git.

## Verification

```bash
npm run test:www-gate
node tests/run-suite.js contracts
```
