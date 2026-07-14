# PuckFlow Milestone 2 Seasons, Games, RSVP, and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a real team schedule team-owned games, see every roster player's three-state attendance, collect self-responses and manager overrides, and receive reliable material-game and approximately-24-hour RSVP push notifications.

**Architecture:** Zod schemas and pure policies in `@puckflow/core` define season, game, RSVP, notification, and job contracts. Express services perform authorization and Drizzle mutations inside transactions that also enqueue outbox events; a persistent Railway worker dispatches outbox events and delivers durable Postgres jobs through FCM or APNs, while a five-minute Railway cron inserts due reminder jobs idempotently. Next.js and Expo consume the same `@puckflow/api-client` projections but use web-native and mobile-native presentation.

**Tech Stack:** TypeScript strict mode, pnpm workspaces, Turborepo, Zod, Express, Drizzle ORM, PostgreSQL, Vitest, Supertest, Next.js App Router, Expo Router, `expo-notifications@57.0.3`, `expo-haptics@57.0.0`, `@react-native-community/datetimepicker@9.1.0`, `firebase-admin@14.1.0`, `@parse/node-apn@8.1.0`, Sentry, Railway Railpack worker and cron services

## Global Constraints

- Scope is only Milestone 2 from `docs/puckflow-mvp-plan.md`: seasons, team-owned games, opponent snapshots, RSVP, push delivery, and per-team mute.
- Do not add final scores, outcome, decision method, goals, team record, player statistics, score notifications, new email-notification categories, an in-app inbox, badges, digests, or per-category preferences; those are outside Milestone 2. Preserve the Milestone 1 `team.invitation` email-delivery handler without expanding it.
- Games belong to exactly one team and one of that team's seasons; an opponent is a trimmed name snapshot, never a foreign key to another PuckFlow team.
- RSVP has exactly `unknown | going | not_going`; a missing `game_rsvps` row projects as `unknown`.
- A linked user may change only their linked player's RSVP; an owner or manager may change any player RSVP for the team.
- Team members may view seasons, games, and attendance; only owners and managers may create or edit seasons and games.
- All private resources require team membership. Invisible or cross-team resources return 404; visible but unauthorized actions return 403.
- Push categories are exactly `game.scheduled`, `game.changed`, `game.canceled`, and `game.rsvp_reminder`.
- `game.changed` is emitted only when opponent name, scheduled date/time, or venue changes. Cancellation emits `game.canceled`; home/away-only edits emit no push.
- A per-team mute suppresses all four non-critical Milestone 2 push categories for that user. It does not alter game or RSVP data.
- Each current game notification revision has at most one logical RSVP reminder job per linked player. Provider transport remains at-least-once and may address multiple active devices for that user.
- Reminder eligibility is evaluated again immediately before provider delivery: the game is scheduled and future, its revision matches, the player remains linked to the recipient, RSVP is still `unknown`, membership is active, and team push is not muted.
- A material game change increments `notificationRevision`, cancels pending jobs for older revisions, and lets the cron create a uniquely keyed reminder for the current revision. Cancellation prevents reminders.
- Domain writes and their `outbox_events` rows commit in one Postgres transaction. The dispatcher creates uniquely keyed jobs and marks the outbox row dispatched in one transaction.
- The worker claims work with `FOR UPDATE SKIP LOCKED`, uses bounded leases, stores sanitized errors, retries transient failures, revokes invalid tokens, and dead-letters after eight failed attempts with a Sentry alert.
- The Railway cron uses `*/5 * * * *`, acquires a Postgres advisory lock, inserts due jobs idempotently, and exits; it never calls FCM or APNs.
- Store UTC timestamps and render in the viewer's local time zone. Store season boundaries as Postgres `date` values.
- Use UUIDv7 primary keys, checked-in SQL migrations, expand-and-contract compatibility, RFC 9457 Problem Details, request IDs, structured single-line JSON logs, and curated response projections.
- Device tokens, provider credentials, provider payloads, and raw errors never appear in logs, Problem Details, or client projections.
- Use the Node.js, pnpm, TypeScript, Expo, Next.js, Express, Drizzle, Zod, Vitest, and Sentry versions already pinned by Milestone 0. Add only the provider libraries named in Task 5 and Expo Notifications in Task 8.
- Every task starts with a failing test, ends with focused and package-level verification, and is committed independently with the exact conventional commit shown.

---

## Exact file map

### Shared domain and API contracts

- Create `packages/core/src/games/season.ts`: season input, patch, list-query, and projection schemas.
- Create `packages/core/src/games/game.ts`: game input, patch, list-query, projection schemas, material-change classification, and revision rules.
- Create `packages/core/src/games/rsvp.ts`: RSVP input, attendance-row projection, and self/override policy.
- Create `packages/core/src/notifications/push.ts`: push category, preference, device-token, outbox payload, durable job payload, deterministic key, copy, and retry contracts.
- Create `packages/core/src/games/season.test.ts`, `game.test.ts`, and `rsvp.test.ts`: pure domain tests.
- Create `packages/core/src/notifications/push.test.ts`: targeting, key, retry, and redaction tests.
- Modify `packages/core/src/events/events.ts`: extend the existing Milestone 1 `team.invitation` event union with the four Milestone 2 game events.
- Modify `packages/core/src/index.ts`: export all Milestone 2 contracts.

### Database

- Create `packages/db/src/schema/seasons.ts`: `seasons` table and indexes.
- Create `packages/db/src/schema/games.ts`: team-owned `games` table and material-notification revision.
- Create `packages/db/src/schema/game-rsvps.ts`: lazy three-state responses.
- Create `packages/db/src/schema/team-notification-preferences.ts`: absent-is-unmuted per-team preference.
- Create `packages/db/src/schema/device-tokens.ts`: private FCM/APNs token registration and revocation.
- Create `packages/db/src/schema/push-job-targets.ts`: per-device provider delivery diagnostics for a user-level job.
- Modify `packages/db/src/schema/index.ts`: export relations and schema objects.
- Create `packages/db/drizzle/0002_games_rsvp_notifications.sql`: expand-only DDL and constraints.
- Create `packages/db/src/repositories/seasons.ts`: team-scoped season persistence.
- Create `packages/db/src/repositories/games.ts`: team-scoped game reads, writes, and row locking.
- Create `packages/db/src/repositories/rsvps.ts`: attendance projection, RSVP upsert, and reminder eligibility.
- Create `packages/db/src/repositories/notification-preferences.ts`: mute reads/writes.
- Create `packages/db/src/repositories/device-tokens.ts`: token registration, listing, and revocation.
- Create `packages/db/src/repositories/notification-jobs.ts`: outbox dispatch, reminder insertion, job claims, target state, retry, completion, and dead-letter operations.
- Create `packages/db/src/repositories/seasons.test.ts`, `games.test.ts`, `rsvps.test.ts`, and `notification-jobs.test.ts`: Postgres integration tests.
- Modify `packages/db/src/index.ts`: export the repositories and transaction types.

### API

- Create `apps/api/src/services/games-service.ts`: season/game authorization and transactional orchestration.
- Create `apps/api/src/services/rsvp-service.ts`: self-response and manager override orchestration.
- Create `apps/api/src/services/notification-settings-service.ts`: mute and token orchestration.
- Create `apps/api/src/routes/seasons.ts`: team season collection and season patch routes.
- Create `apps/api/src/routes/games.ts`: season game collection, detail, and patch routes.
- Create `apps/api/src/routes/rsvps.ts`: attendance list and RSVP mutation routes.
- Create `apps/api/src/routes/notification-settings.ts`: team mute and current-user device-token routes.
- Create `apps/api/src/routes/seasons.test.ts`, `games.test.ts`, `rsvps.test.ts`, and `notification-settings.test.ts`: Supertest integration tests.
- Modify `apps/api/src/app.ts`: mount authenticated Milestone 2 routers.

### Worker and cron

- Create `apps/worker/src/notifications/providers.ts`: provider-neutral push interface and error taxonomy.
- Create `apps/worker/src/notifications/fcm.ts`: Firebase Admin adapter.
- Create `apps/worker/src/notifications/apns.ts`: APNs adapter.
- Create `apps/worker/src/notifications/dispatcher.ts`: outbox-to-job fan-out.
- Create `apps/worker/src/notifications/processor.ts`: eligibility recheck, per-token delivery, retry, revocation, completion, and dead-letter logic.
- Create `apps/worker/src/notifications/*.test.ts`: provider, dispatch, retry, and idempotency tests.
- Modify `apps/worker/src/runner.ts`: run bounded dispatch/process loops and graceful shutdown.
- Modify `apps/worker/src/config.ts`: validate FCM/APNs and worker tuning variables without logging secrets.
- Modify `apps/worker/src/server.ts`: start the runner from the Milestone 0 Railpack entry point.
- Modify `apps/worker/package.json`: add Firebase Admin and APNs provider dependencies and scripts.
- Create `apps/cron/src/rsvp-reminders.ts`: one advisory-locked sweep.
- Create `apps/cron/src/rsvp-reminders.test.ts`: due-window, idempotency, replacement, and exclusion tests.
- Modify `apps/cron/src/sweep.ts`: invoke the RSVP reminder sweep from the Milestone 0 sweep composition.
- Modify `apps/cron/src/config.ts`: validate reminder and provider-neutral cron configuration.
- Modify `apps/cron/src/main.ts`: run one composed sweep and exit non-zero on failure.
- Modify `apps/cron/package.json`: add focused test and start scripts if the M0 package lacks them.
- Modify `apps/cron/railway.toml`: configure the five-minute schedule and one-shot start command.

### Shared client, web, and mobile

- Create `packages/api-client/src/seasons.ts`, `games.ts`, `rsvps.ts`, and `notifications.ts`: typed authenticated client methods.
- Modify `packages/api-client/src/index.ts`: compose these methods into `createApiClient`.
- Create `packages/api-client/src/*.test.ts`: transport method/path/body/response tests.
- Create `apps/web/app/teams/[teamId]/games/page.tsx`: season selector and responsive game list.
- Create `apps/web/app/teams/[teamId]/games/new/page.tsx`: manager game creation.
- Create `apps/web/app/teams/[teamId]/games/[gameId]/page.tsx`: game detail and attendance view.
- Create `apps/web/app/teams/[teamId]/games/[gameId]/edit/page.tsx`: manager edit/cancel flow.
- Create `apps/web/app/teams/[teamId]/seasons/page.tsx`: manager season management.
- Create `apps/web/app/teams/[teamId]/settings/notifications/page.tsx`: per-team push mute.
- Create `apps/web/src/features/games/game-form.tsx`, `attendance-list.tsx`, and `rsvp-control.tsx`: reusable accessible web UI.
- Create `apps/web/src/features/games/*.test.tsx` and `apps/web/tests/games-rsvp.spec.ts`: component and Playwright coverage.
- Create `apps/mobile/app/(app)/teams/[teamId]/games/index.tsx`: virtualized game list.
- Create `apps/mobile/app/(app)/teams/[teamId]/games/new.tsx`: manager game creation.
- Create `apps/mobile/app/(app)/teams/[teamId]/games/[gameId]/index.tsx`: native game detail and attendance.
- Create `apps/mobile/app/(app)/teams/[teamId]/games/[gameId]/edit.tsx`: manager edit/cancel flow.
- Create `apps/mobile/app/(app)/teams/[teamId]/seasons.tsx`: season management.
- Create `apps/mobile/app/(app)/teams/[teamId]/notification-settings.tsx`: per-team mute and notification permission status.
- Create `apps/mobile/src/features/games/game-form.tsx`, `attendance-list.tsx`, and `rsvp-control.tsx`: native UI.
- Create `apps/mobile/src/notifications/register-device.ts`: native token registration and revocation.
- Create `apps/mobile/src/notifications/handle-notification.ts`: deep-link handling for all four categories.
- Create `apps/mobile/src/features/games/*.test.tsx` and `apps/mobile/src/notifications/*.test.ts`: component and notification tests.
- Modify `apps/mobile/app.config.ts`: enable Expo Notifications using the existing iOS bundle ID and Android package.
- Modify `apps/mobile/package.json`: add the Expo-SDK-compatible `expo-notifications` dependency.

### Operations and end-to-end verification

- Create `apps/api/src/integration/games-rsvp-notifications.test.ts`: cross-service transaction and replacement scenarios.
- Create `docs/operations/notifications.md`: topology, variables, provider setup, retry/dead-letter diagnosis, token privacy, and smoke-test runbook.
- Modify the M0 CI workflow under `.github/workflows/ci.yml`: include worker, cron, migration, API integration, web, and mobile gates for changed packages.

## Exact Milestone 0 and Milestone 1 interfaces consumed

Implementation begins only after these interfaces exist with these names and shapes. M2 consumes them; it does not create parallel substitutes.

```ts
// @puckflow/core
export type TeamRole = 'owner' | 'manager' | 'member';
export type RequestContext = { requestId: string; actorUserId: string };
export type TeamScope = {
  teamId: string;
  actorUserId: string;
  membershipId: string;
  role: TeamRole;
  requestId: string;
};
export const UuidSchema: z.ZodString;
export const ProblemCodeSchema: z.ZodEnum<[
  'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED',
  'CONFLICT', 'OWNER_REQUIRED', 'PLAYER_LINK_CONFLICT',
  'GOAL_DETAIL_EXCEEDS_FINAL_SCORE', 'RATE_LIMITED', 'INTERNAL'
]>;
```

```ts
// @puckflow/api
export function getRequestContext(req: express.Request): RequestContext;
export function getTeamScope(req: express.Request): TeamScope;
export function requireTeamRole(minimum: 'member' | 'manager' | 'owner'): express.RequestHandler;
export class ProblemError extends Error {
  constructor(input: {
    status: number;
    code: z.infer<typeof ProblemCodeSchema>;
    title: string;
    detail: string;
    errors?: Array<{ path: string; message: string }>;
    cause?: unknown;
  });
}
```

`requireTeamRole('member')` verifies Clerk authentication, resolves active membership from the `:teamId` parameter or the addressed resource, and stores `TeamScope`. It returns 404 for an invisible resource and 403 when the team is visible but the minimum role is not met.

```ts
// @puckflow/db
export type Database = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export function createDatabase(url: string): Database;
export function closeDatabase(database: Database): Promise<void>;
export function enqueueOutbox(
  tx: DbTransaction,
  event: {
    id: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    teamId: string | null;
    actorUserId: string | null;
    payload: Record<string, unknown>;
    requestId: string;
    occurredAt: Date;
  },
): Promise<void>;
```

The M0 operational tables already have these columns and semantics:

```ts
type OutboxEventRow = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  teamId: string | null;
  actorUserId: string | null;
  payload: unknown;
  requestId: string;
  occurredAt: Date;
  dispatchedAt: Date | null;
};

type JobRow = {
  id: string;
  category: string;
  deterministicKey: string;
  payload: unknown;
  dueAt: Date;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  status: 'pending' | 'claimed' | 'completed' | 'canceled' | 'dead_letter';
  claimedAt: Date | null;
  claimedBy: string | null;
  completedAt: Date | null;
  deadLetteredAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

`jobs.deterministic_key` is globally unique. M2 adds indexes and repository behavior, not a second queue table.

```ts
// @puckflow/db Milestone 1 repositories
export type PlayerRecord = {
  id: string;
  teamId: string;
  linkedUserId: string | null;
  displayName: string;
  jerseyNumber: string | null;
  position: string | null;
  status: 'active' | 'inactive';
};

export interface PlayersRepository {
  getById(scope: TeamScope, playerId: string, tx?: DbTransaction): Promise<PlayerRecord | null>;
  listForTeam(scope: TeamScope, tx?: DbTransaction): Promise<PlayerRecord[]>;
}

export interface TeamsRepository {
  listActiveUserIds(teamId: string, tx?: DbTransaction): Promise<string[]>;
  hasActiveMembership(teamId: string, userId: string, tx?: DbTransaction): Promise<boolean>;
}
```

```ts
// @puckflow/api-client and client shells
export function createApiClient(options: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  getRequestId?: () => string;
}): ApiClient;
```

Authenticated web/mobile layouts, team switching, design tokens, error rendering, query invalidation, and test harnesses exist. M2 links to `/teams/:teamId/games/:gameId` within those shells.

## Interfaces produced for Milestone 3

```ts
export type GameRecord = {
  id: string;
  teamId: string;
  seasonId: string;
  opponentName: string;
  scheduledAt: Date;
  venue: string | null;
  homeAway: 'home' | 'away';
  status: 'scheduled' | 'canceled';
  notificationRevision: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface GamesRepository {
  getById(scope: TeamScope, gameId: string, tx?: DbTransaction): Promise<GameRecord | null>;
  getByIdForUpdate(tx: DbTransaction, scope: TeamScope, gameId: string): Promise<GameRecord | null>;
}
```

Milestone 3 may expand `GameRecord.status` to include `final` and add nullable result columns. It must retain the existing IDs, team/season ownership, opponent snapshot, schedule fields, and repository signatures.

---

### Task 1: Define season, game, RSVP, and notification contracts

**Files:**
- Create: `packages/core/src/games/season.ts`
- Create: `packages/core/src/games/game.ts`
- Create: `packages/core/src/games/rsvp.ts`
- Create: `packages/core/src/notifications/push.ts`
- Create: `packages/core/src/games/season.test.ts`
- Create: `packages/core/src/games/game.test.ts`
- Create: `packages/core/src/games/rsvp.test.ts`
- Create: `packages/core/src/notifications/push.test.ts`
- Modify: `packages/core/src/events/events.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `UuidSchema`, `TeamRole`, and the existing typed domain-event union.
- Produces: all request/response schemas, `classifyGameMutation`, `canChangeRsvp`, `buildPushCopy`, `pushJobKey`, `reminderJobKey`, `retryDueAt`, `GameDomainEvent`, and inferred TypeScript types used by Tasks 2-9.

- [ ] **Step 1: Write failing season and game schema tests**

```ts
import { describe, expect, it } from 'vitest';
import { SeasonCreateInputSchema } from './season';
import { GameCreateInputSchema, classifyGameMutation } from './game';

describe('season and game contracts', () => {
  it('rejects a season ending before it starts', () => {
    expect(SeasonCreateInputSchema.safeParse({
      name: 'Winter 2027', startDate: '2027-03-01', endDate: '2027-01-01', status: 'planned',
    }).success).toBe(false);
  });

  it('trims and accepts an opponent snapshot', () => {
    expect(GameCreateInputSchema.parse({
      opponentName: '  Ice Owls  ', scheduledAt: '2027-01-08T01:30:00.000Z', venue: 'Rink 2', homeAway: 'home',
    }).opponentName).toBe('Ice Owls');
  });

  it('classifies only notification-material changes', () => {
    const before = { opponentName: 'Owls', scheduledAt: '2027-01-08T01:30:00.000Z', venue: 'Rink 2', homeAway: 'home' as const, status: 'scheduled' as const };
    expect(classifyGameMutation(before, { ...before, homeAway: 'away' })).toBeNull();
    expect(classifyGameMutation(before, { ...before, venue: 'Rink 3' })).toBe('game.changed');
    expect(classifyGameMutation(before, { ...before, status: 'canceled' })).toBe('game.canceled');
  });
});
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run: `pnpm --filter @puckflow/core test -- src/games/season.test.ts src/games/game.test.ts`

Expected: FAIL with module-resolution errors for `./season` and `./game`.

- [ ] **Step 3: Implement the exact season and game contracts**

```ts
// packages/core/src/games/season.ts
import { z } from 'zod';
import { UuidSchema } from '../ids';

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const SeasonStatusSchema = z.enum(['planned', 'active', 'completed']);
const SeasonInputFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  status: SeasonStatusSchema,
});
const validateSeasonDates = (value: { startDate?: string; endDate?: string }, ctx: z.RefinementCtx) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after start date.' });
};
export const SeasonCreateInputSchema = SeasonInputFieldsSchema.superRefine(validateSeasonDates);
export const SeasonPatchInputSchema = SeasonInputFieldsSchema.partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required.')
  .superRefine(validateSeasonDates);
export const SeasonSchema = SeasonCreateInputSchema.extend({
  id: UuidSchema, teamId: UuidSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
```

```ts
// packages/core/src/games/game.ts
import { z } from 'zod';
import { UuidSchema } from '../ids';

export const GameStatusSchema = z.enum(['scheduled', 'canceled']);
export const HomeAwaySchema = z.enum(['home', 'away']);
export const GameCreateInputSchema = z.object({
  opponentName: z.string().trim().min(1).max(120),
  scheduledAt: z.string().datetime({ offset: true }),
  venue: z.string().trim().min(1).max(160).nullable(),
  homeAway: HomeAwaySchema,
});
export const GamePatchInputSchema = GameCreateInputSchema.partial().extend({ status: GameStatusSchema.optional() })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required.');
export const GameSchema = GameCreateInputSchema.extend({
  id: UuidSchema, teamId: UuidSchema, seasonId: UuidSchema, status: GameStatusSchema,
  notificationRevision: z.number().int().positive(), createdByUserId: UuidSchema,
  updatedByUserId: UuidSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
type MaterialGame = Pick<z.infer<typeof GameSchema>, 'opponentName' | 'scheduledAt' | 'venue' | 'homeAway' | 'status'>;
export function classifyGameMutation(before: MaterialGame, after: MaterialGame): 'game.changed' | 'game.canceled' | null {
  if (before.status !== 'canceled' && after.status === 'canceled') return 'game.canceled';
  if (before.opponentName !== after.opponentName || before.scheduledAt !== after.scheduledAt || before.venue !== after.venue) return 'game.changed';
  return null;
}
```

- [ ] **Step 4: Write failing RSVP policy tests**

```ts
import { expect, it } from 'vitest';
import { canChangeRsvp, RsvpInputSchema } from './rsvp';

it.each(['unknown', 'going', 'not_going'])('accepts %s', (status) => {
  expect(RsvpInputSchema.parse({ status }).status).toBe(status);
});
it('allows a member only for their linked player', () => {
  expect(canChangeRsvp('member', 'user-a', 'user-a')).toBe(true);
  expect(canChangeRsvp('member', 'user-a', 'user-b')).toBe(false);
  expect(canChangeRsvp('manager', 'user-a', 'user-b')).toBe(true);
});
```

- [ ] **Step 5: Implement RSVP and attendance projections**

```ts
import { z } from 'zod';
import { UuidSchema } from '../ids';
import type { TeamRole } from '../teams/roles';

export const RsvpStatusSchema = z.enum(['unknown', 'going', 'not_going']);
export const RsvpInputSchema = z.object({ status: RsvpStatusSchema });
export const AttendanceRowSchema = z.object({
  playerId: UuidSchema, displayName: z.string(), jerseyNumber: z.string().nullable(),
  playerStatus: z.enum(['active', 'inactive']), linkedUserId: UuidSchema.nullable(),
  status: RsvpStatusSchema, respondedByUserId: UuidSchema.nullable(), respondedAt: z.string().datetime().nullable(),
});
export function canChangeRsvp(role: TeamRole, actorUserId: string, linkedUserId: string | null): boolean {
  return role === 'owner' || role === 'manager' || linkedUserId === actorUserId;
}
```

- [ ] **Step 6: Write and implement notification key, copy, event, and retry tests**

Test exact keys and delays: outbox job `push:<eventId>:<userId>`, reminder job `push:game.rsvp_reminder:<gameId>:r<revision>:<playerId>`, and retry delays after failures 1-7 of 30 seconds, 2 minutes, 10 minutes, 30 minutes, 2 hours, 6 hours, and 12 hours. Implement `PushCategorySchema`, `TeamNotificationPreferenceSchema`, `RegisterDeviceTokenInputSchema`, a discriminated `GameDomainEventSchema`, `PushJobPayloadSchema`, `buildPushCopy`, `pushJobKey`, `reminderJobKey`, and `retryDueAt`. Titles are exactly `New game scheduled`, `Game updated`, `Game canceled`, and `RSVP needed`; bodies name the opponent but never include a token or email.

Run: `pnpm --filter @puckflow/core test -- src/games src/notifications`

Expected: PASS; the test report includes season date validation, material-change classification, all three RSVP states, role behavior, all four push categories, deterministic keys, and seven retry intervals.

- [ ] **Step 7: Export contracts and commit**

```bash
git add packages/core/src/games packages/core/src/notifications packages/core/src/events/events.ts packages/core/src/index.ts
git commit -m "feat(core): define games RSVP and push contracts"
```

---

### Task 2: Persist seasons, games, RSVP, preferences, tokens, and durable jobs

**Files:**
- Create: all database files listed under **Database** in the exact file map.
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: Task 1 schemas, injected M0 `Database`, `DbTransaction`, `enqueueOutbox`, `outbox_events`, and `jobs`; M1 `players`, `team_memberships`, and team-scoped repository rules.
- Produces: `SeasonsRepository`, `GamesRepository`, `RsvpsRepository`, `NotificationPreferencesRepository`, `DeviceTokensRepository`, and `NotificationJobsRepository` used by Tasks 3-6.

- [ ] **Step 1: Write failing Postgres repository tests**

Create fixtures for two teams, one manager, one member linked to an active player, one unlinked player, and one inactive player with an existing RSVP. Assert: a season cannot reference another team; a game cannot use another team's season; opponent text remains a snapshot after any unrelated team rename; missing RSVP projects `unknown`; linked member/manager writes persist responder identity; the inactive referenced player remains in attendance; absent preference is unmuted; duplicate reminder keys create one job; concurrent claimers receive disjoint jobs.

Run: `docker compose up -d postgres`

Expected: the `postgres` container reports healthy.

Run: `pnpm --filter @puckflow/db test:integration -- src/repositories/seasons.test.ts src/repositories/games.test.ts src/repositories/rsvps.test.ts src/repositories/notification-jobs.test.ts`

Expected: FAIL because migration `0002_games_rsvp_notifications.sql` and the repositories do not exist.

- [ ] **Step 2: Add the expand-only migration and Drizzle schema**

The SQL must create the following exact constraints and indexes:

```sql
CREATE TABLE seasons (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  name varchar(80) NOT NULL CHECK (btrim(name) <> ''),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('planned','active','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  UNIQUE (id, team_id)
);
CREATE INDEX seasons_team_dates_idx ON seasons(team_id, start_date DESC, id DESC);

CREATE TABLE games (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  season_id uuid NOT NULL,
  opponent_name varchar(120) NOT NULL CHECK (btrim(opponent_name) <> ''),
  scheduled_at timestamptz NOT NULL,
  venue varchar(160),
  home_away text NOT NULL CHECK (home_away IN ('home','away')),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','canceled')),
  notification_revision integer NOT NULL DEFAULT 1 CHECK (notification_revision > 0),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, team_id),
  FOREIGN KEY (season_id, team_id) REFERENCES seasons(id, team_id)
);
CREATE INDEX games_season_schedule_idx ON games(season_id, scheduled_at, id);
CREATE INDEX games_due_reminder_idx ON games((scheduled_at - interval '24 hours'), id) WHERE status = 'scheduled';

CREATE TABLE game_rsvps (
  team_id uuid NOT NULL,
  game_id uuid NOT NULL,
  player_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('unknown','going','not_going')),
  responded_by_user_id uuid NOT NULL REFERENCES users(id),
  responded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, player_id),
  FOREIGN KEY (game_id, team_id) REFERENCES games(id, team_id),
  FOREIGN KEY (player_id, team_id) REFERENCES players(id, team_id)
);
CREATE INDEX game_rsvps_player_idx ON game_rsvps(player_id, game_id);

CREATE TABLE team_notification_preferences (
  team_id uuid NOT NULL REFERENCES teams(id),
  user_id uuid NOT NULL REFERENCES users(id),
  push_muted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE device_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  platform text NOT NULL CHECK (platform IN ('ios','android')),
  provider text NOT NULL CHECK (provider IN ('apns','fcm')),
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  token text NOT NULL,
  token_hash char(64) NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, token_hash)
);
CREATE INDEX device_tokens_user_active_idx ON device_tokens(user_id, id) WHERE revoked_at IS NULL;

CREATE TABLE push_job_targets (
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  device_token_id uuid NOT NULL REFERENCES device_tokens(id),
  status text NOT NULL CHECK (status IN ('pending','sent','suppressed','permanent_failure')),
  provider_message_id varchar(255),
  sanitized_error varchar(160),
  attempted_at timestamptz,
  PRIMARY KEY (job_id, device_token_id)
);
CREATE INDEX jobs_due_claim_idx ON jobs(due_at, id) WHERE status = 'pending';
CREATE INDEX outbox_undispatched_idx ON outbox_events(occurred_at, id) WHERE dispatched_at IS NULL;
```

Before creating `game_rsvps`, add `UNIQUE (id, team_id)` to the M1 `players` table if M1 did not already create that composite key. The two composite foreign keys then guarantee that RSVP game and player belong to the same team; repository integration tests exercise the cross-team rejection. Drizzle definitions mirror the SQL without weakening checks.

- [ ] **Step 3: Implement exact repository interfaces**

```ts
export interface SeasonsRepository {
  list(scope: TeamScope): Promise<SeasonRecord[]>;
  getById(scope: TeamScope, seasonId: string, tx?: DbTransaction): Promise<SeasonRecord | null>;
  create(tx: DbTransaction, scope: TeamScope, id: string, input: SeasonCreateInput): Promise<SeasonRecord>;
  patch(tx: DbTransaction, scope: TeamScope, seasonId: string, input: SeasonPatchInput): Promise<SeasonRecord | null>;
}

export interface GamesRepository {
  listBySeason(scope: TeamScope, seasonId: string, input: { cursor?: string; limit: number }): Promise<{ items: GameRecord[]; nextCursor: string | null }>;
  getById(scope: TeamScope, gameId: string, tx?: DbTransaction): Promise<GameRecord | null>;
  getByIdForUpdate(tx: DbTransaction, scope: TeamScope, gameId: string): Promise<GameRecord | null>;
  create(tx: DbTransaction, scope: TeamScope, id: string, seasonId: string, input: GameCreateInput): Promise<GameRecord>;
  patch(tx: DbTransaction, scope: TeamScope, gameId: string, input: GamePatchInput & { notificationRevision: number }): Promise<GameRecord>;
}

export interface RsvpsRepository {
  listAttendance(scope: TeamScope, gameId: string): Promise<AttendanceRow[]>;
  upsert(tx: DbTransaction, scope: TeamScope, gameId: string, playerId: string, status: RsvpStatus, responderUserId: string): Promise<AttendanceRow>;
  isUnknownAndLinked(gameId: string, playerId: string, userId: string, tx?: DbTransaction): Promise<boolean>;
}
```

Attendance is the union of active roster players and players already referenced by an RSVP for the game. `LEFT JOIN game_rsvps` and `COALESCE(game_rsvps.status, 'unknown')` produce lazy unknown rows; it never inserts rows during a GET.

- [ ] **Step 4: Implement preference, token, outbox, and job repositories**

```ts
export interface NotificationJobsRepository {
  dispatchOutboxBatch(limit: number): Promise<number>;
  enqueueReminder(input: PushJobInsert): Promise<'inserted' | 'already_exists' | 'reactivated'>;
  cancelPendingForGameRevision(tx: DbTransaction, gameId: string, olderThanRevision: number): Promise<number>;
  claimDue(input: { workerId: string; limit: number; leaseNow: Date }): Promise<JobRow[]>;
  ensureTargets(jobId: string, recipientUserId: string): Promise<PushJobTarget[]>;
  markTargetSent(jobId: string, tokenId: string, providerMessageId: string): Promise<void>;
  markTargetSuppressed(jobId: string, tokenId: string, reason: string): Promise<void>;
  markTargetPermanentFailure(jobId: string, tokenId: string, reason: string): Promise<void>;
  cancelPendingReminder(tx: DbTransaction, gameId: string, revision: number, playerId: string): Promise<number>;
  completeSuppressed(jobId: string, reason: string): Promise<void>;
  finishOrRetry(jobId: string, now: Date): Promise<void>;
  retry(jobId: string, dueAt: Date, sanitizedError: string): Promise<void>;
  complete(jobId: string): Promise<void>;
  deadLetter(jobId: string, sanitizedError: string): Promise<void>;
  releaseExpiredClaims(now: Date, olderThan: Date): Promise<number>;
}

export interface NotificationPreferencesRepository {
  get(teamId: string, userId: string, tx?: DbTransaction): Promise<{ pushMuted: boolean }>;
  set(tx: DbTransaction, teamId: string, userId: string, pushMuted: boolean): Promise<{ pushMuted: boolean; updatedAt: Date }>;
}

export interface DeviceTokensRepository {
  register(tx: DbTransaction, userId: string, input: RegisterDeviceTokenInput & { id: string; tokenHash: string; seenAt: Date }): Promise<DeviceTokenProjection>;
  listActiveForUser(userId: string, tx?: DbTransaction): Promise<DeviceTokenPrivateRecord[]>;
  revokeForUser(tx: DbTransaction, userId: string, tokenId: string, revokedAt: Date): Promise<boolean>;
  revokeInvalid(tx: DbTransaction, tokenId: string, revokedAt: Date): Promise<void>;
}

export interface ReminderCandidatesRepository {
  tryAdvisoryLock(tx: DbTransaction, key: number): Promise<boolean>;
  listDue(tx: DbTransaction, now: Date, limit: number): Promise<ReminderCandidate[]>;
}
```

`dispatchOutboxBatch` locks undispatched rows, validates the Task 1 event union, selects active team members other than `actorUserId`, inserts one user-level job per `(event,user)` using `push:<eventId>:<userId>`, and marks the outbox row dispatched in the same transaction. It does not read device tokens; token targets are snapshotted on the job's first processing attempt. Invalid payloads become dead-letter jobs with only `INVALID_EVENT_PAYLOAD` stored.

- [ ] **Step 5: Run migration and repository suites**

Run: `pnpm --filter @puckflow/db test:migrations`

Expected: PASS applying all migrations to an empty database and `0002` to the representative Milestone 1 fixture; the old M1 application can still read teams and players.

Run: `pnpm --filter @puckflow/db test:integration -- src/repositories`

Expected: PASS, including cross-team constraints, lazy unknown projection, inactive historical RSVP display, idempotent insert/reactivation, and disjoint concurrent claims.

- [ ] **Step 6: Commit persistence**

```bash
git add packages/db/src packages/db/package.json
git commit -m "feat(db): persist games RSVP and notification jobs"
```

---

### Task 3: Add season and game REST APIs with transactional push events

**Files:**
- Create: `apps/api/src/services/games-service.ts`
- Create: `apps/api/src/routes/seasons.ts`
- Create: `apps/api/src/routes/games.ts`
- Create: `apps/api/src/routes/seasons.test.ts`
- Create: `apps/api/src/routes/games.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: Tasks 1-2 season/game schemas and repositories; M0 `ProblemError`, `getTeamScope`, `requireTeamRole`, injected `Database.transaction`, and `enqueueOutbox`.
- Produces: `GET/POST /v1/teams/:teamId/seasons`, `PATCH /v1/seasons/:seasonId`, `GET/POST /v1/seasons/:seasonId/games`, `GET/PATCH /v1/games/:gameId`, and `GamesService` for client work.

- [ ] **Step 1: Write failing route integration tests**

Test exact outcomes: member GET is 200; member POST/PATCH is 403; nonmember and cross-team resource access is 404; invalid season dates and empty opponent return RFC 9457 `VALIDATION_FAILED`; create returns 201 and one `game.scheduled` outbox row; a home/away-only patch returns 200 without an outbox row or revision increment; opponent/time/venue changes return 200, increment once, enqueue `game.changed`, and cancel old pending reminders in the same transaction; cancellation enqueues `game.canceled`; a forced outbox insert error rolls back the game write.

Run: `pnpm --filter @puckflow/api test:integration -- src/routes/seasons.test.ts src/routes/games.test.ts`

Expected: FAIL because the routes are not mounted.

- [ ] **Step 2: Implement the transactional service**

```ts
export class GamesService {
  async createGame(scope: TeamScope, seasonId: string, input: GameCreateInput): Promise<GameRecord> {
    if (scope.role === 'member') throw new ProblemError({ status: 403, code: 'FORBIDDEN', title: 'Forbidden', detail: 'Manager access is required.' });
    return this.db.transaction(async (tx) => {
      const season = await seasonsRepository.getById(scope, seasonId, tx);
      if (!season) throw new ProblemError({ status: 404, code: 'NOT_FOUND', title: 'Not Found', detail: 'Season not found.' });
      const game = await gamesRepository.create(tx, scope, uuidv7(), seasonId, input);
      await enqueueOutbox(tx, gameScheduledEvent(game, scope));
      return game;
    });
  }

  async patchGame(scope: TeamScope, gameId: string, input: GamePatchInput): Promise<GameRecord> {
    if (scope.role === 'member') throw new ProblemError({ status: 403, code: 'FORBIDDEN', title: 'Forbidden', detail: 'Manager access is required.' });
    return this.db.transaction(async (tx) => {
      const before = await gamesRepository.getByIdForUpdate(tx, scope, gameId);
      if (!before) throw new ProblemError({ status: 404, code: 'NOT_FOUND', title: 'Not Found', detail: 'Game not found.' });
      if (before.status === 'canceled' && input.status === 'scheduled') throw new ProblemError({ status: 409, code: 'CONFLICT', title: 'Conflict', detail: 'A canceled game cannot be reopened.' });
      const candidate = { ...before, ...input };
      const eventType = classifyGameMutation(serializeGame(before), serializeGame(candidate));
      const revision = before.notificationRevision + Number(eventType !== null);
      const after = await gamesRepository.patch(tx, scope, gameId, { ...input, notificationRevision: revision });
      if (eventType) {
        await notificationJobsRepository.cancelPendingForGameRevision(tx, gameId, revision);
        await enqueueOutbox(tx, gameMutationEvent(eventType, before, after, scope));
      }
      return after;
    });
  }
}
```

Season create/patch follows the same role and team-scope rules but emits no M2 notification event.

- [ ] **Step 3: Mount exact REST routes and projections**

Use `requireTeamRole('member')` for reads and `requireTeamRole('manager')` for season/game mutations. Validate params, queries, and bodies with Task 1 Zod schemas. List games default to `limit=30`, cap at `100`, sort by `(scheduledAt,id)` ascending, and use an opaque base64url cursor containing both fields. Mutations return the full `SeasonSchema` or `GameSchema` projection needed by the clients.

- [ ] **Step 4: Verify routes and rollback behavior**

Run: `pnpm --filter @puckflow/api test:integration -- src/routes/seasons.test.ts src/routes/games.test.ts`

Expected: PASS with all success, authorization, materiality, Problem Details, revision, cancellation, and rollback assertions.

Run: `pnpm --filter @puckflow/api typecheck`

Expected: PASS with no unchecked route body or response values.

- [ ] **Step 5: Commit the season/game API**

```bash
git add apps/api/src/services/games-service.ts apps/api/src/routes/seasons.ts apps/api/src/routes/games.ts apps/api/src/routes/seasons.test.ts apps/api/src/routes/games.test.ts apps/api/src/app.ts
git commit -m "feat(api): add season and game scheduling endpoints"
```

---

### Task 4: Add attendance, RSVP, mute, and device-token REST APIs

**Files:**
- Create: `apps/api/src/services/rsvp-service.ts`
- Create: `apps/api/src/services/notification-settings-service.ts`
- Create: `apps/api/src/routes/rsvps.ts`
- Create: `apps/api/src/routes/notification-settings.ts`
- Create: `apps/api/src/routes/rsvps.test.ts`
- Create: `apps/api/src/routes/notification-settings.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: Task 1 RSVP/preference/token schemas; Task 2 repositories; M1 player links and role scope.
- Produces: `GET /v1/games/:gameId/rsvps`, `PUT /v1/games/:gameId/rsvps/:playerId`, `GET/PUT /v1/teams/:teamId/notification-preferences`, `POST /v1/me/device-tokens`, and `DELETE /v1/me/device-tokens/:tokenId`.

- [ ] **Step 1: Write failing RSVP route tests**

Assert that a GET returns every active player as `unknown` without inserting RSVP rows, retains an inactive player with an existing row, lets a linked member set their own `going`, rejects their write to another player with 403, lets managers set any of the three statuses, records the actual responder, returns 404 for another team's game/player, and cancels a queued reminder when status becomes non-unknown. Setting the row back to `unknown` allows the cron to reactivate the never-delivered deterministic job.

Run: `pnpm --filter @puckflow/api test:integration -- src/routes/rsvps.test.ts`

Expected: FAIL because `/v1/games/:gameId/rsvps` is absent.

- [ ] **Step 2: Implement self-response and override orchestration**

```ts
export class RsvpService {
  async set(scope: TeamScope, gameId: string, playerId: string, input: RsvpInput): Promise<AttendanceRow> {
    return this.db.transaction(async (tx) => {
      const game = await gamesRepository.getByIdForUpdate(tx, scope, gameId);
      if (!game) throw new ProblemError({ status: 404, code: 'NOT_FOUND', title: 'Not Found', detail: 'Game not found.' });
      const player = await playersRepository.getById(scope, playerId, tx);
      if (!player || player.teamId !== game.teamId) throw new ProblemError({ status: 404, code: 'NOT_FOUND', title: 'Not Found', detail: 'Player not found.' });
      if (!canChangeRsvp(scope.role, scope.actorUserId, player.linkedUserId)) {
        throw new ProblemError({ status: 403, code: 'FORBIDDEN', title: 'Forbidden', detail: 'You may change only your linked player response.' });
      }
      const row = await rsvpsRepository.upsert(tx, scope, gameId, playerId, input.status, scope.actorUserId);
      if (input.status !== 'unknown') await notificationJobsRepository.cancelPendingReminder(tx, gameId, game.notificationRevision, playerId);
      return row;
    });
  }
}
```

`cancelPendingReminder` sets only never-completed matching reminder jobs to `canceled`.

- [ ] **Step 3: Write failing preference and token tests**

Assert absent preference returns `{ pushMuted: false }`; a member can mute only themselves for a team they belong to; manager cannot mutate another user's preference; registering hashes the token, never echoes raw token, moves the same provider token to the current authenticated user, revives a revoked token, scopes DELETE to the current user, and returns 404 rather than disclosing another user's token ID.

Run: `pnpm --filter @puckflow/api test:integration -- src/routes/notification-settings.test.ts`

Expected: FAIL because the routes are absent.

- [ ] **Step 4: Implement preference and token routes**

`GET/PUT /v1/teams/:teamId/notification-preferences` use authenticated `scope.actorUserId`; the PUT body is exactly `{ pushMuted: boolean }`. `POST /v1/me/device-tokens` accepts `{ platform, provider, environment, token }`, enforces `ios -> apns` and `android -> fcm`, accepts a 32-4096 character token, stores `sha256(token)` for uniqueness, and returns 201 with `{ id, platform, provider, environment, lastSeenAt }`. DELETE sets `revokedAt` and returns 204. Never serialize `token` or `tokenHash`.

- [ ] **Step 5: Run API and contract suites**

Run: `pnpm --filter @puckflow/api test:integration -- src/routes/rsvps.test.ts src/routes/notification-settings.test.ts`

Expected: PASS with three-state, self/override, privacy, ownership, mute, registration, move, revive, and revoke cases.

Run: `pnpm --filter @puckflow/core test && pnpm --filter @puckflow/api typecheck`

Expected: both commands exit 0.

- [ ] **Step 6: Commit attendance and settings APIs**

```bash
git add apps/api/src/services/rsvp-service.ts apps/api/src/services/notification-settings-service.ts apps/api/src/routes/rsvps.ts apps/api/src/routes/notification-settings.ts apps/api/src/routes/rsvps.test.ts apps/api/src/routes/notification-settings.test.ts apps/api/src/app.ts packages/db/src/repositories/notification-jobs.ts
git commit -m "feat(api): add RSVP and push preference endpoints"
```

---

### Task 5: Dispatch outbox events and deliver FCM/APNs jobs safely

**Files:**
- Create: `apps/worker/src/notifications/providers.ts`
- Create: `apps/worker/src/notifications/fcm.ts`
- Create: `apps/worker/src/notifications/apns.ts`
- Create: `apps/worker/src/notifications/dispatcher.ts`
- Create: `apps/worker/src/notifications/processor.ts`
- Create: `apps/worker/src/notifications/providers.test.ts`
- Create: `apps/worker/src/notifications/dispatcher.test.ts`
- Create: `apps/worker/src/notifications/processor.test.ts`
- Modify: `apps/worker/src/runner.ts`
- Modify: `apps/worker/src/config.ts`
- Modify: `apps/worker/src/server.ts`
- Modify: `apps/worker/package.json`

**Interfaces:**
- Consumes: Task 1 event/job/copy/retry contracts and Task 2 job/token/preference/RSVP repositories.
- Produces: `PushProvider`, `dispatchOnce`, `processJob`, `runWorker`, FCM/APNs adapters, provider-error classification, retry/dead-letter behavior, and provider delivery diagnostics.

- [ ] **Step 1: Write failing dispatch and provider-contract tests**

Use fake repositories/providers and assert: duplicate dispatch creates no duplicate jobs; actor is excluded from scheduled/changed/canceled fan-out; users without device tokens still receive a durable user-level job that completes suppressed after target snapshot; muted users are suppressed before provider calls; FCM receives `android.collapseKey`; APNs receives `apns-collapse-id`, `apns-push-type=alert`, and the configured topic; collapse IDs are the first 64 hex characters of SHA-256 over the deterministic job key.

Run: `pnpm --filter @puckflow/worker test -- src/notifications/dispatcher.test.ts src/notifications/providers.test.ts`

Expected: FAIL because notification worker modules do not exist.

- [ ] **Step 2: Define provider adapters and exact error taxonomy**

```ts
export type PushMessage = {
  token: string;
  title: string;
  body: string;
  data: { category: PushCategory; teamId: string; gameId: string; deepLink: string };
  collapseId: string;
};
export type PushSendResult = { providerMessageId: string };
export class PushProviderError extends Error {
  constructor(public readonly kind: 'invalid_token' | 'transient' | 'permanent' | 'configuration', public readonly safeCode: string) { super(safeCode); }
}
export interface PushProvider { send(message: PushMessage): Promise<PushSendResult>; }
```

Map FCM `registration-token-not-registered` and APNs `BadDeviceToken`/`Unregistered` to `invalid_token`; HTTP 429, provider 5xx, timeout, reset, and DNS failures to `transient`; invalid payload/topic to `permanent`; missing/invalid credentials to `configuration`. Provider errors expose only allowlisted safe codes.

- [ ] **Step 3: Implement adapters using pinned compatible packages**

Run `pnpm --filter @puckflow/worker add --save-exact firebase-admin@14.1.0 @parse/node-apn@8.1.0`. FCM uses a named app initialized from `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and newline-normalized `FIREBASE_PRIVATE_KEY`. APNs uses token credentials `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, and `APNS_PRODUCTION`. Validate all at startup; never print values.

- [ ] **Step 4: Write failing job-processor tests**

Cover current and stale game revisions, canceled/past games, changed player links, non-unknown RSVP, inactive membership, mute, no active tokens, two tokens with one success and one transient failure, invalid-token revocation, permanent target failure, lease recovery, retry delays, completion, and dead-letter after attempt eight. Simulate a restart after target success and prove the sent target is not sent again.

Run: `pnpm --filter @puckflow/worker test -- src/notifications/processor.test.ts`

Expected: FAIL because `processJob` does not exist.

- [ ] **Step 5: Implement bounded processing and rechecks**

```ts
export async function processJob(job: JobRow, deps: WorkerDeps): Promise<void> {
  const payload = PushJobPayloadSchema.parse(job.payload);
  const eligible = await deps.eligibility.check(payload);
  if (!eligible.ok) return deps.jobs.completeSuppressed(job.id, eligible.reason);
  const targets = await deps.jobs.ensureTargets(job.id, payload.recipientUserId);
  if (targets.length === 0) return deps.jobs.complete(job.id);
  for (const target of targets.filter((item) => item.status === 'pending')) {
    try {
      const provider = target.provider === 'fcm' ? deps.fcm : deps.apns;
      const result = await provider.send(toPushMessage(payload, target.token, job.deterministicKey));
      await deps.jobs.markTargetSent(job.id, target.deviceTokenId, result.providerMessageId);
    } catch (error) {
      await handleProviderFailure(job, target, normalizeProviderError(error), deps);
    }
  }
  await deps.jobs.finishOrRetry(job.id, new Date());
}
```

Immediate game jobs require current game revision and active membership. Reminder jobs additionally require scheduled future game, matching player link, and effective `unknown` RSVP. All jobs require unmuted preference. Target snapshots contain raw tokens only in memory and repository-private fields.

- [ ] **Step 6: Implement continuous worker lifecycle**

At startup release claims older than five minutes. Each loop calls `dispatchOutboxBatch(100)`, claims at most 25 due jobs with a two-minute lease, processes with concurrency 5, waits one second only when no work was found, and handles SIGTERM/SIGINT by stopping new claims and allowing the active batch up to 20 seconds to finish. On the eighth transient/configuration failure call `deadLetter`, capture a Sentry event tagged `jobCategory` and `safeCode`, and log only job ID/request correlation fields.

- [ ] **Step 7: Verify and commit the worker**

Run: `pnpm --filter @puckflow/worker test`

Expected: PASS for dispatch idempotency, provider headers, eligibility suppression, partial-token retry, restart safety, invalid-token revocation, lease recovery, and dead-letter alerting.

Run: `pnpm --filter @puckflow/worker typecheck && pnpm --filter @puckflow/worker build`

Expected: both commands exit 0 and the worker build contains no client-exposed credentials.

```bash
git add apps/worker pnpm-lock.yaml
git commit -m "feat(worker): deliver durable game push notifications"
```

---

### Task 6: Add the five-minute idempotent RSVP reminder sweep

**Files:**
- Create: `apps/cron/src/rsvp-reminders.ts`
- Create: `apps/cron/src/rsvp-reminders.test.ts`
- Modify: `apps/cron/src/sweep.ts`
- Modify: `apps/cron/src/config.ts`
- Modify: `apps/cron/src/main.ts`
- Modify: `apps/cron/package.json`
- Modify: `apps/cron/railway.toml`

**Interfaces:**
- Consumes: Task 1 `reminderJobKey`/payload, Task 2 eligible-reminder query and `enqueueReminder`.
- Produces: `runRsvpReminderSweep(now, deps): Promise<SweepResult>` and a Railway one-shot service scheduled every five minutes.

- [ ] **Step 1: Write failing cron integration tests**

At fixed `2027-01-07T01:31:00.000Z`, create games at 25h, 24h01m, 23h59m, 2h, and -1m. Assert only future games whose reminder due time is at or before now enqueue. Exclude canceled games, muted users, unlinked players, non-unknown RSVP, inactive membership, and inactive players without an existing RSVP. Include active linked players with missing RSVP rows. Run the sweep twice and assert one logical job. Materially update a game, assert the old revision job is canceled, then assert a new revision key is inserted. Set RSVP non-unknown then unknown and assert a never-delivered canceled key is reactivated rather than duplicated.

Run: `pnpm --filter @puckflow/cron test -- src/rsvp-reminders.test.ts`

Expected: FAIL because the sweep is absent.

- [ ] **Step 2: Implement exact sweep behavior**

```ts
export type SweepResult = { acquired: boolean; eligible: number; inserted: number; existing: number; reactivated: number };

export async function runRsvpReminderSweep(now: Date, deps: CronDeps): Promise<SweepResult> {
  return deps.db.transaction(async (tx) => {
    const acquired = await deps.reminders.tryAdvisoryLock(tx, 724_756_697);
    if (!acquired) return { acquired: false, eligible: 0, inserted: 0, existing: 0, reactivated: 0 };
    const candidates = await deps.reminders.listDue(tx, now, 500);
    const counts = { inserted: 0, existing: 0, reactivated: 0 };
    for (const candidate of candidates) {
      const result = await deps.jobs.enqueueReminder(toReminderJob(candidate, now));
      counts[result === 'already_exists' ? 'existing' : result] += 1;
    }
    return { acquired: true, eligible: candidates.length, ...counts };
  });
}
```

The due query uses `scheduled_at - interval '24 hours' <= now`, `scheduled_at > now`, current game revision, scheduled status, active linked player and membership, `COALESCE(rsvp.status,'unknown')='unknown'`, and absent-or-false mute. It orders by `(scheduled_at,id,player_id)`, caps one run at 500, and relies on the next five-minute sweep for additional rows.

- [ ] **Step 3: Configure one-shot Railway execution**

`apps/cron/src/main.ts` validates environment, invokes the composed sweep, logs the numeric `SweepResult` as structured JSON, flushes Sentry, closes Postgres, and exits 0. Any unhandled database or validation error is captured, sanitized, and exits 1. `apps/cron/railway.toml` retains the M0 Railpack build/start commands, uses restart policy `never`, and sets cron schedule `*/5 * * * *`.

- [ ] **Step 4: Verify idempotency and build**

Run: `pnpm --filter @puckflow/cron test`

Expected: PASS for due selection, every exclusion, concurrent advisory lock, duplicate sweep, material replacement, and canceled-job reactivation.

Run: `pnpm --filter @puckflow/cron typecheck && pnpm --filter @puckflow/cron build`

Expected: both commands exit 0; importing the sweep does not start a process, while the built entry point runs once and exits.

- [ ] **Step 5: Commit the cron sweep**

```bash
git add apps/cron
git commit -m "feat(cron): schedule idempotent RSVP reminders"
```

---

### Task 7: Add typed API client methods and responsive web workflows

**Files:**
- Create: all `packages/api-client` and `apps/web` files listed in the exact file map.
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Consumes: Task 1 Zod projections and Tasks 3-4 endpoints; M1 authenticated layouts, team switcher, role state, design tokens, and error component.
- Produces: `api.seasons`, `api.games`, `api.rsvps`, `api.notifications`, responsive web scheduling/attendance/settings pages, and reusable web game controls.

- [ ] **Step 1: Write failing API-client transport tests**

Assert exact methods and paths:

```ts
api.seasons.list(teamId)
api.seasons.create(teamId, input)
api.seasons.patch(seasonId, input)
api.games.list(seasonId, { cursor, limit })
api.games.create(seasonId, input)
api.games.get(gameId)
api.games.patch(gameId, input)
api.rsvps.list(gameId)
api.rsvps.set(gameId, playerId, { status })
api.notifications.getTeamPreference(teamId)
api.notifications.setTeamPreference(teamId, { pushMuted })
api.notifications.registerDeviceToken(input)
api.notifications.revokeDeviceToken(tokenId)
```

Run: `pnpm --filter @puckflow/api-client test -- src/seasons.test.ts src/games.test.ts src/rsvps.test.ts src/notifications.test.ts`

Expected: FAIL because these modules are absent.

- [ ] **Step 2: Implement typed client modules**

Each method uses the existing authenticated transport, parses success with Task 1 Zod schemas, and passes Problem Details to the existing error mapper. DELETE accepts 204 without parsing JSON. No method returns raw device-token fields.

Run: `pnpm --filter @puckflow/api-client test && pnpm --filter @puckflow/api-client typecheck`

Expected: PASS; request method/path/body and response validation match Tasks 3-4 exactly.

- [ ] **Step 3: Write failing web component tests**

Assert: managers see season/game create and edit controls; members do not; date/time entry converts local browser time to UTC ISO; game cards show opponent, localized date/time, venue, and home/away; attendance orders active roster rows then inactive historical rows and labels missing rows `Unknown`; a linked member can operate only their row; managers can operate all rows; each RSVP control is a labeled three-option radio group; cancellation requires confirmation; mute is one labeled switch; server errors preserve the user's form state and focus the Problem Details summary.

Run: `pnpm --filter @puckflow/web test -- src/features/games`

Expected: FAIL because the components are absent.

- [ ] **Step 4: Implement web pages and accessible components**

Use semantic `form`, `fieldset`, `legend`, `input`, `button`, and status text. Keep the game list bounded by the API cursor and provide a `Load more` button. Use optimistic RSVP selection only with rollback to the server projection on error; do not optimistically create/edit/cancel games. Minimum browser target sizing follows the existing web tokens. Query invalidation refreshes game list, detail, and attendance after mutation.

- [ ] **Step 5: Add Playwright manager/member smoke coverage**

The test creates a season and game as manager, edits venue and verifies the game detail, opens a member session and submits their linked RSVP, verifies another row is disabled, returns as manager to override the unlinked player, mutes push in team settings, cancels the game, and verifies the canceled state. Seed/reset data through the existing test fixture API, not direct browser database calls.

Run: `pnpm --filter @puckflow/web test && pnpm --filter @puckflow/web test:e2e -- tests/games-rsvp.spec.ts`

Expected: PASS on Chromium with no accessibility-role query failures.

- [ ] **Step 6: Commit client and web work**

```bash
git add packages/api-client apps/web/app/teams apps/web/src/features/games apps/web/tests/games-rsvp.spec.ts
git commit -m "feat(web): add game scheduling and attendance workflows"
```

---

### Task 8: Add native mobile scheduling, RSVP, token registration, and deep links

**Files:**
- Create: all `apps/mobile` files listed in the exact file map.
- Modify: `apps/mobile/app.config.ts`
- Modify: `apps/mobile/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 7 API client, M1 Expo Router authenticated/team shells, Task 1 push data contract.
- Produces: native season/game/attendance/settings screens, native APNs/FCM token lifecycle, and notification routing to the game detail screen.

- [ ] **Step 1: Write failing native component tests**

Using React Native Testing Library, assert the same role and RSVP behavior as web; `FlatList` renders bounded game/attendance lists; all controls have accessibility labels/roles; rows remain usable with large dynamic type; interactive targets have at least 44-point height; local date/time serializes to UTC; cancel uses a native confirmation alert; successful RSVP provides one confirmation haptic and failures do not.

Run: `pnpm --filter @puckflow/mobile test -- src/features/games`

Expected: FAIL because mobile game features are absent.

- [ ] **Step 2: Implement native screens and controls**

Use Expo Router native stacks, platform date/time pickers already selected by M0, `FlatList`, semantic colors/dark mode, `RefreshControl`, and platform alerts. On iPad, constrain forms to the existing readable content width while allowing attendance to use available width. Use the API projection as the source of truth after every mutation.

- [ ] **Step 3: Write failing device registration and notification-routing tests**

Mock Expo Notifications and assert: no request occurs before authentication; denied permission registers nothing; granted iOS returns `apns/sandbox` for a development build and `apns/production` for preview/production; Android returns `fcm/production`; sign-in and token refresh register; sign-out revokes the current registration; raw tokens never enter logs; foreground/background/tapped notifications for all four categories navigate to `/(app)/teams/<teamId>/games/<gameId>`; malformed or mismatched data is ignored and captured with sanitized Sentry context.

Run: `pnpm --filter @puckflow/mobile test -- src/notifications`

Expected: FAIL because registration and handlers are absent.

- [ ] **Step 4: Install and implement Expo Notifications**

Run: `pnpm --filter @puckflow/mobile exec expo install --fix expo-notifications@57.0.3 expo-haptics@57.0.0 @react-native-community/datetimepicker@9.1.0`

Expected: the Expo-SDK-compatible version is added to `apps/mobile/package.json` and `pnpm-lock.yaml` without peer-dependency errors.

`registerDeviceForPush(api)` calls `getPermissionsAsync`, requests permission only after the user activates `Enable notifications`, calls `getDevicePushTokenAsync`, maps the native result and build channel to Task 1 input, and stores only returned token ID in secure app storage for later revocation. Add response and tap listeners once in the authenticated root layout and remove them on cleanup.

- [ ] **Step 5: Verify mobile UI, configuration, and deep links**

Run: `pnpm --filter @puckflow/mobile test`

Expected: PASS for role gating, RSVP, dynamic type/touch targets, permission states, token lifecycle, sanitized logging, and all four deep links.

Run: `pnpm --filter @puckflow/mobile typecheck && pnpm --filter @puckflow/mobile exec expo config --type public`

Expected: typecheck exits 0; Expo config resolves the notifications plugin, existing bundle/package identifiers, and contains no provider secret.

- [ ] **Step 6: Commit mobile work**

```bash
git add apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): add games RSVP and native push registration"
```

---

### Task 9: Prove cross-service behavior and document production operations

**Files:**
- Create: `apps/api/src/integration/games-rsvp-notifications.test.ts`
- Create: `docs/operations/notifications.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: every Task 1-8 interface and the M0 CI/Railway/Sentry foundation.
- Produces: one executable M2 acceptance suite, CI enforcement, and an operator-ready notification runbook.

- [ ] **Step 1: Write the failing acceptance integration test**

Use real Postgres plus fake FCM/APNs adapters. In one scenario: manager creates season/game; scheduled outbox commits; worker dispatches to active non-actor members; member RSVP changes unknown to going; cron at 24h schedules only the still-unknown linked player; reschedule increments revision and cancels the old job; cron creates the new key; team mute suppresses provider delivery; unmute plus a later material revision produces a deliverable reminder; one provider transient failure retries at 30 seconds; invalid token is revoked; successful target is not repeated after worker restart. Force a game mutation rollback and prove neither domain nor outbox row persists.

Run: `pnpm --filter @puckflow/api test:integration -- src/integration/games-rsvp-notifications.test.ts`

Expected: FAIL until the full M2 stack and test harness wiring are connected.

- [ ] **Step 2: Complete the acceptance harness and CI gates**

Use injected fake providers, a fixed clock, and database cleanup helpers. CI runs formatting/lint, typecheck, unit tests, migration tests, API integration tests, worker tests/build, cron tests/build, web tests/build, mobile tests, and `expo config` when relevant paths change. No CI job contacts live FCM or APNs.

- [ ] **Step 3: Write the exact production notification runbook**

Document the API, Postgres outbox/jobs, worker, cron, FCM, APNs, and Sentry topology; required variable names from Task 5; APNs key rotation and Firebase service-account rotation; how to inspect queue depth without selecting token/payload columns; how to identify stale claims; retry timings and eight-attempt dead-letter rule; how to revoke a compromised token; how to replay a dead letter by creating a new deterministic key with an operator suffix and audit note; five-minute cron and advisory-lock behavior; a fake-device smoke test followed by one real iOS and one real Android delivery; and the rule that logs/issue attachments must never contain raw tokens or provider credentials.

- [ ] **Step 4: Run the complete Milestone 2 verification**

Run: `pnpm format:check && pnpm lint && pnpm typecheck`

Expected: all workspace checks exit 0.

Run: `pnpm test && pnpm --filter @puckflow/db test:migrations && pnpm --filter @puckflow/api test:integration`

Expected: all unit, migration, and API integration suites pass against Postgres.

Run: `pnpm --filter @puckflow/api build && pnpm --filter @puckflow/web build && pnpm --filter @puckflow/worker build && pnpm --filter @puckflow/cron build`

Expected: all four production builds exit 0.

Run: `pnpm --filter @puckflow/mobile test && pnpm --filter @puckflow/mobile exec expo config --type public`

Expected: mobile tests pass and public Expo config contains no secret.

- [ ] **Step 5: Commit acceptance coverage and operations**

```bash
git add apps/api/src/integration/games-rsvp-notifications.test.ts docs/operations/notifications.md .github/workflows/ci.yml
git commit -m "test(m2): verify games RSVP notification workflows"
```

---

## Milestone 2 exit checklist

- A manager can create/edit seasons and create/edit/cancel team-owned games on web and mobile.
- Opponent identity is a string snapshot; no cross-team or league game relation exists.
- Every active roster player appears with `unknown`, `going`, or `not_going`; an inactive player with historical RSVP remains displayable.
- A linked member can change only their own player; owners/managers can override any team player.
- Scheduled, materially changed, and canceled game mutations enqueue the correct outbox event transactionally.
- Home/away-only changes do not send push; opponent, time/date, venue, and cancellation do.
- The five-minute cron creates one current-revision reminder job for each linked, active, unknown player approximately 24 hours before the game.
- Rescheduling invalidates older pending reminder jobs; cancellation, mute, non-unknown RSVP, changed link, inactive membership, and past game suppress delivery.
- FCM/APNs tokens are private, revocable, retried safely, and never serialized or logged.
- Provider transient failures retry on the exact schedule and dead-letter after attempt eight with Sentry notification.
- API, worker, cron, web, mobile, migration, and cross-service tests pass; Railway service builds succeed.
- A real team can schedule its next games and obtain a useful attendance view containing linked users and unclaimed/non-user players.

## GitHub issue manifest

### 1. Define M2 game, RSVP, and push domain contracts

- **Issue:** [#27](https://github.com/marknotfound/puckflow/issues/27)
- **Labels:** `type:feature`, `area:data`, `area:games`, `area:notifications`, `priority:p0`
- **Dependencies:** [#26](https://github.com/marknotfound/puckflow/issues/26)
- **Body:** Add the exact Zod schemas, pure policies, material-change classifier, event union, push copy, deterministic keys, and retry schedule for Milestone 2. Preserve the scope boundary that excludes results and statistics.
- **Acceptance criteria:** Core tests prove season date rules, opponent trimming, notification materiality, all three RSVP states, self/manager authorization, four push categories, deterministic job keys, and retry intervals; `@puckflow/core` typecheck passes.
- **Plan task refs:** Task 1

### 2. Persist seasons, games, attendance, and notification operations

- **Issue:** [#28](https://github.com/marknotfound/puckflow/issues/28)
- **Labels:** `type:feature`, `area:data`, `area:games`, `area:notifications`, `priority:p0`
- **Dependencies:** [#27](https://github.com/marknotfound/puckflow/issues/27)
- **Body:** Add migration `0002`, Drizzle schema, team-scoped repositories, lazy unknown attendance projection, preferences, private device tokens, outbox dispatch, durable jobs, and per-device target diagnostics.
- **Acceptance criteria:** Empty/prior-schema migration tests pass; cross-team constraints reject invalid rows; missing RSVP reads as unknown without a write; inactive historical RSVP remains visible; deterministic insert/reactivation and concurrent job claims are proven.
- **Plan task refs:** Task 2

### 3. Ship season and game scheduling APIs

- **Issue:** [#29](https://github.com/marknotfound/puckflow/issues/29)
- **Labels:** `type:feature`, `area:api`, `area:games`, `priority:p0`
- **Dependencies:** [#28](https://github.com/marknotfound/puckflow/issues/28)
- **Body:** Add team-scoped REST endpoints and services for season/game reads and manager mutations, including transactional outbox creation, material revision increments, reminder invalidation, cancellation, Problem Details, and cursor pagination.
- **Acceptance criteria:** Role, privacy, validation, material/non-material, cancellation, rollback, and response-projection integration tests pass; create/edit operations never write a domain row without its required outbox event.
- **Plan task refs:** Task 3

### 4. Ship RSVP, team mute, and device-token APIs

- **Issue:** [#30](https://github.com/marknotfound/puckflow/issues/30)
- **Labels:** `type:feature`, `area:api`, `area:games`, `area:notifications`, `priority:p0`
- **Dependencies:** [#28](https://github.com/marknotfound/puckflow/issues/28)
- **Body:** Add attendance reads, linked-member self-response, manager override, absent-is-unmuted preference, and private authenticated FCM/APNs token registration/revocation.
- **Acceptance criteria:** All three RSVP states, self/override permission, cross-team privacy, reminder cancellation/reactivation, mute isolation, token move/revive/revoke, and no-secret projections pass integration tests.
- **Plan task refs:** Task 4

### 5. Deliver durable game push notifications from the worker

- **Issue:** [#31](https://github.com/marknotfound/puckflow/issues/31)
- **Labels:** `type:feature`, `area:notifications`, `area:platform`, `priority:p0`
- **Dependencies:** [#29](https://github.com/marknotfound/puckflow/issues/29), [#30](https://github.com/marknotfound/puckflow/issues/30)
- **Body:** Dispatch outbox rows into unique user-level jobs, snapshot active device targets, deliver through FCM/APNs, recheck eligibility, retry transient failures, revoke invalid tokens, persist sanitized diagnostics, recover leases, and dead-letter with Sentry.
- **Acceptance criteria:** Fake-provider tests prove idempotent dispatch, provider headers/collapse IDs, stale-revision and mute suppression, partial-target retry, restart safety, invalid-token revocation, exact retry schedule, and attempt-eight dead letter.
- **Plan task refs:** Task 5

### 6. Schedule idempotent approximately-24-hour RSVP reminders

- **Issue:** [#32](https://github.com/marknotfound/puckflow/issues/32)
- **Labels:** `type:feature`, `area:notifications`, `area:platform`, `priority:p0`
- **Dependencies:** [#28](https://github.com/marknotfound/puckflow/issues/28), [#30](https://github.com/marknotfound/puckflow/issues/30)
- **Body:** Add a one-shot advisory-locked Railway cron sweep that runs every five minutes and inserts current-revision reminder jobs for linked unknown players without calling providers.
- **Acceptance criteria:** Fixed-clock tests prove due selection, all exclusion rules, duplicate-sweep idempotency, material-change replacement, canceled-key reactivation, bounded batches, concurrent lock behavior, clean exit, and non-zero failure exit.
- **Plan task refs:** Task 6

### 7. Build typed clients and responsive web scheduling/attendance

- **Issue:** [#33](https://github.com/marknotfound/puckflow/issues/33)
- **Labels:** `type:feature`, `area:games`, `area:web`, `priority:p1`
- **Dependencies:** [#29](https://github.com/marknotfound/puckflow/issues/29), [#30](https://github.com/marknotfound/puckflow/issues/30)
- **Body:** Add Zod-validated API client methods and accessible responsive web flows for seasons, games, attendance, manager edits/cancellation, member self-response, override, pagination, and per-team mute.
- **Acceptance criteria:** Transport, component, role-gating, local-time, rollback/focus, accessibility-role, and manager/member Playwright tests pass; no web push registration or notification inbox is introduced.
- **Plan task refs:** Task 7

### 8. Build mobile games and push lifecycle, then prove M2 operations

- **Issue:** [#34](https://github.com/marknotfound/puckflow/issues/34)
- **Labels:** `type:feature`, `type:test`, `area:games`, `area:mobile`, `area:notifications`, `priority:p1`
- **Dependencies:** [#31](https://github.com/marknotfound/puckflow/issues/31), [#32](https://github.com/marknotfound/puckflow/issues/32), [#33](https://github.com/marknotfound/puckflow/issues/33)
- **Body:** Add native season/game/attendance/mute screens, Expo native token registration/revocation, push deep links, cross-service acceptance coverage, CI gates, and the production notification runbook.
- **Acceptance criteria:** Native role/RSVP/accessibility/token/deep-link tests pass; public Expo config contains no secret; cross-service acceptance proves rollback, reschedule replacement, mute, retry, token revocation, and restart safety; all M2 CI/build commands and the exit checklist pass.
- **Plan task refs:** Tasks 8-9
