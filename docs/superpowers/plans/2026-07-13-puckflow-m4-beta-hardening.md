# PuckFlow Milestone 4 Beta Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the completed team MVP secure, observable, accessible, recoverable, and ready for repeated use by beta teams through TestFlight, Play internal testing, and production web.

**Architecture:** Milestone 4 hardens the existing modular monolith without adding product scope. Security and failure behavior are enforced at shared boundaries, observability is correlated by release and request ID, recovery is demonstrated rather than assumed, and platform release configuration is validated through repeatable CI and EAS workflows.

**Tech Stack:** TypeScript 6.0.3, pnpm 11.13.0, Turborepo, Express, PostgreSQL 17.10, Vitest, Supertest, Playwright 1.61.1, React Native Testing Library, `axe-core@4.12.1`, `@axe-core/playwright@4.12.1`, k6, Sentry, Railway Railpack, GitHub Actions, `eas-cli@21.0.0`

## Global Constraints

- Follow `docs/puckflow-mvp-plan.md`, especially Sections 13-16.
- Do not add leagues, public profiles, live/offline scoring, notification inboxes, payment code, chat, or other deferred product scope.
- Production deploys from protected `main`; there is no staging branch or Railway staging environment.
- Railway must wait for required GitHub Actions checks before production autodeploy.
- Exactly one service, the API, owns production pre-deploy database migrations.
- Every public route has explicit authentication, projection, rate-limit, and cache decisions.
- Production accepts real user data only with scheduled backups, PITR, and a proven restore runbook.
- Security-sensitive mutations retain allowlisted audit events and request ID correlation.
- Use TypeScript strict mode; implement changes with failing tests first and one conventional commit per task.

---

## File map

- `.github/workflows/ci.yml`: required PR and push checks.
- `.github/workflows/mobile-preview.yml`: EAS preview build workflow.
- `.github/dependabot.yml`: dependency update policy.
- `apps/api/src/middleware/rate-limit.ts`: route-class rate limiting.
- `apps/api/src/middleware/security.ts`: headers, body limits, and public-route defaults.
- `apps/api/src/observability.ts` and `apps/api/src/routes/health.ts`: extend the existing structured logging, request correlation, Sentry, health, and readiness boundaries.
- `apps/worker/src/observability.ts`: worker release/error/dead-letter telemetry.
- `apps/web/src/observability.ts`: Next.js Sentry/release setup.
- `apps/mobile/src/observability.ts`: Expo Sentry/release setup.
- `packages/core/src/security/redaction.ts`: log/audit redaction allowlists.
- `packages/core/src/security/redaction.test.ts`: secret and PII regression tests.
- `tests/load/*`: k6 API and job-throughput scenarios.
- `tests/failure/*`: provider, worker restart, and deployment-overlap tests.
- `apps/web/tests/accessibility.spec.ts`: axe-backed critical-flow checks.
- `apps/mobile/src/accessibility/*.test.tsx`: native accessibility regression coverage.
- `apps/mobile/app.config.ts`, `apps/mobile/eas.json`: store identifiers, channels, build profiles.
- `docs/operations/*`: extend the existing Railway, observability, backup/PITR, restore-drill, and deployment runbooks; add incident and beta-support material only where absent.
- `docs/release/beta-checklist.md`: signed beta release evidence.

## Assumed interfaces from Milestones 0-3

- All services expose release metadata and structured JSON logging hooks.
- API errors use Problem Details and include `requestId`.
- Auth, policies, scoped repositories, audit, outbox, jobs, web/mobile flows, media, notifications, and result/statistic features are complete.
- Railway production service configs and a setup runbook exist.
- EAS development configuration exists but production identifiers and store workflows are not complete.

---

### Task 1: Enforce security boundary defaults

**Files:**
- Create: `apps/api/src/middleware/rate-limit.ts`
- Create: `apps/api/src/middleware/security.ts`
- Create: `apps/api/src/middleware/security.test.ts`
- Create: `packages/core/src/security/redaction.ts`
- Create: `packages/core/src/security/redaction.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/media.ts`
- Modify: `.github/dependabot.yml`

**Interfaces:**
- Consumes: Existing auth, Problem Details, upload validation, request context, and audit boundaries.
- Produces: `securityMiddleware`, `rateLimitFor(routeClass)`, and `redactForLog` used by API and worker.

- [ ] **Step 1: Write failing security regression tests**

```ts
import { expect, it } from 'vitest';
import { redactForLog } from './redaction';

it('removes known secrets and private identity values', () => {
  expect(redactForLog({ email: 'player@example.com', token: 'secret', requestId: 'req_1' })).toEqual({
    email: '[REDACTED]',
    token: '[REDACTED]',
    requestId: 'req_1',
  });
});
```

API tests must also assert body-size rejection, security headers, authenticated route defaults, invite/upload/write throttling, MIME sniffing, dimension/1 MiB enforcement, and Problem Details for every rejection.

Run: `pnpm --filter @puckflow/core test -- src/security/redaction.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement allowlist-based redaction**

```ts
const REDACTED_KEYS = new Set(['authorization', 'cookie', 'email', 'fcmToken', 'password', 'secret', 'token']);

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLog);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    REDACTED_KEYS.has(key) ? '[REDACTED]' : redactForLog(child),
  ]));
}
```

- [ ] **Step 3: Implement route-class security and rate limits**

Define explicit classes: `publicRead`, `authenticatedRead`, `write`, `inviteAcceptance`, and `uploadIssuance`. Key authenticated traffic by user ID and unauthenticated traffic by a salted IP hash. Return `RATE_LIMITED` Problem Details with a safe `Retry-After` header.

- [ ] **Step 4: Add dependency and supply-chain checks**

Configure Dependabot for pnpm and GitHub Actions. There are no application Dockerfiles because Railway uses Railpack. Pin Action major versions and add `pnpm audit --prod` plus lockfile integrity to CI. Document any accepted advisory with package, affected path, compensating control, owner, and review date rather than suppressing globally.

- [ ] **Step 5: Run security tests and commit**

Run: `pnpm --filter @puckflow/core test -- src/security`

Expected: PASS.

Run: `pnpm --filter @puckflow/api test:integration -- src/middleware/security.test.ts`

Expected: PASS.

```bash
git add apps/api packages/core/src/security .github/dependabot.yml
git commit -m "security: harden API boundaries and redaction"
```

---

### Task 2: Complete observability, alerting, and incident diagnostics

**Files:**
- Modify: `apps/api/src/observability.ts`
- Modify: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/health.test.ts`
- Create: `apps/worker/src/observability.ts`
- Create: `apps/web/src/observability.ts`
- Create: `apps/mobile/src/observability.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/worker/src/server.ts`
- Modify: `docs/operations/observability.md`
- Create: `docs/operations/incident-response.md`

**Interfaces:**
- Consumes: Request context, job/dead-letter state, Sentry DSNs, Railway release variables, and structured logger.
- Produces: release-correlated telemetry, the existing `/health/live` and `/health/ready` contracts, and actionable alert/runbook mappings.

- [ ] **Step 1: Write failing observability tests**

Assert `/health/live` never queries dependencies, `/health/ready` fails when Postgres is unavailable, logs contain request ID/release/service without raw PII, and dead-letter capture includes job key/category/attempt count without provider token.

Run: `pnpm --filter @puckflow/api test:integration -- src/routes/health.test.ts`

Expected: FAIL because readiness and release metadata are absent.

- [ ] **Step 2: Implement service and release correlation**

```ts
export const releaseContext = {
  environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? 'local',
  release: process.env.RAILWAY_GIT_COMMIT_SHA ?? 'local',
  service: process.env.RAILWAY_SERVICE_NAME ?? 'unknown',
};
```

Initialize Sentry before application imports, attach request IDs and safe actor/team identifiers, and flush worker events on graceful shutdown.

- [ ] **Step 3: Implement liveness and readiness**

`/health/live` returns process liveness and release. `/health/ready` checks a bounded `SELECT 1` and fails closed. Neither response exposes database URLs, environment variables, build secrets, or stack traces.

- [ ] **Step 4: Write alert and incident runbooks**

Document alerts for API/web unavailability, repeated 5xx, worker dead letters, provider failures, Postgres CPU/memory/disk pressure, missing backups, and PITR archive gaps. Each alert names severity, dashboard, first diagnostic query, mitigation, escalation, and recovery verification.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @puckflow/api test:integration -- src/observability`

Expected: PASS.

Run: `pnpm --filter @puckflow/worker test`

Expected: PASS including dead-letter telemetry.

```bash
git add apps/api apps/worker apps/web apps/mobile docs/operations
git commit -m "chore: complete production observability"
```

---

### Task 3: Prove load, retry, restart, and deployment-overlap behavior

**Files:**
- Create: `tests/load/api-results.js`
- Create: `tests/load/rsvp.js`
- Create: `tests/load/job-throughput.js`
- Create: `tests/failure/provider-outage.test.ts`
- Create: `tests/failure/worker-restart.test.ts`
- Create: `tests/failure/deployment-overlap.test.ts`
- Create: `docs/operations/capacity-baseline.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: Production-like local stack, seeded test users/teams/games, worker/job controls, and expand-and-contract fixtures.
- Produces: A repeatable capacity baseline and verified failure recovery behavior.

Add root `test:failure`, `test:load`, and `test:e2e` scripts before invoking them. `test:failure` runs the focused Vitest project; `test:load` invokes the checked-in k6 scenarios and fails on threshold violations; `test:e2e` delegates to the web Playwright suite.

- [ ] **Step 1: Write the failure tests before changing behavior**

Test that a provider timeout retries with backoff, a worker termination releases or expires claims, duplicate reminder sweeps produce one job, duplicate worker execution produces no duplicate logical send, and old/new service revisions both operate during schema overlap.

Run: `pnpm test:failure`

Expected: FAIL on any unimplemented shutdown, lease, or idempotency behavior.

- [ ] **Step 2: Make failure handling pass with minimal changes**

Add bounded provider timeouts, exponential backoff with jitter, claim leases, graceful SIGTERM handling, deterministic notification keys, and expansion-compatible repository reads. Do not add Redis or a second queue.

- [ ] **Step 3: Implement focused k6 scenarios**

Scenarios cover authenticated game/RSVP reads, concurrent RSVP updates, result entry, goal writes, and worker job throughput. Use synthetic accounts only. Define explicit thresholds for error rate and p95 latency in the baseline document after measuring the production-sized local/Railway configuration; the initial beta gate is no data corruption, no duplicate logical sends, and no sustained resource saturation.

- [ ] **Step 4: Run failure and load suites**

Run: `pnpm test:failure`

Expected: PASS.

Run: `pnpm test:load`

Expected: k6 exits 0 and writes the dated baseline summarized in `docs/operations/capacity-baseline.md`.

- [ ] **Step 5: Commit resilience evidence**

```bash
git add tests/load tests/failure docs/operations/capacity-baseline.md apps/api apps/worker packages/db
git commit -m "test: prove beta load and failure behavior"
```

---

### Task 4: Complete accessibility, dark mode, and adaptive-layout review

**Files:**
- Create: `apps/web/tests/accessibility.spec.ts`
- Create: `apps/mobile/src/accessibility/critical-flows.test.tsx`
- Modify: affected web/mobile components identified by the tests
- Create: `docs/release/accessibility-checklist.md`

**Interfaces:**
- Consumes: All Milestone 1-3 client flows and shared semantic design tokens.
- Produces: Automated and manual accessibility evidence across critical workflows.

Run `pnpm --filter @puckflow/web add --save-dev --save-exact axe-core@4.12.1 @axe-core/playwright@4.12.1` before writing the web accessibility tests.

- [ ] **Step 1: Write failing automated accessibility tests**

Web coverage: sign-in handoff, team switcher, invitation, roster, game, RSVP, result, goal editor, and statistics. Native coverage: accessible names/roles/state, dynamic type, 44-point targets, keyboard avoidance, focus return after sheets, and dark-mode semantic colors.

Run: `pnpm --filter @puckflow/web test:e2e -- tests/accessibility.spec.ts`

Expected: FAIL on the first identified violation.

Run: `pnpm --filter @puckflow/mobile test -- src/accessibility`

Expected: FAIL on the first identified violation.

- [ ] **Step 2: Fix violations at the owning component**

Do not suppress axe rules or snapshot inaccessible markup. Fix labels, headings, focus, roles, state announcements, contrast tokens, and touch targets in the focused component that owns each issue.

- [ ] **Step 3: Perform manual platform review**

Record VoiceOver on iOS, TalkBack on Android, keyboard-only web, 200% web zoom, largest supported dynamic type, dark mode, and iPad adaptive-layout results. Every failure must link to a GitHub issue or be fixed before beta.

- [ ] **Step 4: Run accessibility suites and commit**

Run: `pnpm --filter @puckflow/web test:e2e -- tests/accessibility.spec.ts`

Expected: PASS with no serious or critical axe violations.

Run: `pnpm --filter @puckflow/mobile test -- src/accessibility`

Expected: PASS.

```bash
git add apps/web apps/mobile docs/release/accessibility-checklist.md
git commit -m "fix: complete beta accessibility review"
```

---

### Task 5: Configure EAS preview and internal-store delivery

**Files:**
- Modify: `apps/mobile/app.config.ts`
- Modify: `apps/mobile/eas.json`
- Create: `.github/workflows/mobile-preview.yml`
- Create: `docs/operations/mobile-release.md`
- Create: `docs/release/store-metadata.md`

**Interfaces:**
- Consumes: Valid Expo app, Clerk client configuration, API production URL, Sentry release setup, and platform credentials held by EAS.
- Produces: Repeatable preview, TestFlight, and Play internal builds without committing credentials.

- [ ] **Step 1: Add configuration tests**

Assert unique iOS bundle identifier and Android application ID, production API domain, runtime-version policy, update URL, permission strings, deep-link schemes, privacy manifest entries, and environment separation between local development and production builds.

Run: `pnpm --filter @puckflow/mobile test -- src/config`

Expected: FAIL until the complete config is present.

- [ ] **Step 2: Define EAS profiles**

Create `development`, `preview`, and `production` profiles. Preview targets internal distribution. Production uses store distribution and explicit auto-increment. OTA updates use a runtime policy that prevents incompatible native binaries from receiving JavaScript updates.

- [ ] **Step 3: Add CI-triggered preview builds**

The workflow runs only after required mobile checks and requires protected repository secrets/environments. It must not expose EAS, Apple, Google, Clerk, or Sentry credentials in logs.

- [ ] **Step 4: Build and install both preview artifacts**

Run: `pnpm dlx eas-cli@21.0.0 build --platform all --profile preview`

Expected: successful iOS and Android build URLs, both installed and exercised through sign-in, team, RSVP, result, and push-token registration.

- [ ] **Step 5: Submit internal builds and record evidence**

Use `pnpm dlx eas-cli@21.0.0 submit --platform ios --profile production` and the corresponding Android command for TestFlight and Google Play internal testing. Record build numbers, commit SHA, runtime version, testers, smoke-test result, and rollback procedure in the release checklist.

- [ ] **Step 6: Commit release configuration**

```bash
git add apps/mobile .github/workflows/mobile-preview.yml docs/operations/mobile-release.md docs/release/store-metadata.md
git commit -m "chore: configure internal mobile releases"
```

---

### Task 6: Verify production recovery and beta readiness

**Files:**
- Modify: `docs/operations/backups-and-pitr.md`
- Modify: `docs/operations/restore-drills/README.md`
- Modify: `docs/operations/railway-production.md`
- Create: `docs/release/beta-checklist.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/operations/milestone-checklist.md`

**Interfaces:**
- Consumes: Tasks 1-5 and all prior milestone exit criteria.
- Produces: A signed, dated beta gate and proven Railway database recovery procedure.

- [ ] **Step 1: Verify protected-main and deployment configuration**

Record evidence that required GitHub checks gate `main`, Railway Wait for CI is enabled, API is the only migration owner, service health checks are configured, public/private domains are correct, secrets are Railway variables, and continuous uptime monitoring is active.

- [ ] **Step 2: Perform the restore drill**

Create a marker record, note its timestamp, mutate it after the target point, restore Postgres through Railway PITR to a sibling service, verify the pre-target marker and absence of the post-target mutation, run integrity queries, point a temporary local API at the restored service, and exercise authenticated reads. Do not cut production traffic during the drill.

- [ ] **Step 3: Document cutover and rollback**

The runbook must list how to pause writes, select and restore a target, validate the sibling database, update Railway variable references, redeploy affected services, smoke test, monitor, retain the original, and reverse the cutover.

- [ ] **Step 4: Run the complete repository gate**

Run: `pnpm turbo run lint typecheck test build`

Expected: all tasks exit 0.

Run: `pnpm test:integration`

Expected: PASS.

Run: `pnpm test:e2e`

Expected: PASS.

Run: `pnpm test:failure`

Expected: PASS.

- [ ] **Step 5: Sign the beta checklist and commit**

The checklist records command outputs, Railway release IDs, restore timestamps, EAS builds, open P0/P1 issue count, security/accessibility results, on-call owner, and beta-team support channel. The gate fails if any P0 or P1 issue remains unresolved.

```bash
git add docs/operations docs/release .github/workflows/ci.yml
git commit -m "docs: certify PuckFlow beta readiness"
```

---

## GitHub issue manifest

### 1. Harden API security boundaries and secret redaction

- **Issue:** [#7](https://github.com/marknotfound/puckflow/issues/7)
- **Labels:** `type:security`, `area:api`, `priority:p0`
- **Depends on:** [#6](https://github.com/marknotfound/puckflow/issues/6)
- **Plan tasks:** Task 1
- **Body:** Enforce route-class rate limits, body/security defaults, upload verification, allowlist-based redaction, dependency scanning, and safe Problem Details at every API boundary.
- **Acceptance criteria:** Security regression suites pass; logs/audit contain no known secrets or raw email; write/invite/upload throttles return conforming errors.

### 2. Complete production observability and incident runbooks

- **Issue:** [#8](https://github.com/marknotfound/puckflow/issues/8)
- **Labels:** `type:chore`, `area:ops`, `priority:p0`
- **Depends on:** [#6](https://github.com/marknotfound/puckflow/issues/6)
- **Plan tasks:** Task 2
- **Body:** Add release-correlated Sentry and structured telemetry, separate liveness/readiness, dead-letter diagnostics, uptime monitoring, alerts, and actionable incident procedures.
- **Acceptance criteria:** Observability tests pass and every defined alert maps to a tested first-response runbook.

### 3. Prove load and failure recovery behavior

- **Issue:** [#9](https://github.com/marknotfound/puckflow/issues/9)
- **Labels:** `type:test`, `area:notifications`, `area:platform`, `priority:p0`
- **Depends on:** [#7](https://github.com/marknotfound/puckflow/issues/7), [#8](https://github.com/marknotfound/puckflow/issues/8)
- **Plan tasks:** Task 3
- **Body:** Exercise provider outages, worker restarts, duplicate sweeps/execution, deployment overlap, and production-sized API/job load without adding Redis.
- **Acceptance criteria:** Failure suites pass, k6 exits 0, no corruption or duplicate logical sends occur, and a dated capacity baseline is committed.

### 4. Complete accessibility, dark mode, and adaptive-layout review

- **Issue:** [#10](https://github.com/marknotfound/puckflow/issues/10)
- **Labels:** `type:test`, `area:mobile`, `area:web`, `priority:p1`
- **Depends on:** [#6](https://github.com/marknotfound/puckflow/issues/6)
- **Plan tasks:** Task 4
- **Body:** Automate and manually review critical web/mobile flows for accessibility, semantic dark mode, dynamic type, touch targets, keyboard use, and iPad adaptation.
- **Acceptance criteria:** Automated suites pass; manual VoiceOver, TalkBack, keyboard, zoom, dynamic-type, dark-mode, and iPad results are recorded with no unresolved P0/P1 failures.

### 5. Configure EAS preview and internal-store delivery

- **Issue:** [#11](https://github.com/marknotfound/puckflow/issues/11)
- **Labels:** `type:chore`, `area:mobile`, `area:ops`, `priority:p1`
- **Depends on:** [#10](https://github.com/marknotfound/puckflow/issues/10)
- **Plan tasks:** Task 5
- **Body:** Finalize Expo identifiers/runtime policy, protected EAS profiles and workflow, preview builds, TestFlight, and Play internal delivery.
- **Acceptance criteria:** iOS and Android preview builds install and pass smoke tests; internal submissions are recorded without credentials in source or logs.

### 6. Verify Railway recovery and certify beta readiness

- **Issue:** [#12](https://github.com/marknotfound/puckflow/issues/12)
- **Labels:** `type:security`, `area:data`, `area:ops`, `priority:p0`
- **Depends on:** [#9](https://github.com/marknotfound/puckflow/issues/9), [#11](https://github.com/marknotfound/puckflow/issues/11)
- **Plan tasks:** Task 6
- **Body:** Verify protected production delivery, perform a non-cutover PITR restore drill, document cutover/rollback, run the entire repository gate, and sign the beta checklist.
- **Acceptance criteria:** Restore evidence and full test/build outputs are recorded; backups/PITR/uptime are healthy; no P0/P1 issue remains open.
