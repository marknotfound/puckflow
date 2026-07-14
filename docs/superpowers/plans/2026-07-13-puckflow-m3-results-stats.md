# PuckFlow Milestone 3 Results and Recorded Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let team managers record authoritative post-game results and optional partial goal details while presenting accurate, explicitly incomplete-aware team and player statistics on API, web, and mobile.

**Architecture:** Results and goal rows are persisted in Postgres, validated by pure domain functions, and changed through team-scoped transactional API services that also write audit and outbox rows. The final score is authoritative; recorded goal details are supplementary. Web and mobile consume one Zod-derived API contract and render the same completeness semantics with platform-specific UI.

**Tech Stack:** TypeScript 6.0.3, pnpm 11.13.0, Turborepo, Express, Drizzle ORM, PostgreSQL 17.10, Zod, Vitest, Supertest, `fast-check@4.9.0`, Next.js App Router, Expo Router, React Native Testing Library, Playwright

## Global Constraints

- Follow `docs/puckflow-mvp-plan.md`, especially Sections 6.4, 7, 8, 9.3, 12, 14, and 15.
- Final scores are authoritative; goal details may be partial and never change a final score automatically.
- Outcome is `win | loss | tie`; decision method is `regulation | overtime | shootout`; MVP record is `W-L-T`.
- Goal time means time remaining in the period and is stored as non-negative seconds.
- Goal periods are `first | second | third | overtime`; shootout attempts are not goals.
- Goal strength is `even_strength | power_play | short_handed`.
- A secondary assist requires a primary assist; all attributed players are distinct active or historical roster players for the game's team.
- Recorded goals may be fewer than the team score but may not exceed it.
- Every score or goal mutation writes an allowlisted audit row in the same transaction.
- All API errors use RFC 9457 `application/problem+json` and stable codes from `packages/core`.
- Use TypeScript strict mode and do not introduce `any` without a local lint-suppressed justification.
- Implement with failing tests first and make one conventional commit per task.

---

## File map

Create or modify these focused units:

- `packages/core/src/results/result.ts`: result schemas, outcome derivation, and finalization invariants.
- `packages/core/src/results/goal.ts`: goal schemas and attribution validation.
- `packages/core/src/results/statistics.ts`: pure team/player aggregate calculations and completeness metadata.
- `packages/core/src/results/*.test.ts`: domain and property-based tests.
- `packages/core/src/audit/actions.ts`: result/goal audit action constants.
- `packages/core/src/events/events.ts`: result/goal event payload contracts.
- `packages/db/src/schema/games.ts`: final result columns on the existing games table.
- `packages/db/src/schema/goals.ts`: goals table and constraints.
- `packages/db/src/repositories/results.ts`: transaction-bound result and goal persistence.
- `packages/db/src/repositories/statistics.ts`: team record and player-stat read models.
- `packages/db/drizzle/0003_results_goals.sql`: expand-only schema migration.
- `packages/db/src/repositories/*.test.ts`: Postgres integration tests.
- `apps/api/src/services/results-service.ts`: authorization, transaction, audit, and outbox orchestration.
- `apps/api/src/routes/games-results.ts`: result endpoint.
- `apps/api/src/routes/goals.ts`: goal CRUD endpoints.
- `apps/api/src/routes/statistics.ts`: team and player statistics endpoints.
- `apps/api/src/routes/*.test.ts`: API integration tests.
- `packages/api-client/src/results.ts`: typed result, goal, and statistics client methods.
- `apps/web/app/teams/[teamId]/games/[gameId]/result/*`: web result and goal-detail workflow.
- `apps/web/app/teams/[teamId]/stats/page.tsx`: web team/player statistics.
- `apps/mobile/app/(app)/teams/[teamId]/games/[gameId]/result.tsx`: mobile result and goal entry.
- `apps/mobile/app/(app)/teams/[teamId]/stats.tsx`: mobile statistics.
- `apps/web/tests/results.spec.ts` and `apps/mobile/src/features/results/*.test.tsx`: end-to-end and component coverage.

## Assumed interfaces from Milestones 0-2

- `RequestContext` exposes `{ requestId: string; actorUserId: string }` through `getRequestContext()`.
- `requireTeamRole('manager')` stores an authorized `TeamScope` on the request.
- `TeamScope` is `{ teamId: string; actorUserId: string; membershipId: string; role: 'owner' | 'manager' | 'member'; requestId: string }`.
- An injected `Database.transaction(callback)` passes a Drizzle transaction `tx`; application modules do not import a global database singleton.
- `appendAudit(tx, input)` and `enqueueOutbox(tx, input)` use the canonical Milestone 0 contracts and write transaction-bound operational rows.
- `ProblemError` maps stable codes to Problem Details.
- `gamesRepository.getById(scope, gameId, tx?)` returns a team-owned game with season and status.
- `playersRepository.listForTeam(scope, tx?)` returns active and historically referenced roster players.
- `createApiClient({ getToken, baseUrl })` supplies authenticated transport to web and mobile.
- Web and mobile authenticated layouts, team switcher, game detail, design tokens, and test harnesses already exist.

---

### Task 1: Define result, goal, and statistics domain contracts

**Files:**
- Create: `packages/core/src/results/result.ts`
- Create: `packages/core/src/results/goal.ts`
- Create: `packages/core/src/results/statistics.ts`
- Create: `packages/core/src/results/result.test.ts`
- Create: `packages/core/src/results/goal.test.ts`
- Create: `packages/core/src/results/statistics.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Existing `UuidSchema` and timestamp conventions from `@puckflow/core`.
- Produces: `FinalResultInputSchema`, `GoalInputSchema`, `deriveOutcome`, `validateGoalAttribution`, `computeTeamRecord`, `computePlayerStatLines`, and response types used by every later task.

- [ ] **Step 1: Write failing result-domain tests**

```ts
import { describe, expect, it } from 'vitest';
import { deriveOutcome, FinalResultInputSchema } from './result';

describe('deriveOutcome', () => {
  it.each([
    [5, 3, 'win'],
    [2, 4, 'loss'],
    [3, 3, 'tie'],
  ] as const)('%d-%d is %s', (teamScore, opponentScore, expected) => {
    expect(deriveOutcome(teamScore, opponentScore)).toBe(expected);
  });

  it('keeps decision method independent from a derived tied outcome', () => {
    const parsed = FinalResultInputSchema.safeParse({
      teamScore: 3,
      opponentScore: 3,
      decisionMethod: 'shootout',
    });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify missing-module failure**

Run: `pnpm --filter @puckflow/core test -- src/results/result.test.ts`

Expected: FAIL because `./result` does not exist.

- [ ] **Step 3: Implement the result schema and outcome function**

```ts
import { z } from 'zod';

export const DecisionMethodSchema = z.enum(['regulation', 'overtime', 'shootout']);
export const OutcomeSchema = z.enum(['win', 'loss', 'tie']);

export const FinalResultInputSchema = z.object({
  teamScore: z.number().int().min(0).max(99),
  opponentScore: z.number().int().min(0).max(99),
  decisionMethod: DecisionMethodSchema,
});

export type FinalResultInput = z.infer<typeof FinalResultInputSchema>;

export function deriveOutcome(teamScore: number, opponentScore: number) {
  return teamScore === opponentScore ? 'tie' : teamScore > opponentScore ? 'win' : 'loss';
}
```

- [ ] **Step 4: Write failing goal and statistics tests**

```ts
import { expect, it } from 'vitest';
import { GoalInputSchema } from './goal';

it('rejects a secondary assist without a primary assist', () => {
  const result = GoalInputSchema.safeParse({
    period: 'second',
    clockRemainingSeconds: 321,
    scorerPlayerId: null,
    primaryAssistPlayerId: null,
    secondaryAssistPlayerId: '018f0000-0000-7000-8000-000000000003',
    strength: 'power_play',
  });
  expect(result.success).toBe(false);
});
```

```ts
import { expect, it } from 'vitest';
import { computeTeamRecord } from './statistics';

it('computes a W-L-T record', () => {
  expect(computeTeamRecord(['win', 'loss', 'win', 'tie'])).toEqual({ wins: 2, losses: 1, ties: 1 });
});
```

- [ ] **Step 5: Implement goal and statistics contracts**

```ts
import { z } from 'zod';
import { UuidSchema } from '../ids';

export const GoalInputSchema = z
  .object({
    period: z.enum(['first', 'second', 'third', 'overtime']).nullable(),
    clockRemainingSeconds: z.number().int().min(0).max(60 * 60 - 1).nullable(),
    scorerPlayerId: UuidSchema.nullable(),
    primaryAssistPlayerId: UuidSchema.nullable(),
    secondaryAssistPlayerId: UuidSchema.nullable(),
    strength: z.enum(['even_strength', 'power_play', 'short_handed']).nullable(),
  })
  .superRefine((goal, ctx) => {
    if (goal.secondaryAssistPlayerId && !goal.primaryAssistPlayerId) {
      ctx.addIssue({ code: 'custom', path: ['secondaryAssistPlayerId'], message: 'Secondary assist requires primary assist.' });
    }
    const ids = [goal.scorerPlayerId, goal.primaryAssistPlayerId, goal.secondaryAssistPlayerId].filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['scorerPlayerId'], message: 'Goal attribution players must be distinct.' });
    }
  });
```

```ts
export type TeamRecord = { wins: number; losses: number; ties: number };

export function computeTeamRecord(outcomes: readonly ('win' | 'loss' | 'tie')[]): TeamRecord {
  return outcomes.reduce<TeamRecord>(
    (record, outcome) => ({
      wins: record.wins + Number(outcome === 'win'),
      losses: record.losses + Number(outcome === 'loss'),
      ties: record.ties + Number(outcome === 'tie'),
    }),
    { wins: 0, losses: 0, ties: 0 },
  );
}
```

- [ ] **Step 6: Add property tests for aggregate stability**

Run `pnpm --filter @puckflow/core add --save-dev --save-exact fast-check@4.9.0`, then use `fast-check` to prove every outcome increments exactly one record bucket and every goal contributes one goal plus zero-to-two assists without negative totals.

Run: `pnpm --filter @puckflow/core test -- src/results`

Expected: PASS with all result, goal, and statistics tests.

- [ ] **Step 7: Commit the domain contracts**

```bash
git add packages/core/src/results packages/core/src/index.ts
git commit -m "feat(core): define result and recorded statistics rules"
```

---

### Task 2: Persist final results and optional goals

**Files:**
- Modify: `packages/db/src/schema/games.ts`
- Create: `packages/db/src/schema/goals.ts`
- Create: `packages/db/src/repositories/results.ts`
- Create: `packages/db/src/repositories/statistics.ts`
- Create: `packages/db/src/repositories/results.test.ts`
- Create: `packages/db/src/repositories/statistics.test.ts`
- Create: `packages/db/drizzle/0003_results_goals.sql`
- Modify: `packages/db/src/schema/index.ts`

**Interfaces:**
- Consumes: Task 1 schemas and existing `games`, `players`, transaction, and team-scoped repository primitives.
- Produces: `ResultsRepository` and `StatisticsRepository` used by the API service.

- [ ] **Step 1: Write failing repository integration tests**

Cover: result finalization derives outcome, tied results remain valid, goal attribution rejects another team's player, a secondary assist needs a primary assist, and a sixth recorded goal is rejected when final team score is five.

Run: `pnpm --filter @puckflow/db test:integration -- src/repositories/results.test.ts`

Expected: FAIL because the schema and repository do not exist.

- [ ] **Step 2: Add expand-only result columns and goals table**

The migration must add nullable `team_score`, `opponent_score`, `outcome`, `decision_method`, and `finalized_at` columns to `games`, then create `goals` with foreign keys to `games`, `players`, and users. Include checks for non-negative scores/time, distinct player IDs, and secondary-assist ordering. Do not make existing game rows invalid.

- [ ] **Step 3: Implement transaction-bound repository interfaces**

```ts
export interface ResultsRepository {
  setFinalResult(tx: DbTransaction, teamId: string, gameId: string, input: FinalResultInput): Promise<GameResultRow>;
  countGoals(tx: DbTransaction, teamId: string, gameId: string): Promise<number>;
  createGoal(tx: DbTransaction, teamId: string, gameId: string, input: GoalInput & { id: string; actorUserId: string }): Promise<GoalRow>;
  updateGoal(tx: DbTransaction, teamId: string, goalId: string, input: GoalInput & { actorUserId: string }): Promise<GoalRow>;
  deleteGoal(tx: DbTransaction, teamId: string, goalId: string): Promise<GoalRow>;
}
```

Use team ID predicates in every query. Lock the game row before comparing goal count to the authoritative team score.

- [ ] **Step 4: Implement statistics read models**

```ts
export interface StatisticsRepository {
  getTeamRecord(teamId: string, seasonId?: string): Promise<{ wins: number; losses: number; ties: number }>;
  getPlayerStatLines(teamId: string, seasonId?: string): Promise<Array<{
    playerId: string;
    displayName: string;
    goals: number;
    assists: number;
    points: number;
    isComplete: boolean;
    incompleteGames: number;
  }>>;
}
```

Compute completeness per included game by comparing recorded team goals with `team_score`. Do not cache until measurements justify it.

- [ ] **Step 5: Run migration and repository tests**

Run: `pnpm --filter @puckflow/db test:migrations`

Expected: PASS applying every migration to an empty database and the representative Milestone 2 fixture.

Run: `pnpm --filter @puckflow/db test:integration -- src/repositories/results.test.ts src/repositories/statistics.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit persistence**

```bash
git add packages/db
git commit -m "feat(db): persist game results and goal details"
```

---

### Task 3: Add transactional result, goal, and statistics APIs

**Files:**
- Create: `apps/api/src/services/results-service.ts`
- Create: `apps/api/src/routes/games-results.ts`
- Create: `apps/api/src/routes/goals.ts`
- Create: `apps/api/src/routes/statistics.ts`
- Create: `apps/api/src/routes/games-results.test.ts`
- Create: `apps/api/src/routes/goals.test.ts`
- Create: `apps/api/src/routes/statistics.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/core/src/audit/actions.ts`
- Modify: `packages/core/src/events/events.ts`

**Interfaces:**
- Consumes: Tasks 1-2 repositories, `requireTeamRole`, `appendAudit`, `enqueueOutbox`, and Problem Details.
- Produces: `PUT /v1/games/:gameId/result`, goal CRUD, and `GET /v1/teams/:teamId/statistics`.

- [ ] **Step 1: Write failing API tests**

Test manager success, member 403, cross-team 404, invalid attribution 422, `GOAL_DETAIL_EXCEEDS_FINAL_SCORE` conflict, audit rollback, and response completeness fields.

Run: `pnpm --filter @puckflow/api test:integration -- src/routes/games-results.test.ts src/routes/goals.test.ts src/routes/statistics.test.ts`

Expected: FAIL with unregistered routes.

- [ ] **Step 2: Implement the transaction service**

```ts
export class ResultsService {
  async setFinalResult(scope: TeamScope, gameId: string, input: FinalResultInput) {
    return this.db.transaction(async (tx) => {
      const existingGoalCount = await this.results.countGoals(tx, scope.teamId, gameId);
      if (existingGoalCount > input.teamScore) {
        throw new ProblemError({ status: 409, code: 'GOAL_DETAIL_EXCEEDS_FINAL_SCORE', title: 'Conflict', detail: 'Recorded goals exceed the final team score.' });
      }
      const result = await this.results.setFinalResult(tx, scope.teamId, gameId, input);
      await appendAudit(tx, resultUpdatedAudit({ result, scope, id: uuidv7() }));
      await enqueueOutbox(tx, resultUpdatedEvent({ result, scope, id: uuidv7() }));
      return result;
    });
  }
}
```

Implement goal create/update/delete through the same pattern. The result event has no MVP push consumer but remains an internal extension point.

- [ ] **Step 3: Register validated routes**

Use `requireTeamRole('manager')` for mutations and any team membership for statistics reads. Parse params, body, and responses with Zod. Return 404 for invisible games and 403 for visible but unauthorized mutations.

- [ ] **Step 4: Run API and policy tests**

Run: `pnpm --filter @puckflow/api test:integration -- src/routes/games-results.test.ts src/routes/goals.test.ts src/routes/statistics.test.ts`

Expected: PASS.

Run: `pnpm --filter @puckflow/core test -- src/policies`

Expected: PASS with result and goal mutation cells represented in the role matrix.

- [ ] **Step 5: Commit the API vertical slice**

```bash
git add apps/api packages/core/src/audit packages/core/src/events
git commit -m "feat(api): add post-game results and goal details"
```

---

### Task 4: Publish typed client contracts

**Files:**
- Create: `packages/api-client/src/results.ts`
- Create: `packages/api-client/src/results.test.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Consumes: Task 1 Zod schemas and Task 3 routes.
- Produces: `resultsApi.setFinalResult`, `createGoal`, `updateGoal`, `deleteGoal`, and `getTeamStatistics`.

- [ ] **Step 1: Write a failing transport contract test**

Assert exact HTTP method/path, authenticated request, Problem Details propagation, and response parsing for each method.

Run: `pnpm --filter @puckflow/api-client test -- src/results.test.ts`

Expected: FAIL because `resultsApi` is not exported.

- [ ] **Step 2: Implement the focused API client**

```ts
export function createResultsApi(transport: ApiTransport) {
  return {
    setFinalResult: (gameId: string, input: FinalResultInput) =>
      transport.request(`/v1/games/${gameId}/result`, { method: 'PUT', body: input, schema: GameResultResponseSchema }),
    createGoal: (gameId: string, input: GoalInput) =>
      transport.request(`/v1/games/${gameId}/goals`, { method: 'POST', body: input, schema: GoalResponseSchema }),
    getTeamStatistics: (teamId: string, seasonId?: string) =>
      transport.request(`/v1/teams/${teamId}/statistics`, { query: { seasonId }, schema: TeamStatisticsResponseSchema }),
  };
}
```

- [ ] **Step 3: Run client tests and commit**

Run: `pnpm --filter @puckflow/api-client test -- src/results.test.ts`

Expected: PASS.

```bash
git add packages/api-client
git commit -m "feat(api-client): expose results and statistics contracts"
```

---

### Task 5: Build the responsive web result and statistics flows

**Files:**
- Create: `apps/web/app/teams/[teamId]/games/[gameId]/result/page.tsx`
- Create: `apps/web/src/features/results/result-form.tsx`
- Create: `apps/web/src/features/results/goal-editor.tsx`
- Create: `apps/web/src/features/results/completeness-banner.tsx`
- Create: `apps/web/app/teams/[teamId]/stats/page.tsx`
- Create: `apps/web/src/features/results/*.test.tsx`
- Create: `apps/web/tests/results.spec.ts`

**Interfaces:**
- Consumes: Task 4 client methods and existing authenticated team/game layouts.
- Produces: Manager result entry, optional goal CRUD, and member-readable statistics views.

- [ ] **Step 1: Write failing component tests**

Test score validation, decision method, `MM:SS` to seconds conversion, optional attribution, roster-filtered player selectors, completeness copy, manager-only controls, and incomplete stat labels.

Run: `pnpm --filter @puckflow/web test -- src/features/results`

Expected: FAIL because the components do not exist.

- [ ] **Step 2: Implement the result form**

Use semantic form controls, visible labels, field errors tied with `aria-describedby`, and one submit action. Parse goal time with a pure shared formatter and keep empty optional fields as `null`, not empty strings.

- [ ] **Step 3: Implement goal editor and statistics page**

Show `N of team score goals detailed` beside goal entries. Mark every incomplete player-stat group with `Stats reflect recorded goal details; X games are incomplete.` Do not hide zero-stat roster players.

- [ ] **Step 4: Run component and Playwright tests**

Run: `pnpm --filter @puckflow/web test -- src/features/results`

Expected: PASS.

Run: `pnpm --filter @puckflow/web test:e2e -- tests/results.spec.ts`

Expected: PASS for manager entry, member read-only view, partial goal detail, and corrected result.

- [ ] **Step 5: Commit web results**

```bash
git add apps/web
git commit -m "feat(web): add post-game results and statistics"
```

---

### Task 6: Build the native result and statistics flows

**Files:**
- Create: `apps/mobile/app/(app)/teams/[teamId]/games/[gameId]/result.tsx`
- Create: `apps/mobile/src/features/results/result-form.tsx`
- Create: `apps/mobile/src/features/results/goal-editor.tsx`
- Create: `apps/mobile/src/features/results/completeness-banner.tsx`
- Create: `apps/mobile/app/(app)/teams/[teamId]/stats.tsx`
- Create: `apps/mobile/src/features/results/*.test.tsx`

**Interfaces:**
- Consumes: Task 4 client methods and existing Expo auth/team/game navigation.
- Produces: Native post-game entry and statistics screens with the same semantics as web.

- [ ] **Step 1: Write failing React Native component tests**

Cover 44-point score controls, VoiceOver/TalkBack labels, keyboard-safe form behavior, optional goal fields, roster selectors, manager-only edit affordances, and completeness copy.

Run: `pnpm --filter @puckflow/mobile test -- src/features/results`

Expected: FAIL because the result components do not exist.

- [ ] **Step 2: Implement result and goal screens**

Use native inputs and sheets, platform back behavior, dark-mode semantic tokens, and an explicit save button. Do not implement a live clock, optimistic offline queue, rapid undo, or automatic score changes.

- [ ] **Step 3: Implement statistics screen**

Render `W-L-T`, goals, assists, points, and the incomplete-data qualifier. Keep the layout adaptive for iPad but do not create a separate scorekeeper layout.

- [ ] **Step 4: Run mobile tests and configuration checks**

Run: `pnpm --filter @puckflow/mobile test -- src/features/results`

Expected: PASS.

Run: `pnpm --filter @puckflow/mobile exec expo config --type public`

Expected: exit 0 with valid iOS and Android configuration.

- [ ] **Step 5: Commit mobile results**

```bash
git add apps/mobile
git commit -m "feat(mobile): add post-game results and statistics"
```

---

### Task 7: Verify the complete Milestone 3 vertical slice

**Files:**
- Modify: `docs/operations/milestone-checklist.md`
- Modify: representative fixtures under `packages/db/src/test/fixtures/`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: A reviewed Milestone 3 exit-criteria record and representative migration fixture for Milestone 4.

- [ ] **Step 1: Run all affected checks**

Run: `pnpm turbo run lint typecheck test build --filter='...@puckflow/api' --filter='...@puckflow/web' --filter='...@puckflow/mobile'`

Expected: every affected task exits 0.

- [ ] **Step 2: Run integration and end-to-end suites**

Run: `pnpm --filter @puckflow/db test:integration`

Expected: PASS.

Run: `pnpm --filter @puckflow/api test:integration`

Expected: PASS.

Run: `pnpm --filter @puckflow/web test:e2e -- tests/results.spec.ts`

Expected: PASS.

- [ ] **Step 3: Perform the acceptance walkthrough**

Record evidence that an owner and manager can enter and correct a result; a member cannot mutate it; partial detail displays correctly; a sixth detail row for a 5-goal score is rejected; `W-L-T` and `G-A-P` recalculate; incomplete statistics remain visibly qualified; and audit rows share request IDs with API logs.

- [ ] **Step 4: Commit verification evidence**

```bash
git add docs/operations/milestone-checklist.md packages/db/src/test/fixtures
git commit -m "test: verify milestone 3 results and statistics"
```

---

## GitHub issue manifest

### 1. Define result, goal, and statistics domain contracts

- **Issue:** [#1](https://github.com/marknotfound/puckflow/issues/1)
- **Labels:** `type:feature`, `area:data`, `area:stats`, `priority:p0`
- **Depends on:** [#34](https://github.com/marknotfound/puckflow/issues/34)
- **Plan tasks:** Task 1
- **Body:** Define the canonical Zod contracts and pure rules for final scores, outcomes, decision methods, optional goal detail, time remaining, attribution constraints, team records, player totals, and incomplete-data metadata.
- **Acceptance criteria:** Focused and property tests pass; exports are stable; no league point assumptions or live-scoring state is introduced.

### 2. Persist authoritative results and optional goal details

- **Issue:** [#2](https://github.com/marknotfound/puckflow/issues/2)
- **Labels:** `type:feature`, `area:data`, `area:stats`, `priority:p0`
- **Depends on:** [#1](https://github.com/marknotfound/puckflow/issues/1)
- **Plan tasks:** Task 2
- **Body:** Add expand-only result columns, the goals table, team-scoped repositories, and uncached statistics read models.
- **Acceptance criteria:** Empty and representative migrations pass; cross-team attribution is impossible; details may be partial but cannot exceed the final team score.

### 3. Add transactional result, goal, and statistics APIs

- **Issue:** [#3](https://github.com/marknotfound/puckflow/issues/3)
- **Labels:** `type:feature`, `area:api`, `area:stats`, `priority:p0`
- **Depends on:** [#2](https://github.com/marknotfound/puckflow/issues/2)
- **Plan tasks:** Tasks 3-4
- **Body:** Implement manager-authorized result and goal mutations, team-member statistics reads, typed API client methods, minimal audit, and internal outbox events.
- **Acceptance criteria:** Role, tenant, validation, transaction rollback, Problem Details, and client contract tests pass.

### 4. Build web post-game result and statistics flows

- **Issue:** [#4](https://github.com/marknotfound/puckflow/issues/4)
- **Labels:** `type:feature`, `area:stats`, `area:web`, `priority:p1`
- **Depends on:** [#3](https://github.com/marknotfound/puckflow/issues/3)
- **Plan tasks:** Task 5
- **Body:** Add accessible responsive web workflows for final result entry, optional goal details, completeness status, and team/player statistics.
- **Acceptance criteria:** Component and Playwright tests pass; members remain read-only; incomplete statistics are visibly qualified.

### 5. Build mobile post-game result and statistics flows

- **Issue:** [#5](https://github.com/marknotfound/puckflow/issues/5)
- **Labels:** `type:feature`, `area:mobile`, `area:stats`, `priority:p1`
- **Depends on:** [#3](https://github.com/marknotfound/puckflow/issues/3)
- **Plan tasks:** Task 6
- **Body:** Add native Expo result, goal-detail, and statistics screens without live or offline scoring behavior.
- **Acceptance criteria:** Native component tests and Expo config pass; accessibility and dark mode requirements are met on phone and adaptive iPad layouts.

### 6. Verify the Milestone 3 result and statistics vertical slice

- **Issue:** [#6](https://github.com/marknotfound/puckflow/issues/6)
- **Labels:** `type:test`, `area:stats`, `priority:p0`
- **Depends on:** [#4](https://github.com/marknotfound/puckflow/issues/4), [#5](https://github.com/marknotfound/puckflow/issues/5)
- **Plan tasks:** Task 7
- **Body:** Run the full affected test/build matrix and record the real-role acceptance walkthrough for results, partial details, records, player totals, and audit correlation.
- **Acceptance criteria:** All commands exit 0 and the Milestone 3 exit criteria are recorded with no unresolved P0/P1 defects.
