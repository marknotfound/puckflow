# PuckFlow

PuckFlow is a team-first hockey management application. This repository is a
pnpm and Turborepo monorepo for its API, web, mobile, worker, cron, and shared
packages.

## Prerequisites

- Node.js 24.18.0
- Corepack 0.35.0 with pnpm 11.13.0
- Docker with Compose

## Local setup

```sh
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:up
```

Stop the local database with `pnpm db:down`.

The approved product scope and architecture are documented in
[`docs/puckflow-mvp-plan.md`](docs/puckflow-mvp-plan.md).
