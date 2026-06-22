# Global WWW Gate

The global WWW Gate is a separate public web package for LocalAgent / wellbot.
It is not the desktop companion server and does not replace the existing local
or remote companion gateway.

## Purpose

V1 is an information portal first:

- Explain the project and current beta status.
- Publish download, GitHub, npm, and documentation links.
- Show curated registries for skills, plugins, users, and related projects.
- Allow public signup while keeping accounts pending until admin approval.
- Provide a registered-user `/webgate` shell for future chosen-user workflows.

## Package

The package lives in:

```text
packages/www-gate
```

It uses:

- `node:http` for the server
- `better-sqlite3` for storage
- signed HTTP-only cookies for user/admin sessions
- CSRF tokens for admin write actions

The existing companion code under `src/main/companion/` remains separate.

## Routes

Public:

- `GET /`
- `GET /downloads`
- `GET /registry`
- `GET /registry/:type`
- `GET /registry/:type/:slug`
- `GET /github`
- `GET /signup`
- `POST /signup`
- `GET /login`
- `POST /login`
- `POST /logout`

Registered:

- `GET /account`
- `GET /webgate`

Admin:

- `GET /admin`
- content CRUD under `/admin/content`
- link/download CRUD under `/admin/links`
- registry CRUD under `/admin/registry`
- user CRUD and approval under `/admin/users`

## Environment

- `WWW_GATE_HOST`, default `0.0.0.0`
- `WWW_GATE_PORT`, default `8080`
- `WWW_GATE_DB`, default `packages/www-gate/data/www-gate.sqlite`
- `WWW_PUBLIC_BASE_URL`
- `WWW_ADMIN_SECRET`
- `WWW_SESSION_SECRET`

`WWW_SESSION_SECRET` is required at startup. `WWW_ADMIN_SECRET` is required for
admin routes.

## Deployment

The intended deployment is a VPS running Node or Docker behind a TLS reverse
proxy. The Docker image stores SQLite in `/data`, so production should mount a
persistent volume there.

From the repo checkout, use `npm run start:www-gate` for local development. In
Docker or a standalone server install, the package entrypoint is `node
src/index.js`.

The webgate placeholder should stay informational until a later design connects
registered users to desktop/mobile workflows. Do not route public traffic into
the local companion gateway by accident.
