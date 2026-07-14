# PuckFlow Milestone 0 Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and operate the Milestone 0 walking skeleton: a protected merge deploys healthy Railway services and a Clerk-authenticated web or mobile session completes `GET /v1/me` against production.

**Architecture:** A pnpm/Turborepo monorepo contains independently deployable Express, Next.js, Expo, worker, and cron applications plus focused shared packages. Express is the only data boundary; it verifies Clerk sessions, just-in-time provisions an internal UUIDv7 user, and persists to Postgres through Drizzle. Postgres also owns append-only audit records, transactional outbox events, and at-least-once jobs; Railway provides the single production environment, while Docker Compose provides the local database.

**Tech Stack:** Node.js 24.18.0 LTS, Corepack 0.35.0, pnpm 11.13.0, Turborepo 2.10.5, TypeScript 6.0.3, Express 5.2.1, Next.js 16.2.10, Expo SDK 57.0.4, React 19.2.3, React Native 0.86.0, Zod 4.4.3, Drizzle ORM 0.45.2 / drizzle-kit 0.31.10, PostgreSQL 17.10, Clerk (`@clerk/express` 2.1.40, `@clerk/nextjs` 7.5.17, `@clerk/expo` 3.7.4), Pino 10.3.1, Sentry 10.65.0 server/web and 7.11.0 mobile, Vitest 4.1.10, Jest 30.4.2, Testcontainers 12.0.4, GitHub Actions, Railway Railpack.

## Global Constraints

- Scope is only Milestone 0. Do not add teams, memberships, players, invitations, seasons, games, RSVP, goals, media upload, notification providers, or public product pages.
- Use package names exactly: `@puckflow/api`, `@puckflow/web`, `@puckflow/mobile`, `@puckflow/worker`, `@puckflow/cron`, `@puckflow/core`, `@puckflow/db`, `@puckflow/api-client`, and `@puckflow/ui-tokens`.
- API routes live under `apps/api/src/routes`; domain contracts live under `packages/core/src`; Drizzle code lives under `packages/db/src`.
- Use REST/JSON under `/v1`; every non-2xx API response is RFC 9457 `application/problem+json` and contains `type`, `title`, `status`, safe `detail`, stable `code`, `requestId`, and `instance`.
- Generate application-owned identifiers with UUIDv7; store timestamps as UTC `timestamptz` values.
- Clerk owns sign-up, sign-in, sessions, and account security. Every non-public API route verifies Clerk JWTs. PuckFlow foreign keys use internal user IDs, never Clerk IDs.
- Clerk webhooks are signature-verified against the unparsed request body and deduplicated by provider event ID. JIT provisioning makes webhook delay harmless.
- Keep secrets out of git, logs, problem responses, client bundles, and Railway templates. Only publish `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` variables explicitly listed here.
- Use single-line structured JSON logs. Accept a valid inbound `x-request-id` only when it matches `/^[A-Za-z0-9._-]{1,128}$/`; otherwise generate UUIDv7. Echo it in `x-request-id`, logs, Sentry, Problem Details, audit, and outbox context.
- Audit entries are append-only to the runtime database role and contain only allowlisted before/after fields; never store raw Clerk payloads, email bodies, tokens, secrets, or unrestricted row snapshots.
- Outbox writes share the same transaction as their domain mutation. Jobs are uniquely keyed, claimed with `FOR UPDATE SKIP LOCKED`, retried with bounded backoff, and dead-lettered after the configured maximum.
- Local development uses Docker Compose Postgres. Production has exactly one Railway environment connected to protected `main`; no staging or PR Railway environments.
- Exactly the API service owns `pnpm --filter @puckflow/db migrate` as its Railway pre-deploy command. Web, worker, and cron never run migrations.
- Only web and API receive public domains. API, worker, cron, and Postgres communicate over Railway private networking.
- CI must run formatting, linting, type checking, unit tests, Postgres integration/migration tests, API/web/worker/cron production builds, Railway configuration validation, Expo configuration/tests when mobile files change, dependency review, and source/lockfile security scanning. Railway, not repository Dockerfiles, builds the deployable application images with Railpack.
- Enable scheduled backups and Postgres PITR before real data. A PITR restore creates a sibling Postgres service and requires a documented manual connection-string cutover.
- Pin package and runtime versions exactly, without `^`, `~`, `latest`, or floating Docker tags. The versions above were checked on 2026-07-13; regenerate the lockfile only through an intentional dependency-change commit. Expo-native packages must also satisfy `expo install --check` for SDK 57.
- Use expand-and-contract migrations compatible with briefly overlapping old and new revisions. Do not add a destructive migration in Milestone 0.

### Dependency version ledger

The owning workspace manifest must use these exact versions whenever it consumes the package: `corepack@0.35.0`, `@eslint/js@10.0.1`, `eslint@10.7.0`, `eslint-config-prettier@10.1.8`, `prettier@3.9.5`, `typescript-eslint@8.64.0`, `typescript@6.0.3`, `turbo@2.10.5`, `zod@4.4.3`, `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `postgres@3.4.9`, `uuid@14.0.1`, `express@5.2.1`, `helmet@8.3.0`, `cors@2.8.6`, `express-rate-limit@8.5.2`, `pino@10.3.1`, `pino-http@11.0.0`, `@clerk/express@2.1.40`, `@clerk/backend@3.11.4`, `@clerk/nextjs@7.5.17`, `@clerk/expo@3.7.4`, `@sentry/node@10.65.0`, `@sentry/nextjs@10.65.0`, `@sentry/react-native@7.11.0`, `next@16.2.10`, `expo@57.0.4`, `expo-router@57.0.4`, `expo-secure-store@57.0.0`, `expo-status-bar@57.0.1`, `expo-system-ui@57.0.0`, `expo-linking@57.0.2`, `react@19.2.3`, `react-dom@19.2.3`, `react-native@0.86.0`, `vitest@4.1.10`, `@vitest/coverage-v8@4.1.10`, `testcontainers@12.0.4`, `supertest@7.2.2`, `tsup@8.5.1`, `jsdom@29.1.1`, `@testing-library/react@16.3.2`, `@testing-library/jest-dom@6.9.1`, `jest@30.4.2`, `jest-expo@57.0.1`, `@testing-library/react-native@14.0.1`, and `yaml@2.9.0`.

Compatibility notes verified on 2026-07-13:

- `typescript-eslint@8.64.0` supports TypeScript `>=4.8.4 <6.1.0`, so TypeScript 6.0.3 is the newest compatible stable 6.0 patch; TypeScript 7 is intentionally not used.
- Expo SDK 57 maps to React Native 0.86 and React 19.2.3. `jest-expo@57.0.1` and Expo's SDK ledger are the authority for mobile test/native package versions; deprecated `react-test-renderer` is not installed.
- The Expo SDK 57 native ledger selects `@sentry/react-native@7.11.0`; the independently latest 8.x release is not used.
- `@clerk/nextjs@7.5.17` supports Next.js 16 and React 19.2.x; `@clerk/expo@3.7.4` supports Expo 53 through 57 and React Native 0.75 or newer.
- pnpm 11 supports Node 24. Before enabling Corepack locally, install the exact current Corepack release to avoid stale-signature failures.

---

## Exact File Map

### Repository and shared configuration

- Create `.node-version` — pins Node `24.18.0`.
- Create `.npmrc` — enforces pnpm and exact dependency saving.
- Create `.editorconfig`, `.prettierignore`, `prettier.config.mjs`, `eslint.config.mjs`, `tsconfig.base.json` — one formatting/lint/type baseline.
- Create `.gitignore` — excludes dependencies, builds, local env files, Expo state, coverage, and Sentry artifacts.
- Create `.env.example` — documents local server-only values and separate public client values with safe example strings.
- Create `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json` — root workspace, pinned package manager, task graph, and lockfile.
- Create `tooling/tests/workspace.test.mjs` — dependency-free repository contract test.
- Create `docker-compose.yml` and `tooling/postgres/init/001-roles.sql` — pinned local Postgres and least-privilege runtime role.

### Shared packages

- Create `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`.
- Create `packages/core/src/ids.ts`, `packages/core/src/http/problem.ts`, `packages/core/src/http/problem.test.ts` — shared UUID schema, RFC 9457 schema, and stable error codes.
- Create `packages/core/src/identity/me.ts`, `packages/core/src/identity/me.test.ts` — `Me` projection contract.
- Create `packages/api-client/package.json`, `packages/api-client/tsconfig.json`, `packages/api-client/src/index.ts`, `packages/api-client/src/transport.ts`, `packages/api-client/src/client.ts`, `packages/api-client/src/client.test.ts` — token-aware typed fetch transport and composed client.
- Create `packages/ui-tokens/package.json`, `packages/ui-tokens/tsconfig.json`, `packages/ui-tokens/src/index.ts` — semantic light/dark colors and spacing shared as data, not UI.

### Database package

- Create `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`.
- Create `packages/db/src/client.ts`, `packages/db/src/index.ts`, `packages/db/src/ids.ts` — pooled Drizzle connection and UUIDv7 generation.
- Create `packages/db/src/schema/users.ts`, `packages/db/src/schema/operations.ts`, `packages/db/src/schema/index.ts` — M0 tables and enums.
- Create `packages/db/src/repositories/users.ts`, `packages/db/src/repositories/users.integration.test.ts` — Clerk lookup/upsert/delete.
- Create `packages/db/src/repositories/webhooks.ts` — atomic event receipt/processing state.
- Create `packages/db/src/repositories/audit.ts`, `packages/db/src/repositories/outbox.ts`, `packages/db/src/repositories/jobs.ts`, `packages/db/src/repositories/operations.integration.test.ts` — operational primitives.
- Create `packages/db/src/migrate.ts`, `packages/db/src/testing/database.ts`, `packages/db/src/testing/migrations.integration.test.ts`.
- Create `packages/db/drizzle/0000_m0_foundations.sql`, `packages/db/drizzle/meta/_journal.json`, `packages/db/drizzle/meta/0000_snapshot.json` — checked-in first migration and Drizzle metadata.

### API

- Create `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsup.config.ts`, `apps/api/railway.toml`.
- Create `apps/api/src/config.ts`, `apps/api/src/logger.ts`, `apps/api/src/observability.ts`, `apps/api/src/request-context.ts`.
- Create `apps/api/src/http/problem.ts`, `apps/api/src/http/not-found.ts`, `apps/api/src/http/error-handler.ts`.
- Create `apps/api/src/auth/clerk.ts`, `apps/api/src/auth/require-auth.ts`, `apps/api/src/auth/provision-user.ts`.
- Create `apps/api/src/routes/health.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/routes/clerk-webhooks.ts`.
- Create `apps/api/src/app.ts`, `apps/api/src/server.ts`.
- Create `apps/api/src/app.test.ts`, `apps/api/src/routes/me.integration.test.ts`, `apps/api/src/routes/clerk-webhooks.integration.test.ts`.

### Worker and cron

- Create `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/tsup.config.ts`, `apps/worker/railway.toml`.
- Create `apps/worker/src/config.ts`, `apps/worker/src/handlers.ts`, `apps/worker/src/runner.ts`, `apps/worker/src/server.ts`, `apps/worker/src/runner.integration.test.ts`.
- Create `apps/cron/package.json`, `apps/cron/tsconfig.json`, `apps/cron/tsup.config.ts`, `apps/cron/railway.toml`.
- Create `apps/cron/src/config.ts`, `apps/cron/src/sweep.ts`, `apps/cron/src/main.ts`, `apps/cron/src/sweep.integration.test.ts`.

### Web and mobile

- Create `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/next-env.d.ts`, `apps/web/railway.toml`, `apps/web/proxy.ts`, `apps/web/sentry.server.config.ts`, `apps/web/sentry.edge.config.ts`, `apps/web/instrumentation-client.ts`.
- Create `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/page.tsx`, `apps/web/app/sign-in/[[...sign-in]]/page.tsx`, `apps/web/app/sign-up/[[...sign-up]]/page.tsx`, `apps/web/app/api/health/route.ts`.
- Create `apps/web/src/me-card.tsx`, `apps/web/src/me-card.test.tsx`, `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts`.
- Create `apps/mobile/package.json`, `apps/mobile/tsconfig.json`, `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, `apps/mobile/metro.config.js`, `apps/mobile/index.js`, `apps/mobile/sentry.config.ts`.
- Create `apps/mobile/app/_layout.tsx`, `apps/mobile/app/index.tsx`, `apps/mobile/src/token-cache.ts`, `apps/mobile/src/me-screen.tsx`, `apps/mobile/src/me-screen.test.tsx`, `apps/mobile/jest.config.js`, `apps/mobile/jest.setup.ts`.

### CI and operations

- Create `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.github/labeler.yml` — required checks, updates, and area labels.
- Create `docs/operations/local-development.md`, `docs/operations/railway-production.md`, `docs/operations/deployments.md`, `docs/operations/observability.md`, `docs/operations/backups-and-pitr.md`, `docs/operations/restore-drills/README.md`.
- Create `tooling/operations/verify-railway-config.mjs`, `tooling/operations/verify-railway-config.test.mjs` — checks all four service configs and migration ownership.
- Create `tooling/operations/verify-restore-drill.mjs`, `tooling/operations/verify-restore-drill.test.mjs` — rejects missing/incomplete/failed drill evidence.
- Modify `README.md` — link setup, architecture, and operations docs only after their commands pass.

---

### Task 1: Bootstrap the pinned workspace and local Postgres

**Files:**
- Create all “Repository and shared configuration” files from the map above.
- Create package manifests and `tsconfig.json` files for all nine named workspaces; application entrypoints remain for their owning tasks.
- Modify `README.md`.

**Interfaces:**
- Consumes: none.
- Produces: root scripts `format:check`, `lint`, `typecheck`, `test`, `test:integration`, `build`, `check:mobile`, `db:up`, `db:down`; Turbo tasks of the same names; local `DATABASE_URL=postgresql://puckflow_app:puckflow_local@127.0.0.1:5432/puckflow`; migration `MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/puckflow`.

- [ ] **Step 1: Write the dependency-free workspace contract test**

Create `tooling/tests/workspace.test.mjs` with assertions that `.node-version` equals `24.18.0`, `package.json.packageManager` equals `pnpm@11.13.0`, the workspace patterns are `apps/*` and `packages/*`, all nine package names exist once, root scripts exist, Compose uses `postgres:17.10-alpine3.24`, no application `Dockerfile` exists, every Railway config selects `RAILPACK`, and only `apps/api/railway.toml` contains a pre-deploy migration command.

- [ ] **Step 2: Run the contract and verify the red state**

Run: `node --test tooling/tests/workspace.test.mjs`

Expected: FAIL with `ENOENT` for `.node-version` or `package.json` missing `packageManager`.

- [ ] **Step 3: Add exact root configuration and workspace manifests**

Use this root script contract in `package.json`:

```json
{
  "name": "puckflow",
  "private": true,
  "packageManager": "pnpm@11.13.0",
  "engines": { "node": "24.18.0", "pnpm": "11.13.0" },
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:integration": "turbo run test:integration",
    "build": "turbo run build",
    "check:mobile": "pnpm --filter @puckflow/mobile exec expo config --type public && pnpm --filter @puckflow/mobile test",
    "db:up": "docker compose up -d --wait postgres",
    "db:down": "docker compose down"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "eslint": "10.7.0",
    "eslint-config-prettier": "10.1.8",
    "prettier": "3.9.5",
    "turbo": "2.10.5",
    "typescript": "6.0.3",
    "typescript-eslint": "8.64.0"
  }
}
```

Every workspace manifest must set `"private": true`, its exact package name, `"type": "module"`, and scripts for only the tasks it implements. Use workspace dependencies as `"workspace:*"` and all registry dependencies as exact versions.

Configure `docker-compose.yml` with the verified official image `postgres:17.10-alpine3.24`, database `puckflow`, admin password `postgres`, persistent volume `puckflow-postgres` mounted at `/var/lib/postgresql/data`, port `5432`, `pg_isready -U postgres -d puckflow`, and read-only mount `./tooling/postgres/init:/docker-entrypoint-initdb.d`. In `001-roles.sql`, idempotently create login role `puckflow_app` with password `puckflow_local`, connect permission, and schema usage; migrations grant table/sequence privileges later.

- [ ] **Step 4: Install once and validate the workspace**

Run: `npm install --global corepack@0.35.0 && corepack enable pnpm && corepack pnpm --version`

Expected: exits 0 and prints `11.13.0` from the repository `packageManager` field.

Run: `pnpm install --frozen-lockfile=false && pnpm install --frozen-lockfile`

Expected: both installs exit 0; the second reports the lockfile is up to date and creates no `git diff`.

Run: `node --test tooling/tests/workspace.test.mjs && pnpm db:up`

Expected: contract PASS; Compose reports `postgres` healthy.

- [ ] **Step 5: Commit the workspace skeleton**

```bash
git add .node-version .npmrc .editorconfig .gitignore .prettierignore prettier.config.mjs eslint.config.mjs tsconfig.base.json package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json docker-compose.yml tooling/postgres tooling/tests README.md apps packages
git commit -m "build: bootstrap PuckFlow monorepo"
```

### Task 2: Define the shared identity, error, and token contracts

**Files:**
- Create `packages/core/src/http/problem.ts`, `packages/core/src/http/problem.test.ts`.
- Create `packages/core/src/identity/me.ts`, `packages/core/src/identity/me.test.ts`, `packages/core/src/index.ts`.
- Create `packages/ui-tokens/src/index.ts` and its package configuration.

**Interfaces:**
- Consumes: Zod 4.4.3 and the workspace contract from Task 1.
- Produces: `ProblemCode`, `ProblemDetailsSchema`, `ValidationIssueSchema`, `MeSchema`, `type Me`, and `uiTokens`.

- [ ] **Step 1: Write failing schema tests**

Test these exact examples:

```ts
ProblemDetailsSchema.parse({
  type: 'https://puckflow.app/problems/unauthenticated',
  title: 'Authentication required',
  status: 401,
  detail: 'Sign in to continue.',
  code: 'UNAUTHENTICATED',
  requestId: '019c-request',
  instance: '/v1/me',
})

MeSchema.parse({
  id: '019c4ab8-ef80-7000-8000-000000000001',
  email: 'skater@example.com',
  displayName: 'Avery Skater',
  avatarUrl: null,
})
```

Also assert that an unknown `code`, a non-UUID `id`, an empty display name, and a validation issue without `path` are rejected.

- [ ] **Step 2: Verify tests fail before exports exist**

Run: `pnpm --filter @puckflow/core test`

Expected: FAIL because `ProblemDetailsSchema` and `MeSchema` are not exported.

- [ ] **Step 3: Implement exact shared schemas**

Define `ProblemCodeSchema` as the enum `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `CONFLICT`, `OWNER_REQUIRED`, `PLAYER_LINK_CONFLICT`, `GOAL_DETAIL_EXCEEDS_FINAL_SCORE`, `RATE_LIMITED`, `INTERNAL`; `ValidationIssueSchema` as `{ path: string, message: string, code: string }`; and `ProblemDetailsSchema` with the required fields above plus optional `errors: ValidationIssue[]`. Define `MeSchema` as `{ id: UUID string, email: email string, displayName: trimmed 1..120 string, avatarUrl: URL string or null }` and export inferred types.

Define `uiTokens` with immutable semantic values: background `#F7F8FA`/`#0B1220`, surface `#FFFFFF`/`#111B2E`, text `#0B1220`/`#F7F8FA`, accent `#1769E0`/`#69A7FF`, danger `#B42318`/`#FF8A80`, spacing `4, 8, 12, 16, 24, 32`, and mobile minimum target `44`.

- [ ] **Step 4: Verify package behavior**

Run: `pnpm --filter @puckflow/core test && pnpm --filter @puckflow/core typecheck && pnpm --filter @puckflow/ui-tokens typecheck`

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit shared contracts**

```bash
git add packages/core packages/ui-tokens pnpm-lock.yaml
git commit -m "feat(core): define Milestone 0 contracts"
```

### Task 3: Create the Milestone 0 Postgres schema and migration gate

**Files:**
- Create every file under “Database package” in the exact file map except repository files completed by Tasks 5–7.

**Interfaces:**
- Consumes: `MIGRATION_DATABASE_URL`, `DATABASE_URL`, UUIDv7 from `uuid.v7()`.
- Produces: `createDatabase(url): Database`, `closeDatabase(database): Promise<void>`, `DbTransaction`, `generateId(): string`, Drizzle tables `users`, `webhookEvents`, `auditLogs`, `outboxEvents`, `jobs`, and `migrate` CLI.

- [ ] **Step 1: Write failing empty-database migration tests**

In `migrations.integration.test.ts`, start `postgres:17.10-alpine3.24` with Testcontainers, create login role `puckflow_app` before applying migrations (matching the production bootstrap order), run the checked-in migration, query `information_schema.tables`, and assert exactly the five application tables. Assert all primary keys, unique `users.clerk_id`, unique `outbox_events.id`, unique `jobs.deterministic_key`, and enum/check behavior. Connect as `puckflow_app` and assert `INSERT` on all tables succeeds while `UPDATE audit_logs` and `DELETE FROM audit_logs` fail with permission denied.

- [ ] **Step 2: Verify the test is red**

Run: `pnpm --filter @puckflow/db test:integration -- migrations.integration.test.ts`

Expected: FAIL because `drizzle/0000_m0_foundations.sql` does not exist.

- [ ] **Step 3: Define the exact schema**

Create these columns and constraints in both Drizzle schema and SQL migration:

| Table | Required columns and constraints |
|---|---|
| `users` | `id uuid PK`, `clerk_id text UNIQUE`, `email text`, `display_name varchar(120)`, `clerk_image_url text NULL`, `created_at`, `updated_at`, `deleted_at NULL` |
| `webhook_events` | `provider_event_id text PK`, `event_type text`, `status` enum `processing/processed/failed`, `received_at`, `processed_at NULL`, `sanitized_error NULL` |
| `audit_logs` | `id uuid PK`, `actor_user_id uuid NULL FK users`, `action text`, `entity_type text`, `entity_id uuid`, `team_id uuid NULL`, `request_id varchar(128)`, `changes jsonb`, `created_at`; revoke runtime UPDATE/DELETE |
| `outbox_events` | `id uuid PK`, `event_type text`, `aggregate_type text`, `aggregate_id uuid`, `team_id uuid NULL`, `actor_user_id uuid NULL FK users`, `payload jsonb`, `request_id varchar(128)`, `occurred_at`, `dispatched_at NULL`; index undispatched `(occurred_at,id)` |
| `jobs` | `id uuid PK`, `category text`, `deterministic_key text UNIQUE`, `payload jsonb`, `due_at`, `status` enum `pending/claimed/completed/canceled/dead_letter`, `attempt_count int >= 0`, `max_attempts int > 0`, `next_attempt_at`, `claimed_at NULL`, `claimed_by NULL`, `completed_at NULL`, `dead_lettered_at NULL`, `last_error NULL`, timestamps; claim index `(status,next_attempt_at,due_at)` |

Use `timestamptz NOT NULL DEFAULT now()` and never use a database-generated random UUID. `generateId()` calls `v7()` from `uuid@14.0.1`. The migration creates/grants runtime permissions after table creation and explicitly revokes audit update/delete.

- [ ] **Step 4: Verify migrations and Drizzle metadata**

Run: `pnpm db:up && MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/puckflow pnpm --filter @puckflow/db migrate`

Expected: log includes `applied 0000_m0_foundations`; a second run exits 0 with `0 migrations applied`.

Run: `pnpm --filter @puckflow/db test:integration && pnpm --filter @puckflow/db typecheck`

Expected: migration and privilege tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit the database foundation**

```bash
git add packages/db tooling/postgres/init pnpm-lock.yaml
git commit -m "feat(db): add Milestone 0 operational schema"
```

### Task 4: Build the observable Express health and error skeleton

**Files:**
- Create API config, logging, observability, request context, HTTP helpers, health route, app/server, tests, package/build files, and Railpack configuration from the file map.
- Do not add Clerk route behavior in this task.

**Interfaces:**
- Consumes: `ProblemDetailsSchema`, `generateId()`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `PORT`, `LOG_LEVEL`.
- Produces: `createApp(dependencies): Express`, `ProblemError`, `toProblemDetails(error, request): ProblemDetails`, public `GET /health/live`, `GET /health/ready`, and `GET /v1/health`.

- [ ] **Step 1: Write failing API contract tests**

Using Supertest, assert:

1. `GET /health/live` returns `200 {"status":"ok"}` without auth.
2. `GET /health/ready` invokes `database.execute(sql\`select 1\`)` and returns 200 when healthy, 503 Problem Details with code `INTERNAL` when unhealthy.
3. `GET /missing` returns 404 Problem Details, content type `application/problem+json`, `instance: "/missing"`, and matching body/header request IDs.
4. A valid inbound `x-request-id: ci-smoke-1` is echoed; whitespace, slash, 129 characters, or multiple header values generate a UUIDv7 instead.
5. A thrown error logs once with `requestId`, `method`, `path`, `status`, and no authorization header; Sentry receives the same request ID and release.
6. The protected `/v1` limiter permits 120 requests per minute per trusted client IP, then returns 429 Problem Details with `RATE_LIMITED`; health routes and signed Clerk webhooks use separate limits and cannot consume that budget.

- [ ] **Step 2: Run the focused test and see it fail**

Run: `pnpm --filter @puckflow/api test -- app.test.ts`

Expected: FAIL because `createApp` is missing.

- [ ] **Step 3: Implement middleware in security-sensitive order**

Construct the app in this order: disable `x-powered-by`; trust exactly one proxy in production; Sentry request setup; request-ID/context middleware; Pino HTTP redaction for `authorization`, `cookie`, `set-cookie`, Clerk signature headers, database URLs, and keys matching `*token*`, `*secret*`, `*password*`; webhook router using raw body and its 300/minute limiter (wired in Task 6); JSON body parser with 1 MiB limit; health routes; Clerk middleware (Task 5); `/v1` 120/minute limiter; `/v1` routes; not-found; Sentry error capture; RFC 9457 error handler. Rate-limit keys use the trusted proxy-normalized client IP, production response headers use the standard draft-8 fields, and stores may remain in-process until multiple API replicas are introduced.

`ProblemError` accepts `{ status, code, title, detail, errors?, cause? }`; the error handler maps Zod errors to 400 `VALIDATION_FAILED`, unknown routes to 404, malformed JSON to 400, and all unknown errors to a generic 500 detail `An unexpected error occurred.` Never include `cause`, stack, SQL, or headers in the body.

Initialize Sentry before importing the app, with `sendDefaultPii: false`, environment/release values from validated config, and disabled operation when DSN is absent locally. On shutdown, stop accepting traffic, close the database pool, flush Sentry for up to 2 seconds, and exit.

- [ ] **Step 4: Verify error, log, and production-build contracts**

Run: `pnpm --filter @puckflow/api test && pnpm --filter @puckflow/api typecheck && pnpm --filter @puckflow/api build`

Expected: tests PASS; `dist/server.js` exists.

Run: `node tooling/operations/verify-railway-config.mjs`

Expected: the API config selects `RAILPACK`, builds with `pnpm --filter @puckflow/api build`, starts with `node apps/api/dist/server.js`, and is the only config with the database pre-deploy command.

- [ ] **Step 5: Commit the API skeleton**

```bash
git add apps/api packages/core packages/db pnpm-lock.yaml
git commit -m "feat(api): add observable HTTP skeleton"
```

### Task 5: Add Clerk JWT authentication, JIT provisioning, and `GET /v1/me`

**Files:**
- Create `packages/db/src/repositories/users.ts`, `packages/db/src/repositories/users.integration.test.ts`.
- Create `apps/api/src/auth/clerk.ts`, `apps/api/src/auth/require-auth.ts`, `apps/api/src/auth/provision-user.ts`.
- Create `apps/api/src/routes/me.ts`, `apps/api/src/routes/me.integration.test.ts`.
- Modify `apps/api/src/app.ts`, `apps/api/src/config.ts`, `apps/api/package.json`.

**Interfaces:**
- Consumes: Clerk `req.auth`, internal database, `MeSchema`, request context.
- Produces: `UserRepository.findByClerkId(clerkId)`, `UserRepository.upsertFromClerk(input)`, `AuthenticatedRequest.user`, protected `GET /v1/me` returning `Me`.

- [ ] **Step 1: Write failing repository and route tests**

Repository test cases: first upsert creates one UUIDv7 user; repeated upsert by the same Clerk ID updates `email`, `displayName`, and `clerkImageUrl` without changing internal ID; soft-deleted user is reactivated on a valid authenticated request.

Route test cases: no auth returns 401 `UNAUTHENTICATED`; existing auth returns `Me`; missing internal user invokes the identity provider once and persists the user; no verified primary email returns 409 `CONFLICT` with safe detail; Clerk provider failure returns generic 503 `INTERNAL` and does not insert a user.

Use dependency injection in tests; never fabricate a JWT or call Clerk over the network.

- [ ] **Step 2: Verify focused red state**

Run: `pnpm --filter @puckflow/db test:integration -- users.integration.test.ts && pnpm --filter @puckflow/api test:integration -- me.integration.test.ts`

Expected: FAIL because the repository and `/v1/me` route do not exist.

- [ ] **Step 3: Implement the identity boundary**

Define this testable adapter:

```ts
export type ClerkIdentity = {
  clerkId: string
  email: string
  displayName: string
  clerkImageUrl: string | null
}

export interface IdentityProvider {
  getUser(clerkId: string): Promise<ClerkIdentity>
}
```

The production adapter calls Clerk only after `clerkMiddleware()` has verified the session. Select the first verified primary email, derive display name in order: nonblank `fullName`, nonblank `username`, email local part; cap to 120 trimmed characters. `requireAuth` checks `req.auth.isAuthenticated` and `req.auth.userId`, provisions/fetches the internal user, attaches only `{ id, clerkId }` to request context, and does not trust client-supplied Clerk IDs.

Return from `/v1/me` only `{ id, email, displayName, avatarUrl: clerkImageUrl }`; validate with `MeSchema` before serialization. Add `Cache-Control: private, no-store`.

- [ ] **Step 4: Verify authenticated integration behavior**

Run: `pnpm --filter @puckflow/db test:integration -- users.integration.test.ts`

Expected: all upsert/reactivation tests PASS.

Run: `pnpm --filter @puckflow/api test:integration -- me.integration.test.ts && pnpm --filter @puckflow/api test`

Expected: all auth/JIT/problem tests PASS, including matching request IDs.

- [ ] **Step 5: Commit the authenticated vertical slice**

```bash
git add apps/api packages/db packages/core pnpm-lock.yaml
git commit -m "feat(auth): provision Clerk users on authenticated requests"
```

### Task 6: Synchronize Clerk users through verified, deduplicated webhooks

**Files:**
- Create `packages/db/src/repositories/webhooks.ts`.
- Create `apps/api/src/routes/clerk-webhooks.ts`, `apps/api/src/routes/clerk-webhooks.integration.test.ts`.
- Modify `apps/api/src/app.ts`, `apps/api/src/config.ts`, `apps/api/package.json`.

**Interfaces:**
- Consumes: `verifyWebhook(req)` from `@clerk/express/webhooks`, `CLERK_WEBHOOK_SIGNING_SECRET`, `UserRepository`.
- Produces: public `POST /webhooks/clerk`; `WebhookRepository.begin(providerEventId,eventType) -> 'acquired'|'duplicate'`; `markProcessed`; `markFailed`.

- [ ] **Step 1: Write failing webhook integration tests**

Test valid `user.created` and `user.updated` upsert the user; `user.deleted` soft-deletes by Clerk ID; repeated event ID returns 200 and makes no second mutation; invalid/missing signature returns 400 `VALIDATION_FAILED`; concurrent duplicate deliveries make one mutation; unsupported verified event records processed and returns 200; processing failure records status `failed` with only error class/code, then returns 500 Problem Details.

Inject a verifier function in tests. Include one adapter unit test that passes a real signed Standard Webhooks fixture through Clerk's `verifyWebhook`; do not replace all signature coverage with a mock.

- [ ] **Step 2: Verify the endpoint is red**

Run: `pnpm --filter @puckflow/api test:integration -- clerk-webhooks.integration.test.ts`

Expected: FAIL with route 404.

- [ ] **Step 3: Implement raw-body verification and idempotent processing**

Mount `/webhooks/clerk` before `express.json()`, using `express.raw({ type: 'application/json', limit: '1mb' })`. Call `verifyWebhook(req, { signingSecret })`; never log the body or signature headers. Insert `webhook_events` first with `ON CONFLICT DO NOTHING`; duplicates return `{"received":true,"duplicate":true}`. Process only `user.created`, `user.updated`, `user.deleted` in a database transaction, update status, and return `{"received":true,"duplicate":false}`.

Deletion must set `deleted_at` and retain the row. If JIT provisioning later sees an active Clerk session, it reactivates the same internal ID. Persist no raw event payload.

- [ ] **Step 4: Verify replay and signature behavior**

Run: `pnpm --filter @puckflow/api test:integration -- clerk-webhooks.integration.test.ts`

Expected: all webhook tests PASS and the duplicate count remains one.

Run: `pnpm --filter @puckflow/api test && pnpm --filter @puckflow/api typecheck`

Expected: all tests/typecheck PASS.

- [ ] **Step 5: Commit webhook synchronization**

```bash
git add apps/api packages/db pnpm-lock.yaml
git commit -m "feat(auth): verify and deduplicate Clerk webhooks"
```

### Task 7: Implement append-only audit, transactional outbox, and safe job primitives

**Files:**
- Create `packages/db/src/repositories/audit.ts`, `packages/db/src/repositories/outbox.ts`, `packages/db/src/repositories/jobs.ts`, `packages/db/src/repositories/operations.integration.test.ts`.
- Modify `packages/db/src/index.ts`.

**Interfaces:**
- Consumes: a Drizzle transaction, request ID, UUIDv7 generator, operational schema.
- Produces: `appendAudit(tx,input)`, `enqueueOutbox(tx,input)`, `dispatchOutboxBatch(db,{now,limit})`, `claimJobs(db,{workerId,now,limit})`, `completeJob(db,input)`, `failJob(db,input)`.

- [ ] **Step 1: Write failing transaction and concurrency tests**

Cover these exact invariants:

- a user update plus audit/outbox rows commits together and all three roll back when the mutation throws;
- audit changes reject keys outside a supplied allowlist and values over 2 KiB serialized;
- dispatch creates one job per outbox event using deterministic key `outbox:<event-id>`, then marks dispatched; rerunning creates no duplicate;
- two concurrent claimers never receive the same job and only claim due `pending` jobs;
- completion is idempotent for the same claimant;
- failures sanitize to `ErrorName: stable-code`, schedule `min(300, 2 ** attempts)` seconds later, clear claim fields, and dead-letter at `maxAttempts`;
- updating/deleting audit through the runtime role is denied.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @puckflow/db test:integration -- operations.integration.test.ts`

Expected: FAIL because operational repository exports are missing.

- [ ] **Step 3: Implement the exact primitive contracts**

Use these input shapes:

```ts
type AuditInput = {
  id: string
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string
  teamId: string | null
  requestId: string
  changes: Record<string, unknown>
  allowedChangeKeys: readonly string[]
}

type OutboxInput = {
  id: string
  eventType: string
  aggregateType: string
  aggregateId: string
  teamId: string | null
  actorUserId: string | null
  payload: Record<string, unknown>
  requestId: string
  occurredAt: Date
}

type ClaimedJob = {
  id: string
  category: string
  deterministicKey: string
  payload: Record<string, unknown>
  attemptCount: number
  maxAttempts: number
}
```

Claim in one SQL statement using a CTE that selects eligible rows with `FOR UPDATE SKIP LOCKED`, updates them to `claimed`, increments attempts, and returns `ClaimedJob[]`. `failJob` may mutate only a row claimed by the supplied worker ID. Persist no stack trace or provider response body.

- [ ] **Step 4: Verify atomicity and at-least-once safety**

Run: `pnpm --filter @puckflow/db test:integration -- operations.integration.test.ts`

Expected: all transaction, uniqueness, concurrency, backoff, and privilege tests PASS.

Run: `pnpm --filter @puckflow/db test && pnpm --filter @puckflow/db typecheck`

Expected: unit tests/typecheck PASS.

- [ ] **Step 5: Commit operational primitives**

```bash
git add packages/db
git commit -m "feat(db): add audit outbox and job primitives"
```

### Task 8: Make worker and cron independently deployable without inventing notification behavior

**Files:**
- Create all worker and cron files from the exact file map.
- Modify root Turbo/build configuration only if their named tasks are absent.

**Interfaces:**
- Consumes: `dispatchOutboxBatch`, `claimJobs`, `completeJob`, `failJob`, `DATABASE_URL`, `SENTRY_*`, `LOG_LEVEL`.
- Produces: `runWorkerIteration(deps): Promise<WorkerIterationResult>`, `runSweep(deps): Promise<SweepResult>`, worker `GET /health/live` and `GET /health/ready`, cron process exit contract.

- [ ] **Step 1: Write failing worker and cron integration tests**

Worker tests insert two `system.smoke` jobs and assert one iteration claims both, invokes the registered handler with `{ jobId, deterministicKey, payload }`, completes successes, and applies Task 7 retry/dead-letter behavior to failures. Assert an unknown category is failed with sanitized code `UnknownJobCategory: unsupported_category`, never marked complete. Assert `SIGTERM` stops claiming, finishes the current batch for at most `WORKER_SHUTDOWN_TIMEOUT_MS=10000`, closes the pool, and flushes Sentry.

Cron tests insert an undispatched outbox row, call one sweep, assert it dispatches exactly one deterministic job, rerun and assert zero new jobs, and verify the process exits 0. A database failure must capture Sentry, log a sanitized error, and exit 1.

- [ ] **Step 2: Verify both services are red**

Run: `pnpm --filter @puckflow/worker test:integration && pnpm --filter @puckflow/cron test:integration`

Expected: FAIL because `runWorkerIteration` and `runSweep` are missing.

- [ ] **Step 3: Implement bounded service loops**

Define worker configuration exactly: `WORKER_ID` defaults to hostname plus process ID, `WORKER_BATCH_SIZE` defaults 20 and is limited 1..100, `WORKER_POLL_INTERVAL_MS` defaults 1000 and is limited 100..60000, `WORKER_SHUTDOWN_TIMEOUT_MS` defaults 10000 and is limited 1000..30000, health port defaults 3001. The handler registry contains only `system.smoke`, which logs the job ID and completes it; this is infrastructure verification, not a user notification.

The worker readiness endpoint runs `select 1`; liveness reports process state without querying dependencies. The loop awaits each iteration, then schedules the next poll; do not use overlapping `setInterval` callbacks.

`runSweep` dispatches at most 100 outbox rows at a supplied `now`, logs `{ dispatchedCount, durationMs }`, closes the database/Sentry, and exits. It adds no reminder schedule and does not run continuously.

- [ ] **Step 4: Verify tests, builds, and images**

Run: `pnpm --filter @puckflow/worker test:integration && pnpm --filter @puckflow/cron test:integration && pnpm --filter @puckflow/worker build && pnpm --filter @puckflow/cron build`

Expected: tests PASS; `apps/worker/dist/server.js` and `apps/cron/dist/main.js` exist.

Run: `node tooling/operations/verify-railway-config.mjs`

Expected: worker and cron select `RAILPACK`, use their exact production build/start commands, and cron is the only scheduled one-shot service.

- [ ] **Step 5: Commit deployable background services**

```bash
git add apps/worker apps/cron packages/db package.json turbo.json pnpm-lock.yaml
git commit -m "feat(operations): add worker and cron skeletons"
```

### Task 9: Implement the shared token-aware API client

**Files:**
- Create `packages/api-client/src/client.ts`, `packages/api-client/src/client.test.ts`, `packages/api-client/src/index.ts` and package configuration.

**Interfaces:**
- Consumes: `MeSchema`, `ProblemDetailsSchema`, `getToken: () => Promise<string|null>`, base URL.
- Produces: `createApiClient(options): ApiClient`, `ApiClient.getMe(): Promise<Me>`, `ApiProblemError`.

- [ ] **Step 1: Write failing fetch-client tests**

Test that `getMe()` calls exactly `${baseUrl}/v1/me`, sends `Authorization: Bearer <token>` and `Accept: application/json`, validates the response with `MeSchema`, and returns the projection. Test missing token throws a local `ApiProblemError` with `UNAUTHENTICATED` without calling fetch. Test a server Problem Details body becomes `ApiProblemError` preserving `code`, `status`, and `requestId`. Test malformed success JSON and malformed error JSON become safe `INTERNAL` errors and never expose response text.

- [ ] **Step 2: Verify red state**

Run: `pnpm --filter @puckflow/api-client test`

Expected: FAIL because `createApiClient` is not exported.

- [ ] **Step 3: Implement one client used unchanged by web and mobile**

Use this public interface:

```ts
export type ApiClientOptions = {
  baseUrl: string
  getToken: () => Promise<string | null>
  fetch?: typeof globalThis.fetch
}

export interface ApiClient {
  getMe(): Promise<Me>
}
```

Normalize `baseUrl` by removing trailing slashes and reject non-HTTPS URLs except `http://localhost` and `http://127.0.0.1`. Set no Clerk template name; use the normal session JWT. Do not retry non-idempotent requests; M0 contains only `GET /v1/me`.

- [ ] **Step 4: Verify shared client behavior**

Run: `pnpm --filter @puckflow/api-client test && pnpm --filter @puckflow/api-client typecheck && pnpm --filter @puckflow/api-client build`

Expected: all tests PASS and ESM/type declaration output exists.

- [ ] **Step 5: Commit the API client**

```bash
git add packages/api-client packages/core pnpm-lock.yaml
git commit -m "feat(api-client): add authenticated me client"
```

### Task 10: Build the thin signed-in Next.js client

**Files:**
- Create all web files from the exact file map.
- Modify `.env.example` with web-safe variables.

**Interfaces:**
- Consumes: `createApiClient`, Clerk `auth().getToken()`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, server-only `API_INTERNAL_URL`, Sentry web variables.
- Produces: public web health route, Clerk sign-in/sign-up pages, protected home page rendering `Me`.

- [ ] **Step 1: Write failing component tests**

Test `MeCard` renders display name and email, uses the label `Signed in as`, renders avatar alt text `<display name> avatar` when present, and has no image when null. Test its retry button calls `getMe` once after an `ApiProblemError` and visibly includes the request ID. Test all controls are keyboard reachable and the primary target has at least 44 CSS pixels.

- [ ] **Step 2: Verify red state**

Run: `pnpm --filter @puckflow/web test -- me-card.test.tsx`

Expected: FAIL because `MeCard` does not exist.

- [ ] **Step 3: Implement Clerk-protected App Router pages**

`proxy.ts` uses `clerkMiddleware` with a route matcher that leaves `/api/health`, `/sign-in(.*)`, and `/sign-up(.*)` public and calls `auth.protect()` for everything else. `app/layout.tsx` wraps the document in `ClerkProvider`. The server-rendered home page obtains `{ getToken } = await auth()`, builds the API client with server-only `API_INTERNAL_URL`, awaits `getMe`, and renders `MeCard`. No session JWT crosses into a client component or appears in HTML.

`/api/health` returns `200 {"status":"ok"}` and does not contact API or Clerk. Sign-in and sign-up use Clerk's hosted components. CSS uses the shared semantic values, supports `prefers-color-scheme: dark`, a responsive centered card, visible focus, and 44 px minimum controls. Add `export const dynamic = 'force-dynamic'` to the authenticated page.

Initialize `@sentry/nextjs` on server, edge, and client with `sendDefaultPii: false`; redact cookies and authorization in `beforeSend`. Source-map upload uses server-only `SENTRY_AUTH_TOKEN` during Railway build and does not expose it at runtime.

- [ ] **Step 4: Verify web test and production build**

Run: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_build API_INTERNAL_URL=http://127.0.0.1:3000 pnpm --filter @puckflow/web test && NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_build API_INTERNAL_URL=http://127.0.0.1:3000 pnpm --filter @puckflow/web build`

Expected: component tests PASS; Next.js production build exits 0 and includes `/`, `/sign-in/[[...sign-in]]`, `/sign-up/[[...sign-up]]`, `/api/health`.

Run: `node tooling/operations/verify-railway-config.mjs`

Expected: the web config selects `RAILPACK`, runs the exact web build command, and starts with `pnpm --filter @puckflow/web start`.

- [ ] **Step 5: Commit the web vertical slice**

```bash
git add apps/web packages/api-client packages/ui-tokens .env.example pnpm-lock.yaml
git commit -m "feat(web): add signed-in me screen"
```

### Task 11: Build the thin signed-in Expo Router client

**Files:**
- Create all mobile files from the exact file map.
- Modify `.env.example` with mobile-safe variables.

**Interfaces:**
- Consumes: `createApiClient`, Clerk `useAuth().getToken`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SENTRY_DSN`.
- Produces: Expo Router app that signs in through Clerk and renders `Me`; encrypted Clerk token cache.

- [ ] **Step 1: Write failing mobile screen tests**

Test loading activity has accessibility label `Loading profile`; signed-out state exposes a 44-point `Sign in` button; signed-in state requests `/v1/me` with the injected token and renders display name/email; server error renders safe detail and request ID; retry invokes one new request; text respects font scaling and no fixed text heights clip dynamic type.

- [ ] **Step 2: Verify red state**

Run: `pnpm --filter @puckflow/mobile test -- me-screen.test.tsx`

Expected: FAIL because `MeScreen` does not exist.

- [ ] **Step 3: Implement native Clerk auth and profile fetch**

Configure Expo Router, bundle IDs `app.puckflow.mobile` on iOS and Android, orientation default, tablet support true, user-interface style automatic, and app scheme `puckflow`. `app/_layout.tsx` wraps `Stack` in `ClerkProvider` using a token cache backed by `expo-secure-store`; never use AsyncStorage for tokens. Initialize Sentry before rendering with `sendDefaultPii: false`.

Use Clerk's native `AuthView` in a page-sheet `Modal` and keep it mounted at the same level as auth states. Call `useAuth({ treatPendingAsSignedOut: false })`. Once signed in, create the API client from `EXPO_PUBLIC_API_URL` and the normal `getToken()` callback. Render `MeScreen` inside `SafeAreaView`; use platform controls, semantic light/dark colors, accessibility roles/labels, and minimum 44-point pressables. Do not add web support, team UI, tabs, deep-link invite behavior, offline persistence, or optimistic queues.

`eas.json` contains development and preview build profiles only; neither submits to a store. `app.config.ts` throws when required public variables are absent outside tests and keeps no secret in `extra`.

- [ ] **Step 4: Verify mobile tests and Expo configuration**

Run: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_build EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 EXPO_PUBLIC_SENTRY_DSN= pnpm --filter @puckflow/mobile test`

Expected: screen, accessibility, retry, and token-cache tests PASS.

Run: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_build EXPO_PUBLIC_API_URL=https://api.example.test EXPO_PUBLIC_SENTRY_DSN= pnpm --filter @puckflow/mobile exec expo config --type public`

Expected: exits 0; output shows scheme `puckflow`, iOS/Android ID `app.puckflow.mobile`, tablet support, and contains no secret key or token.

- [ ] **Step 5: Commit the mobile vertical slice**

```bash
git add apps/mobile packages/api-client packages/ui-tokens .env.example pnpm-lock.yaml
git commit -m "feat(mobile): add signed-in me screen"
```

### Task 12: Enforce the walking skeleton in CI and protected-main policy

**Files:**
- Create `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.github/labeler.yml`.
- Modify root scripts/config only where a command is not already available.
- Create `docs/operations/deployments.md`.

**Interfaces:**
- Consumes: all root scripts/tasks from Tasks 1–11, GitHub-hosted Ubuntu runner, Docker service.
- Produces required checks named `quality`, `unit`, `postgres-integration`, `build-services`, `mobile`, `dependency-review`, `supply-chain`.

- [ ] **Step 1: Write the CI contract into the workspace test**

Extend `workspace.test.mjs` to parse `.github/workflows/ci.yml` and assert all seven stable job IDs, Postgres 17 service health, Node/pnpm pins, frozen lockfile, concurrency cancellation for PRs, no deploy step, no staging environment, and Expo mobile path filtering that falls back to run on workflow changes.

- [ ] **Step 2: Verify the contract fails**

Run: `node --test tooling/tests/workspace.test.mjs`

Expected: FAIL because `.github/workflows/ci.yml` is absent.

- [ ] **Step 3: Implement deterministic CI**

Use `pull_request` and `push` to `main`. Every job checks out with persisted credentials disabled, sets up Node 24.18.0 and pnpm 11.13.0, and installs with `pnpm install --frozen-lockfile`. Commands are:

| Check | Exact command/action |
|---|---|
| `quality` | `pnpm format:check && pnpm lint && pnpm typecheck` |
| `unit` | `pnpm test` |
| `postgres-integration` | migrate empty Postgres, rerun idempotently, then `pnpm test:integration` using admin/runtime URLs |
| `build-services` | `pnpm --filter @puckflow/api build && pnpm --filter @puckflow/web build && pnpm --filter @puckflow/worker build && pnpm --filter @puckflow/cron build && node tooling/operations/verify-railway-config.mjs` with build-safe public values |
| `mobile` | `pnpm check:mobile` when mobile/shared/workflow files change; otherwise a successful explicit skip step |
| `dependency-review` | `actions/dependency-review-action` on pull requests; `pnpm audit --audit-level high` on `main` |
| `supply-chain` | run Trivy filesystem vulnerability/secret/misconfiguration scanning with `severity: HIGH,CRITICAL`, `ignore-unfixed: true`, `exit-code: 1`; do not build repository Dockerfiles |

Use immutable full commit SHAs for all third-party actions and comments beside each SHA naming the release tag. Give jobs read-only contents permission; dependency review receives only `contents: read`.

In `deployments.md`, require branch protection for the seven exact check names, one approving review, dismissal of stale approvals, conversation resolution, linear history, and no direct push/force push. Document that Railway `Wait for CI` is mandatory and deploys only after all required checks on `main`; mobile store submission is never triggered by merge.

- [ ] **Step 4: Run the local equivalents**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm check:mobile`

Expected: all commands exit 0 with no changed tracked files.

Run: `node --test tooling/tests/workspace.test.mjs`

Expected: CI contract PASS.

- [ ] **Step 5: Commit CI and deployment policy**

```bash
git add .github docs/operations/deployments.md package.json turbo.json tooling/tests pnpm-lock.yaml
git commit -m "ci: gate the walking skeleton"
```

### Task 13: Codify and provision the single Railway production topology

**Files:**
- Create the four `railway.toml` files listed in the file map; cron has no health endpoint. Do not create application Dockerfiles because Railway builds all four services with Railpack.
- Create `tooling/operations/verify-railway-config.mjs`, `tooling/operations/verify-railway-config.test.mjs`.
- Create `docs/operations/railway-production.md`, `docs/operations/local-development.md`, `docs/operations/observability.md`.

**Interfaces:**
- Consumes: Railway GitHub integration, private service DNS, health routes, exact app build/start commands.
- Produces: services `api`, `web`, `worker`, `cron`, `postgres`, plus an unattached private `avatars` Railway Bucket reserved for the later media milestone; public API/web domains; five-minute cron schedule; documented variable matrix and smoke test.

- [ ] **Step 1: Write failing Railway configuration tests**

Test each `railway.toml` has `build.builder = "RAILPACK"`, the exact build/start command, watch paths, restart policy, and health path/timeout where persistent. Assert no config contains `dockerfilePath`; only API has pre-deploy `pnpm --filter @puckflow/db migrate`; web has `/api/health`; API `/health/ready`; worker `/health/ready`; cron has schedule `*/5 * * * *`, restart policy `NEVER`, and no health check. Assert no value contains `postgres.railway.internal`, a secret literal, or a public production URL; these belong in Railway variables.

- [ ] **Step 2: Verify red state**

Run: `node --test tooling/operations/verify-railway-config.test.mjs`

Expected: FAIL because service config files are absent or incomplete.

- [ ] **Step 3: Add exact service configuration and runbooks**

Use these Railway contracts:

| Service | Railpack build | Start | Health | Restart | Watch paths |
|---|---|---|---|---|---|
| API | `pnpm --filter @puckflow/api build` | `node apps/api/dist/server.js` | `/health/ready`, 120 s | `ON_FAILURE`, max 3 | API + core + db + root lock/config |
| Web | `pnpm --filter @puckflow/web build` | `pnpm --filter @puckflow/web start` | `/api/health`, 120 s | `ON_FAILURE`, max 3 | web + api-client + core + ui-tokens + root lock/config |
| Worker | `pnpm --filter @puckflow/worker build` | `node apps/worker/dist/server.js` | `/health/ready`, 120 s | `ON_FAILURE`, max 3 | worker + db + core + root lock/config |
| Cron | `pnpm --filter @puckflow/cron build` | `node apps/cron/dist/main.js` | none | `NEVER` | cron + db + core + root lock/config |

In `railway-production.md`, give dashboard steps in order: create one project and `production` environment; add Railway Postgres; generate `PUCKFLOW_APP_PASSWORD` with `openssl rand -hex 32`, save it as a sealed Railway project variable, and run the following through `psql` using the owner URL:

```bash
psql "$MIGRATION_DATABASE_URL" \
  --set ON_ERROR_STOP=1 \
  --set app_password="$PUCKFLOW_APP_PASSWORD" \
  --command "CREATE ROLE puckflow_app LOGIN PASSWORD :'app_password'; GRANT CONNECT ON DATABASE railway TO puckflow_app; GRANT USAGE ON SCHEMA public TO puckflow_app;"
```

Then construct the runtime private URL in Railway as `postgresql://puckflow_app:${{shared.PUCKFLOW_APP_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}`; add a private Railway Bucket named `avatars` but do not expose its credentials to any M0 service; add API/web/worker/cron from the same GitHub repo using their config file paths; enable private networking; generate public domains only for API/web; set cron to `*/5 * * * *`; enable `Wait for CI`; set API migration pre-deploy; verify each watch path; connect external uptime monitor to API `/health/live` and web `/api/health` at one-minute intervals. State that the owner URL is assigned only to `MIGRATION_DATABASE_URL`, the runtime URL only to `DATABASE_URL`, the generated password is unset from the operator shell after configuration, and Railway's PITR recovery bucket is separately managed by Railway and is never reused as the application bucket.

Document this variable matrix with source and exposure:

| Variable | Services | Source/exposure |
|---|---|---|
| `DATABASE_URL` | API, worker, cron | runtime-role private URL; server-only |
| `MIGRATION_DATABASE_URL` | API pre-deploy only | owner private URL; server-only |
| `CLERK_PUBLISHABLE_KEY` | API | Clerk; server-only |
| `CLERK_SECRET_KEY` | API | Clerk; server-only |
| `CLERK_WEBHOOK_SIGNING_SECRET` | API | Clerk endpoint; server-only |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | web build/runtime | Clerk; intentionally public |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | EAS only | Clerk; intentionally public |
| `API_INTERNAL_URL` | web | Railway reference to API private URL; server-only |
| `EXPO_PUBLIC_API_URL` | EAS only | API public domain; intentionally public |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | API/worker/cron | Sentry; server-only |
| `NEXT_PUBLIC_SENTRY_DSN` | web | Sentry browser DSN; intentionally public |
| `SENTRY_AUTH_TOKEN` | web build only | Sentry; server-only and unset at runtime |
| `PORT`, `LOG_LEVEL` | persistent services | Railway/reference; server-only |

Include Clerk dashboard setup: production instance, enabled email/social methods selected by product owner, API authorized parties for both public origins, webhook endpoint `${API_PUBLIC_URL}/webhooks/clerk`, only `user.created`, `user.updated`, `user.deleted`, signing secret copied to Railway, and one signed test delivery verified in database without recording payload.

`observability.md` defines alerts for API/web uptime failure after two consecutive checks, any job dead letter, five repeated provider/job failures in ten minutes, Postgres CPU/memory/disk thresholds supported by Railway, and backup/PITR failure. It includes log query fields `service`, `environment`, `release`, `requestId`, `jobId`, `status`, `durationMs` and a request-ID investigation sequence.

- [ ] **Step 4: Verify repository config, then provision production**

Run: `node --test tooling/operations/verify-railway-config.test.mjs && node tooling/operations/verify-railway-config.mjs`

Expected: PASS and output `Railway configuration valid: api, web, worker, cron`.

After merging through protected `main`, follow `railway-production.md` and run:

```bash
curl --fail --silent --show-error "https://${API_DOMAIN}/health/ready"
curl --fail --silent --show-error "https://${WEB_DOMAIN}/api/health"
```

Expected: each returns exactly `{"status":"ok"}` after the operator exports `API_DOMAIN` and `WEB_DOMAIN` from Railway's generated domains; do not commit those environment-specific values.

In Railway logs, verify exactly one API pre-deploy migration, worker readiness, one cron execution with exit 0, JSON logs containing `environment=production` and release SHA, and no secret values. Record deployment URL/ID and release SHA in the protected deployment record, not source control.

- [ ] **Step 5: Commit production topology and runbooks**

```bash
git add apps/api apps/web apps/worker apps/cron tooling/operations docs/operations README.md
git commit -m "ops: codify Railway production topology"
```

### Task 14: Enable backups/PITR and complete a production restore drill

**Files:**
- Create `docs/operations/backups-and-pitr.md`, `docs/operations/restore-drills/README.md`.
- Create `tooling/operations/verify-restore-drill.mjs`, `tooling/operations/verify-restore-drill.test.mjs`.
- Create one immutable drill record at `docs/operations/restore-drills/YYYY-MM-DD-production-pitr.md` using the actual UTC drill date.
- Modify `docs/operations/railway-production.md` to link the successful record.

**Interfaces:**
- Consumes: production Railway Postgres, scheduled backup/PITR features, API readiness and authenticated `/v1/me` smoke paths.
- Produces: enabled scheduled backup, enabled PITR, rehearsed sibling-service restore/cutover/rollback, machine-checked evidence record.

- [ ] **Step 1: Write failing evidence-validator tests**

Use a temporary fixtures directory to prove the validator rejects: no drill record, missing source/restore service IDs, missing UTC target time, missing pre/post marker query, unmeasured RPO/RTO, failed health check, failed authenticated request, unrecorded rollback, and a record with `result` other than `passed`. Prove it accepts a fully populated fixture whose `targetUtc < startedUtc < completedUtc`, nonnegative RPO/RTO are numeric seconds, all checks are `passed`, and rollback is `completed`.

- [ ] **Step 2: Verify the validator is red**

Run: `node --test tooling/operations/verify-restore-drill.test.mjs`

Expected: FAIL because the validator does not exist.

- [ ] **Step 3: Implement the runbook and strict record schema**

`backups-and-pitr.md` must prescribe: enable scheduled backups before user data; enable PITR and wait for the first base backup; verify archive health daily; capture a pre-target marker row and UTC timestamp; capture a post-target marker; restore the chosen timestamp to the Railway-created sibling service; verify the pre-target marker exists and post-target marker does not; run schema/read checks; pause deploys/writes for cutover; save old runtime URLs in Railway variable history; update `DATABASE_URL` and `MIGRATION_DATABASE_URL` references for API/worker/cron; redeploy API then worker then cron; run health and authenticated `/v1/me`; roll back all references to source; verify health; delete the sibling only after evidence review. State clearly that PITR is not retroactive and the source remains untouched until deliberate cutover.

The validator parses YAML frontmatter with these required, non-null fields:

| Field | Exact validation |
|---|---|
| `result` | literal `passed` |
| `environment` | literal `production` |
| `sourceServiceId`, `restoredServiceId` | distinct non-empty Railway service ID strings |
| `releaseSha` | 40 lowercase hexadecimal characters |
| `targetUtc`, `startedUtc`, `completedUtc` | ISO-8601 UTC strings with `targetUtc < startedUtc < completedUtc` |
| `rpoSeconds`, `rtoSeconds` | nonnegative integers measured during this drill |
| `preTargetMarker`, `postTargetMarkerAbsent`, `migrationsCurrent`, `apiReadiness`, `authenticatedGetMe`, `workerReadiness`, `cronExit` | literal `passed` for every field |
| `rollback` | literal `completed` |
| `reviewer` | non-empty GitHub username distinct from the record author |

The checked-in record contains only values copied from the actual drill evidence. `restore-drills/README.md` declares records immutable; corrections are a new drill record.

- [ ] **Step 4: Enable recovery and execute the full drill**

Follow the runbook in production. Use an authenticated Clerk session token held only in the current shell to run:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${CLERK_SESSION_TOKEN}" \
  -H "x-request-id: restore-drill-${DRILL_UTC_COMPACT}" \
  https://${API_DOMAIN}/v1/me
```

Expected: 200 body validates against `MeSchema`; neither the token nor response email is copied into the drill record. Measure RPO from target timestamp to last retained transaction and RTO from drill start to restored authenticated success. Complete rollback to the original source before ending the drill.

Create the record with actual evidence, obtain reviewer sign-off, then run: `node tooling/operations/verify-restore-drill.mjs docs/operations/restore-drills`

Expected: `Restore drill valid: 1 passed production record` (or the actual passed-record count if later immutable records exist).

- [ ] **Step 5: Run the Milestone 0 exit gate**

Run locally: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm check:mobile && node tooling/operations/verify-railway-config.mjs && node tooling/operations/verify-restore-drill.mjs docs/operations/restore-drills`

Expected: every command exits 0; no tracked file changes are produced.

Run production smoke checks from web and mobile while signed in.

Expected: both display the same internal `Me.id`; API/web/worker are healthy; the latest cron execution exits 0; Sentry release matches the protected-main SHA; restore record result is `passed`.

- [ ] **Step 6: Commit the verified recovery record**

```bash
git add docs/operations/backups-and-pitr.md docs/operations/restore-drills docs/operations/railway-production.md tooling/operations
git commit -m "docs(operations): record production restore drill"
```

---

## Milestone 0 Acceptance Trace

| Approved requirement | Plan coverage | Observable evidence |
|---|---|---|
| Monorepo and shared schemas | Tasks 1–2 | workspace contract, package tests, frozen lockfile |
| Local Postgres | Tasks 1, 3 | healthy Compose service, repeatable migration tests |
| Railway topology/config/runbook | Tasks 8, 13 | config validator, public health checks, private variable matrix |
| Clerk auth, JIT, webhooks | Tasks 5–6 | auth/JIT/replay/signature integration tests and production signed request |
| User and operational tables | Tasks 3, 5–7 | empty-database/privilege/atomicity/concurrency tests |
| RFC 9457, request IDs, logs, Sentry | Tasks 2, 4, 13 | API contract tests, correlated production log/Sentry release |
| Signed-in web/mobile clients | Tasks 9–11 | client tests, builds/config check, same production `Me.id` |
| CI and protected main | Task 12 | seven required checks and documented branch protection |
| Backups, PITR, restore drill | Task 14 | strict passed immutable production drill record |
| Protected merge deploys healthy production | Tasks 12–14 | merge SHA, API/web/worker health, cron exit 0, authenticated `/v1/me` |

## GitHub issue manifest

### 1. Bootstrap pinned monorepo and shared contracts

- **Issue:** [#13](https://github.com/marknotfound/puckflow/issues/13)
- **Labels:** `type:feature`, `area:platform`, `area:data`, `priority:p0`
- **Dependencies:** none
- **Body:** Establish the exact pnpm/Turborepo workspace, local Postgres service, nine package identities, shared Problem Details/Me schemas, and semantic tokens. Keep application behavior out of this issue.
- **Acceptance criteria:**
  - Dependency-free workspace contract passes.
  - Frozen install is reproducible on Node 24.18.0/pnpm 11.13.0.
  - Local Postgres 17.10 reports healthy.
  - Core schema and token tests/typechecks pass.
- **Plan task references:** Task 1, Task 2.

### 2. Add Postgres identity and operational foundations

- **Issue:** [#14](https://github.com/marknotfound/puckflow/issues/14)
- **Labels:** `type:feature`, `area:platform`, `area:data`, `priority:p0`
- **Dependencies:** [#13](https://github.com/marknotfound/puckflow/issues/13)
- **Body:** Add the checked-in M0 migration, Drizzle schema, least-privilege application role, user repository, append-only audit, transactional outbox, and concurrency-safe job repository.
- **Acceptance criteria:**
  - Empty and repeat migration tests pass on Postgres 17.10.
  - Runtime role cannot update/delete audit rows.
  - User upsert preserves internal UUIDv7 identity.
  - Mutation/audit/outbox rollback together.
  - Dispatch/claim/retry/dead-letter tests prove idempotency and no double claim.
- **Plan task references:** Task 3, Task 5 repository steps, Task 7.

### 3. Deliver authenticated Express API and Clerk synchronization

- **Issue:** [#15](https://github.com/marknotfound/puckflow/issues/15)
- **Labels:** `type:feature`, `area:api`, `area:auth`, `priority:p0`
- **Dependencies:** [#14](https://github.com/marknotfound/puckflow/issues/14)
- **Body:** Build the Express security/observability middleware chain, RFC 9457 responses, request-ID correlation, Sentry, Clerk JWT authentication, JIT user provisioning, `GET /v1/me`, and signature-verified deduplicated user webhooks.
- **Acceptance criteria:**
  - Public health and protected `/v1/me` contracts pass.
  - All error responses validate against `ProblemDetailsSchema`.
  - Logs/Sentry correlate by request ID without secrets.
  - Webhook signature, replay, concurrency, update, and delete tests pass.
  - API production build and Railpack configuration validation pass.
- **Plan task references:** Task 4, Task 5 API steps, Task 6.

### 4. Add deployable worker and cron skeletons

- **Issue:** [#16](https://github.com/marknotfound/puckflow/issues/16)
- **Labels:** `type:feature`, `area:platform`, `area:notifications`, `priority:p1`
- **Dependencies:** [#14](https://github.com/marknotfound/puckflow/issues/14)
- **Body:** Exercise the Postgres async primitives through bounded worker iterations and an idempotent five-minute cron sweep without implementing user notification categories.
- **Acceptance criteria:**
  - Worker handles success, retry, dead letter, unknown category, and graceful shutdown.
  - Cron dispatches once, is idempotent, closes resources, and exits 0.
  - Readiness/liveness behavior passes.
  - Both production images build pinned and non-root.
- **Plan task references:** Task 8.

### 5. Connect signed-in web and mobile clients to `/v1/me`

- **Issue:** [#17](https://github.com/marknotfound/puckflow/issues/17)
- **Labels:** `type:feature`, `area:web`, `area:mobile`, `area:auth`, `priority:p1`
- **Dependencies:** [#15](https://github.com/marknotfound/puckflow/issues/15)
- **Body:** Add one validated token-aware API client, a Clerk-protected responsive Next.js page, and a native Expo Router screen using encrypted token storage and platform-appropriate auth UI.
- **Acceptance criteria:**
  - API client validates both success and Problem Details responses.
  - Web never serializes session tokens into HTML and production build passes.
  - Mobile stores Clerk tokens only in SecureStore and Expo config contains no secrets.
  - Web/mobile accessibility and retry tests pass.
  - Both clients display the same production internal user ID.
- **Plan task references:** Task 9, Task 10, Task 11.

### 6. Gate and operate the production walking skeleton

- **Issue:** [#18](https://github.com/marknotfound/puckflow/issues/18)
- **Labels:** `type:security`, `area:platform`, `area:ops`, `priority:p0`
- **Dependencies:** [#16](https://github.com/marknotfound/puckflow/issues/16), [#17](https://github.com/marknotfound/puckflow/issues/17)
- **Body:** Add the seven required CI checks, branch/deployment policy, four Railway service configs, production runbooks and alerts, then enable backups/PITR and check in a reviewed passed restore drill.
- **Acceptance criteria:**
  - All seven checks are protected-main requirements and pass.
  - Exactly one service owns migration pre-deploy.
  - API/web/worker health and cron exit are verified for the protected-main SHA.
  - Clerk production webhook test is verified without retaining payload.
  - Scheduled backup and PITR are enabled and healthy.
  - A sibling-service restore, cutover, authenticated request, and rollback are recorded as passed and validator-approved.
- **Plan task references:** Task 12, Task 13, Task 14.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-13-puckflow-m0-foundations.md`.

Two execution options:

1. **Subagent-Driven (recommended):** use `superpowers:subagent-driven-development`, dispatch a fresh worker per task, and perform two-stage review between tasks.
2. **Inline Execution:** use `superpowers:executing-plans`, execute in batches, and stop at review checkpoints.
