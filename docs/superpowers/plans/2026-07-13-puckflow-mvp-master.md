# PuckFlow MVP Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan milestone-by-milestone. Treat each linked milestone plan as the executable task specification and keep its checkboxes current.

**Goal:** Deliver the approved PuckFlow team MVP from walking skeleton through a secure, observable, recoverable beta without reintroducing deferred product scope.

**Architecture:** Build a TypeScript modular monolith in a pnpm/Turborepo workspace. Express is the only application data boundary; Next.js and Expo consume a shared Zod-validated API client. PostgreSQL owns domain state, append-only audit records, transactional outbox events, and durable jobs. Railway builds the API, web, worker, and cron services with Railpack; Docker Compose is used only for local PostgreSQL. Milestones are sequential capability gates, and every database change remains compatible with an overlapping prior application revision.

**Tech Stack:** Node.js 24.18.0 LTS, Corepack 0.35.0, pnpm 11.13.0, TypeScript 6.0.3, PostgreSQL 17.10, Express 5.2.1, Next.js 16.2.10, Expo SDK 57.0.4 / React Native 0.86.0 / React 19.2.3, Drizzle ORM, Zod, Clerk, Sentry, Vitest, Jest/`jest-expo`, Playwright, Railway Railpack, and EAS.

## Sources of truth

Use these in descending order when resolving implementation questions:

1. The approved product and architecture plan: [`docs/puckflow-mvp-plan.md`](../../puckflow-mvp-plan.md).
2. This master plan for cross-milestone order, global contracts, paths, dependencies, and exit gates.
3. The linked milestone plan for task-level files, tests, commands, and commit boundaries.
4. The linked GitHub issue for tracker state and acceptance visibility.

If a milestone plan conflicts with the approved MVP direction, stop and report the conflict. Do not silently introduce a new product rule.

## Global constraints

- Implement only team creation/membership, roster linkage, avatars, seasons, team-owned games with opponent snapshots, RSVP, the four game push categories, one approximately-24-hour unknown-response reminder, final results, optional partial goal detail, and incomplete-aware team/player statistics.
- Keep roles exactly `owner | manager | member`; invitations grant `member` only.
- Keep RSVP exactly `unknown | going | not_going`; a missing RSVP row projects as `unknown`.
- Final score is authoritative. Outcome is derived as `win | loss | tie`; decision method is independently recorded as `regulation | overtime | shootout`. Do not invent a tie/decision-method restriction.
- Do not add leagues, standings, shared canonical games, score disputes, live scoring, offline synchronization, period score grids, public profiles/search, an in-app notification inbox, per-category notification preferences, a second/configurable reminder, advanced CDN/image infrastructure, user-driven player claims, a full audit UI/archive, deferred installation deep linking, staging/PR environments, payments, penalties, goalie/line statistics, or chat.
- All non-public API access is authorized on the server. Cross-team or invisible resources return 404; visible but unauthorized actions return 403.
- Use RFC 9457 Problem Details, request IDs, UUIDv7 application IDs, UTC timestamps, curated projections, structured single-line logs, and allowlisted audit changes.
- Domain writes, audits, and outbox rows that represent one operation commit in one transaction.
- Never store or log raw tokens, provider credentials, unrestricted rows, raw provider failures, or unsealed invitation delivery secrets.
- Use checked-in expand-and-contract SQL migrations. The API is the only production migration owner.
- Railway application services use `build.builder = "RAILPACK"` and exact build/start commands. Do not create application Dockerfiles or `dockerfilePath` settings.
- Local PostgreSQL uses the exact official image `postgres:17.10-alpine3.24`; production remains Railway PostgreSQL major 17.
- Every task follows red-green-refactor, focused verification, broader regression verification, and an intentional conventional commit.

## Milestone plan and tracker index

| Gate | Implementation plan | GitHub milestone | Issues | Gate purpose |
|---|---|---|---|---|
| M0 | [Walking Skeleton](2026-07-13-puckflow-m0-foundations.md) | [M0 - Walking Skeleton](https://github.com/marknotfound/puckflow/milestone/1) | [#13](https://github.com/marknotfound/puckflow/issues/13)-[#18](https://github.com/marknotfound/puckflow/issues/18) | Reproducible, authenticated, deployable, recoverable foundation |
| M1 | [Teams and Rosters](2026-07-13-puckflow-m1-teams-rosters.md) | [M1 - Teams & Rosters](https://github.com/marknotfound/puckflow/milestone/2) | [#19](https://github.com/marknotfound/puckflow/issues/19)-[#26](https://github.com/marknotfound/puckflow/issues/26) | Tenant, membership, roster, avatar, and switching workflows |
| M2 | [Seasons, Games, RSVP, and Notifications](2026-07-13-puckflow-m2-games-rsvp.md) | [M2 - Games & RSVP](https://github.com/marknotfound/puckflow/milestone/3) | [#27](https://github.com/marknotfound/puckflow/issues/27)-[#34](https://github.com/marknotfound/puckflow/issues/34) | Scheduling, attendance, push delivery, and reminders |
| M3 | [Results and Recorded Statistics](2026-07-13-puckflow-m3-results-stats.md) | [M3 - Results & Recorded Stats](https://github.com/marknotfound/puckflow/milestone/4) | [#1](https://github.com/marknotfound/puckflow/issues/1)-[#6](https://github.com/marknotfound/puckflow/issues/6) | Post-game results and incomplete-aware statistics |
| M4 | [Beta Hardening](2026-07-13-puckflow-m4-beta-hardening.md) | [M4 - Beta Hardening](https://github.com/marknotfound/puckflow/milestone/5) | [#7](https://github.com/marknotfound/puckflow/issues/7)-[#12](https://github.com/marknotfound/puckflow/issues/12) | Security, accessibility, resilience, recovery, and beta delivery |

## Issue index

| Milestone | Issues in execution order |
|---|---|
| M0 | [#13 Bootstrap pinned monorepo and shared contracts](https://github.com/marknotfound/puckflow/issues/13); [#14 Add Postgres identity and operational foundations](https://github.com/marknotfound/puckflow/issues/14); [#15 Deliver authenticated Express API and Clerk synchronization](https://github.com/marknotfound/puckflow/issues/15); [#16 Add deployable worker and cron skeletons](https://github.com/marknotfound/puckflow/issues/16); [#17 Connect signed-in web and mobile clients to `/v1/me`](https://github.com/marknotfound/puckflow/issues/17); [#18 Gate and operate the production walking skeleton](https://github.com/marknotfound/puckflow/issues/18) |
| M1 | [#19 Define Milestone 1 team and roster domain contracts](https://github.com/marknotfound/puckflow/issues/19); [#20 Deliver authorized team CRUD](https://github.com/marknotfound/puckflow/issues/20); [#21 Add secure invitations and membership lifecycle](https://github.com/marknotfound/puckflow/issues/21); [#22 Add transactional ownership transfer and team deletion safeguards](https://github.com/marknotfound/puckflow/issues/22); [#23 Deliver roster CRUD and manager-controlled player linkage](https://github.com/marknotfound/puckflow/issues/23); [#24 Add private Railway Bucket avatar pipeline](https://github.com/marknotfound/puckflow/issues/24); [#25 Build web teams, rosters, avatars, and switching](https://github.com/marknotfound/puckflow/issues/25); [#26 Build mobile teams, rosters, avatars, switching, and acceptance proof](https://github.com/marknotfound/puckflow/issues/26) |
| M2 | [#27 Define M2 game, RSVP, and push domain contracts](https://github.com/marknotfound/puckflow/issues/27); [#28 Persist seasons, games, attendance, and notification operations](https://github.com/marknotfound/puckflow/issues/28); [#29 Ship season and game scheduling APIs](https://github.com/marknotfound/puckflow/issues/29); [#30 Ship RSVP, team mute, and device-token APIs](https://github.com/marknotfound/puckflow/issues/30); [#31 Deliver durable game push notifications from the worker](https://github.com/marknotfound/puckflow/issues/31); [#32 Schedule idempotent approximately-24-hour RSVP reminders](https://github.com/marknotfound/puckflow/issues/32); [#33 Build typed clients and responsive web scheduling and attendance](https://github.com/marknotfound/puckflow/issues/33); [#34 Build mobile games and push lifecycle, then prove M2 operations](https://github.com/marknotfound/puckflow/issues/34) |
| M3 | [#1 Define result, goal, and statistics domain contracts](https://github.com/marknotfound/puckflow/issues/1); [#2 Persist authoritative results and optional goal details](https://github.com/marknotfound/puckflow/issues/2); [#3 Add transactional result, goal, and statistics APIs](https://github.com/marknotfound/puckflow/issues/3); [#4 Build web post-game result and statistics flows](https://github.com/marknotfound/puckflow/issues/4); [#5 Build mobile post-game result and statistics flows](https://github.com/marknotfound/puckflow/issues/5); [#6 Verify the Milestone 3 result and statistics vertical slice](https://github.com/marknotfound/puckflow/issues/6) |
| M4 | [#7 Harden API security boundaries and secret redaction](https://github.com/marknotfound/puckflow/issues/7); [#8 Complete production observability and incident runbooks](https://github.com/marknotfound/puckflow/issues/8); [#9 Prove load and failure recovery behavior](https://github.com/marknotfound/puckflow/issues/9); [#10 Complete accessibility, dark mode, and adaptive-layout review](https://github.com/marknotfound/puckflow/issues/10); [#11 Configure EAS preview and internal-store delivery](https://github.com/marknotfound/puckflow/issues/11); [#12 Verify Railway recovery and certify beta readiness](https://github.com/marknotfound/puckflow/issues/12) |

## Dependency graph

An arrow points from prerequisite to dependent issue. The detailed dependency section in each issue must use these issue-number links.

```text
M0: #13 -> #14 -> #15 -> #17 --+
             +-> #16 ----------+-> #18

M1: #18 -> #19 -> #20 -> #21 -> #22
                    +-----------> #23 --+
                         #21 ---> #24 --+-> #25 -> #26

M2: #26 -> #27 -> #28 -> #29 --+-> #31 --+
                         +-> #30 +-> #31   |
                              +---> #32 ---+-> #34
                   #29 + #30 -----> #33 --+

M3: #34 -> #1 -> #2 -> #3 -> #4 --+
                             +-> #5 --+-> #6

M4: #6 -> #7 --+
        +-> #8 --+-> #9 -----+
        +-> #10 -> #11 ------+-> #12
```

Exact prerequisite sets:

```text
#13 none; #14 #13; #15 #14; #16 #14; #17 #15; #18 #16 #17
#19 #18; #20 #19; #21 #20; #22 #21; #23 #19 #20; #24 #20 #21; #25 #21 #23 #24; #26 #25
#27 #26; #28 #27; #29 #28; #30 #28; #31 #29 #30; #32 #28 #30; #33 #29 #30; #34 #31 #32 #33
#1 #34; #2 #1; #3 #2; #4 #3; #5 #3; #6 #4 #5
#7 #6; #8 #6; #9 #7 #8; #10 #6; #11 #10; #12 #9 #11
```

## Global implementation contracts

### Repository paths and migration sequence

```text
API routes:           apps/api/src/routes/**
API services:         apps/api/src/services/**
Web App Router:       apps/web/app/**
Web feature code:     apps/web/src/features/**
Expo Router:          apps/mobile/app/**
Mobile feature code:  apps/mobile/src/features/**
Domain contracts:     packages/core/src/**
Database code:        packages/db/src/**
Checked-in SQL:       packages/db/drizzle/**
Worker entrypoint:    apps/worker/src/server.ts
Worker composition:   apps/worker/src/runner.ts
Worker configuration: apps/worker/src/config.ts
Cron entrypoint:      apps/cron/src/main.ts
Cron composition:     apps/cron/src/sweep.ts
Cron configuration:   apps/cron/src/config.ts
```

Migrations are globally ordered and never renumbered:

```text
0000_m0_foundations.sql
0001_teams_rosters.sql
0002_games_rsvp_notifications.sql
0003_results_goals.sql
```

The migration verification command is `pnpm --filter @puckflow/db test:migrations`.

### Identity, authorization, and errors

```ts
export type TeamRole = 'owner' | 'manager' | 'member';

export type AuthenticatedRequest = Express.Request & {
  requestId: string;
  user: { id: string; clerkId: string };
  teamScope?: TeamScope;
};

export type TeamScope = {
  teamId: string;
  actorUserId: string;
  membershipId: string;
  role: TeamRole;
  requestId: string;
};

export class ProblemError extends Error {
  constructor(input: {
    status: number;
    code: ProblemCode;
    title: string;
    detail: string;
    errors?: Array<{ path: string; message: string }>;
    cause?: unknown;
  });
}
```

Clerk middleware may read Clerk's `req.auth` internally, but application routes and services consume only the attached internal `req.user` and `TeamScope` values.

### Database, audit, outbox, and jobs

```ts
export type Database = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export function createDatabase(url: string): Database;
export function closeDatabase(database: Database): Promise<void>;

export type AuditInput = {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  teamId: string | null;
  requestId: string;
  changes: Record<string, unknown>;
  allowedChangeKeys: readonly string[];
};

export type OutboxInput = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  teamId: string | null;
  actorUserId: string | null;
  payload: Record<string, unknown>;
  requestId: string;
  occurredAt: Date;
};

export function appendAudit(tx: DbTransaction, input: AuditInput): Promise<void>;
export function enqueueOutbox(tx: DbTransaction, input: OutboxInput): Promise<void>;
```

`jobs.status` is exactly `pending | claimed | completed | canceled | dead_letter`; use `attemptCount` and `maxAttempts`. `jobs.deterministic_key` is globally unique. Claims use `FOR UPDATE SKIP LOCKED`; transient failures retry with bounded backoff; only sanitized failure codes are persisted.

### Client and transport

```ts
export function createApiClient(options: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  getRequestId?: () => string;
}): ApiClient;
```

The client sends Bearer auth and `x-request-id`, validates response projections with shared Zod schemas, and maps Problem Details to a typed client error. Web and mobile may differ in presentation and navigation, not in API payload shape or authorization assumptions.

### Games, results, and notifications

- A game belongs to one team and one of that team's seasons. `opponentName` is a snapshot, never another team foreign key.
- Game status begins as `scheduled | canceled` in M2 and expands compatibly with `final` in M3.
- Material game changes are opponent, scheduled date/time, or venue changes; they increment `notificationRevision`. Home/away-only edits do not emit push.
- Push categories are exactly `game.scheduled`, `game.changed`, `game.canceled`, and `game.rsvp_reminder`. M1's `team.invitation` email handler is preserved but is not a game-notification category.
- Per-team mute covers the four game push categories. There is no inbox, digest, badge model, or per-category preference in MVP.
- Final score columns are authoritative and nullable until finalization. Outcome is derived; optional goal detail may be partial but cannot exceed the team score.
- Player statistics expose incompleteness rather than presenting partial goal rows as complete totals.

### Commands and deployment

All manifests pin exact versions. Use `corepack@0.35.0`, then `corepack enable pnpm`; install with `pnpm install --frozen-lockfile`. Use `expo install --fix` for Expo-native compatibility checks.

Railway commands are fixed:

| Service | Builder | Build command | Start command | Health/predeploy |
|---|---|---|---|---|
| API | `RAILPACK` | `pnpm --filter @puckflow/api build` | `node apps/api/dist/server.js` | `/health/ready`; API alone runs `pnpm --filter @puckflow/db migrate` predeploy |
| Web | `RAILPACK` | `pnpm --filter @puckflow/web build` | `pnpm --filter @puckflow/web start` | `/api/health`; no migration |
| Worker | `RAILPACK` | `pnpm --filter @puckflow/worker build` | `node apps/worker/dist/server.js` | `/health/ready`; no migration |
| Cron | `RAILPACK` | `pnpm --filter @puckflow/cron build` | `node apps/cron/dist/main.js` | `*/5 * * * *`; no health endpoint or migration |

## Verified dependency decisions

The complete exact ledger lives in the M0 plan. The following decisions are cross-milestone constraints, verified against official documentation and current registries on 2026-07-13:

- Use Node 24.18.0 LTS, pnpm 11.13.0, Corepack 0.35.0, and TypeScript 6.0.3. TypeScript 7 is excluded because the selected `typescript-eslint@8.64.0` supports TypeScript below 6.1.
- Expo SDK 57.0.4 owns React Native 0.86.0 and React/React DOM 19.2.3 compatibility. Use `jest-expo@57.0.1`; do not add deprecated `react-test-renderer`.
- Expo-native exact additions are AsyncStorage 2.2.0, Image Picker/Manipulator 57.0.2, Notifications 57.0.3, Haptics 57.0.0, and DateTimePicker 9.1.0.
- Use Sentry React Native 7.11.0 because it is the Expo SDK 57 compatible line, even though a newer independent major exists.
- Milestone additions are AWS S3 clients 3.1086.0, `file-type` 22.0.1, Sharp 0.35.3, Resend 6.17.2, Firebase Admin 14.1.0, `@parse/node-apn` 8.1.0, `fast-check` 4.9.0, `axe-core` / `@axe-core/playwright` 4.12.1, Playwright 1.61.1, and EAS CLI 21.0.0.
- Use `postgres:17.10-alpine3.24` locally. Do not use a floating `postgres:17`, `alpine`, or stale 17.5 tag.

Verification sources: [Railway Config as Code](https://docs.railway.com/config-as-code/reference), [Railway Railpack](https://docs.railway.com/builds/railpack), [Docker Official Image for Postgres](https://hub.docker.com/_/postgres?tab=tags), [Node.js 24.18.0 release](https://nodejs.org/en/blog/release/v24.18.0), [pnpm installation and compatibility](https://pnpm.io/installation), [typescript-eslint dependency versions](https://typescript-eslint.io/users/dependency-versions/), [Expo SDK version matrix](https://docs.expo.dev/versions/latest/), [Expo unit testing](https://docs.expo.dev/develop/unit-testing/), and the npm registry package metadata used for every exact package pin.

## Milestone exit criteria

- **M0:** A protected merge to `main` passes CI, migrates production, deploys healthy services, and supports an authenticated end-to-end request.
- **M1:** A real manager can create a team, invite users, represent non-user players, and control roster linkage from web and mobile.
- **M2:** A real team can schedule its next games and obtain a useful attendance view that includes users and non-users.
- **M3:** Managers can record real post-game results and partial scoring details without data inconsistency or misleading statistics.
- **M4:** Multiple real teams can use PuckFlow repeatedly with monitored, recoverable production operations.

No milestone starts until its prerequisite issue set is closed and the prior milestone exit criterion has current verification evidence.

## Execution handoff

Use subagent-driven implementation as the default execution mode. Start a fresh implementation task with this master plan and the current milestone plan in context. Work one issue/task at a time, using a dedicated implementation subagent followed by specification-compliance and code-quality review. Keep sequential dependencies on the same branch; parallelize only truly independent tasks whose file ownership does not overlap.

For each task:

1. Confirm all prerequisite issue numbers are closed and the working tree is understood.
2. Read the task and every global contract it consumes.
3. Write and run the specified failing test; confirm the failure is for the intended missing behavior.
4. Implement the minimum scoped change, then run focused and package-level verification.
5. Review for tenant isolation, secret/PII leakage, migration overlap, deferred-scope reintroduction, and API projection drift.
6. Commit only the task's files with the plan's intentional conventional commit.
7. Update the task checkbox and GitHub issue evidence; do not close the milestone until its exit criterion is demonstrated.

Before advancing a milestone, run its complete exit checklist plus `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm check:mobile`, and `pnpm --filter @puckflow/db test:migrations`, adding the milestone-specific browser, failure, load, restore, or EAS checks named in its plan.
