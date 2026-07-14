# PuckFlow Implementation Planning Handoff

**Date:** July 13, 2026
**Repository:** `marknotfound/puckflow`
**Local checkout:** `/Users/mark/workspace/puckflow`
**Current branch:** `main`
**Purpose:** Preserve the implementation-planning decisions, tracker graph, and completed planning handoff without reconstructing the preceding design conversation.

---

## 0. Completion status

The implementation-planning work described below is complete. The historical findings and requested sequence remain as evidence of what was reviewed; this section supersedes their earlier “still to do” language.

- All five milestone plans were reconciled and the master plan was added at [`docs/superpowers/plans/2026-07-13-puckflow-mvp-master.md`](../superpowers/plans/2026-07-13-puckflow-mvp-master.md).
- Milestone 0 uses Railway Railpack for API, web, worker, and cron; there are no application Dockerfiles in the plan.
- Local PostgreSQL is pinned to the verified official `postgres:17.10-alpine3.24` image.
- The exact dependency ledger was checked against official documentation, Expo's SDK ledger, and current package registries on July 13, 2026; compatibility-driven selections are documented in M0 and the master plan.
- All five embedded issue manifests use the actual GitHub label taxonomy and link their real issue numbers.
- Cross-milestone migration numbers, route roots, worker/cron entrypoints, shared types, error helpers, audit/outbox contracts, commands, and deferred-scope boundaries were normalized.
- All 34 existing issue dependency sections now link the authoritative prerequisite issue numbers.
- A live tracker audit verified 34 open issues with the expected labels, milestones, and dependency links. No issue, label, or milestone was recreated.
- No implementation code was started and nothing was pushed.

---

## 1. User request in force

The user approved the revised MVP design and then asked:

> For implementation plan, use subagents to spread out the context and create GitHub issues against the repo. Use GitHub milestones and labels to make it easy to track progress.

At the time this handoff was first written, the implementation-planning work was drafted but not fully reviewed or committed. The completion status above records the finished state.

Do not begin implementation code. Finish and verify the plans and tracker first.

---

## 2. Approved product and architecture decisions

The canonical approved design is:

- [`docs/puckflow-mvp-plan.md`](../puckflow-mvp-plan.md)
- Local commit: `92915e4 docs: revise MVP plan for Railway`

Key decisions that must not drift:

- Railway hosts web, API, worker, cron, Postgres, and private object storage.
- Clerk, FCM/APNs, Resend, Sentry, and EAS remain external services.
- The product is team-first. Leagues are a post-MVP expansion.
- RSVP is MVP with exactly `going`, `not_going`, and `unknown`.
- Games are team-owned and use opponent-name snapshots.
- Scoring is post-game, not live or offline.
- Final scores are authoritative.
- Optional goal detail may be partial.
- Goal detail may include period, time remaining, scorer, primary assist, secondary assist, and strength.
- Goal strength is even strength, power play, or short-handed.
- Goal time means **time remaining**.
- Team record is `W-L-T`; outcome and decision method are stored separately.
- Managers exclusively control user-to-player links.
- Public profiles are deferred.
- Notifications are narrow: game scheduling/changes/cancellation and one approximate 24-hour RSVP reminder; invitation/account-critical email only.
- Avatars are cropped/compressed on clients and validated server-side.
- Audit is minimal and security-focused.
- Production deploys directly from protected `main`; there is no staging branch or Railway staging environment.
- Post-MVP decisions must stay recorded in the decision register.

---

## 3. Local Git state

At handoff creation:

```text
## main...origin/main [ahead 1]
?? docs/superpowers/
```

Relevant history:

```text
92915e4 (HEAD -> main) docs: revise MVP plan for Railway
8476934 (origin/main, origin/HEAD) Initial commit
```

Important consequences:

- The approved MVP plan is committed locally but has **not been pushed**.
- The five implementation plan files are untracked.
- This handoff file is also untracked until the next agent stages/commits it.
- Do not push unless the user authorizes or the active workflow clearly includes publishing the plan changes.

---

## 4. Skills and workflow already applied

The prior agent read and followed:

- `superpowers:writing-plans`
- `superpowers:dispatching-parallel-agents`
- `github:github`

The user explicitly requested subagents, so three parallel agents drafted Milestones 0-2. The root agent drafted Milestones 3-4.

Before claiming completion, the next agent must use:

- `superpowers:verification-before-completion`

If implementation begins later, the plan headers require either:

- `superpowers:subagent-driven-development` (recommended), or
- `superpowers:executing-plans`

---

## 5. Draft implementation plans

All paths are under `docs/superpowers/plans/`:

1. `2026-07-13-puckflow-m0-foundations.md`
   - 1,050 lines
   - Drafted and self-reviewed by subagent `/root/m0_foundations`
   - 14 detailed TDD tasks
   - 6 GitHub issue manifests

2. `2026-07-13-puckflow-m1-teams-rosters.md`
   - 1,551 lines
   - Drafted and self-reviewed by subagent `/root/m1_teams_rosters`
   - 10 detailed TDD tasks
   - 8 GitHub issue manifests

3. `2026-07-13-puckflow-m2-games-rsvp.md`
   - 1,233 lines
   - Drafted and self-reviewed by subagent `/root/m2_games_rsvp`
   - 9 detailed TDD tasks
   - 8 GitHub issue manifests

4. `2026-07-13-puckflow-m3-results-stats.md`
   - 618 lines
   - Drafted by the root agent
   - 7 detailed TDD tasks
   - 6 GitHub issue manifests
   - Still needs full cross-plan self-review

5. `2026-07-13-puckflow-m4-beta-hardening.md`
   - 445 lines
   - Drafted by the root agent
   - 6 detailed TDD tasks
   - 6 GitHub issue manifests
   - Still needs full cross-plan self-review

No master implementation-plan index has been written yet. Create one at:

`docs/superpowers/plans/2026-07-13-puckflow-mvp-master.md`

It should include:

- The required writing-plans header.
- The five milestone sequence.
- Links to all five detailed plan files.
- GitHub milestone and issue links.
- The exact dependency graph from Section 8 below.
- Milestone exit criteria copied from the approved MVP plan.
- Global package/path/interface naming contracts.
- A clear execution handoff.

---

## 6. Known plan defects to fix first

### 6.1 M0 incorrectly introduced custom Dockerfiles

The approved architecture explicitly excludes custom containers where Railway Railpack suffices. The M0 draft currently creates:

- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `apps/worker/Dockerfile`
- `apps/cron/Dockerfile`

It also contains `docker build` verification steps and Railway configuration that points to those Dockerfiles.

This was discovered immediately before the user requested this handoff. **No correction was applied.**

Fix M0 to use Railpack:

- Remove all four application Dockerfiles from the file map and task steps.
- Keep Docker Compose only for local Postgres.
- Set each `railway.toml` builder to `RAILPACK`.
- Give every service an explicit build and start command.
- Replace application-image build checks with package production-build checks and Railway configuration validation.
- Keep exactly one migration owner: the API pre-deploy command.
- Update issue-manifest acceptance criteria that mention images or containers.

Suggested Railpack service commands:

| Service | Build | Start |
|---|---|---|
| API | `pnpm --filter @puckflow/api build` | `node apps/api/dist/server.js` |
| Web | `pnpm --filter @puckflow/web build` | `pnpm --filter @puckflow/web start` |
| Worker | `pnpm --filter @puckflow/worker build` | `node apps/worker/dist/server.js` |
| Cron | `pnpm --filter @puckflow/cron build` | `node apps/cron/dist/main.js` |

### 6.2 M0 pins a stale local Postgres patch

The draft pins `postgres:17.5-alpine3.22`. Current official Docker tags observed during review include `postgres:17.10-alpine3.23` and `postgres:17.10-alpine3.24`.

Choose one current official exact tag after verifying it, then replace all `17.5` references consistently in M0. Keep Postgres major 17 unless Railway or a compatibility check requires a different major.

### 6.3 Version ledger needs a final executable check

The M0 agent created an exact dependency ledger. Some versions were verified during drafting, including Node 24.18.0, TypeScript 7.0.2, and Expo SDK 57 / React Native 0.86. Still run a final registry compatibility check before accepting all pins, especially:

- pnpm and Corepack behavior
- Expo package versions installed through `expo install`
- Clerk package compatibility with Next.js 16 and Expo 57
- Jest / jest-expo / React Native Testing Library compatibility
- ESLint 10 and `typescript-eslint` compatibility

Do not blindly preserve an exact version merely because it appears in the draft.

### 6.4 Agent issue-manifest labels are inconsistent

The GitHub issues themselves were created with the normalized real labels, but the embedded manifests in M0-M2 still mention nonexistent labels such as:

- `area:tooling`
- `area:core`
- `area:database`
- `area:operations`
- `area:worker`
- `area:cron`
- `area:api-client`
- `area:security`
- `area:recovery`
- `area:roster`
- `area:email`
- `area:audit`
- `area:accessibility`
- `infra:railway`
- labels with spaces such as `type: feature`

Normalize all plan manifests to the actual taxonomy in Section 7.

### 6.5 Cross-plan contract review is incomplete

Review all five plans for:

- Exact package names and paths.
- API route and service interface consistency.
- Drizzle schema and repository naming consistency.
- Shared audit/outbox/job types.
- M1 outputs matching M2 assumptions.
- M2 game shape matching M3 result extensions.
- M3 completeness semantics matching web/mobile copy.
- M4 commands that actually exist in earlier plans.
- No reintroduction of deferred features.
- No placeholder language prohibited by `writing-plans`.

---

## 7. GitHub tracker state

GitHub repository: <https://github.com/marknotfound/puckflow>

### Milestones

All five milestones were created successfully:

1. `M0 — Walking Skeleton`
2. `M1 — Teams & Rosters`
3. `M2 — Games & RSVP`
4. `M3 — Results & Recorded Stats`
5. `M4 — Beta Hardening`

### Custom labels

These 20 labels were created successfully:

```text
type:feature
type:chore
type:security
type:test
type:docs
area:platform
area:api
area:web
area:mobile
area:data
area:auth
area:teams
area:media
area:games
area:notifications
area:stats
area:ops
priority:p0
priority:p1
priority:p2
```

Default GitHub labels remain untouched.

### GitHub tool behavior

- The connected GitHub app can read issues but returned HTTP 403 for issue creation.
- The CLI works when run outside the sandbox with escalation.
- Labels and milestones were created with `gh api`.
- Issues were created with `gh issue create`.
- Inside-sandbox `gh auth status` reported a stale token, but escalated CLI commands succeeded.

Useful commands:

```bash
gh api 'repos/marknotfound/puckflow/milestones?state=open'
gh api repos/marknotfound/puckflow/labels --paginate
gh issue list --repo marknotfound/puckflow --limit 100
```

---

## 8. GitHub issues and dependency graph

All 34 issues were created and assigned to their milestone and normalized labels.

### Milestone 0: issues #13-#18

- #13 Bootstrap pinned monorepo and shared contracts
- #14 Add Postgres identity and operational foundations
- #15 Deliver authenticated Express API and Clerk synchronization
- #16 Add deployable worker and cron skeletons
- #17 Connect signed-in web and mobile clients to `/v1/me`
- #18 Gate and operate the production walking skeleton

Dependencies:

```text
#13 → #14 → #15 → #17 ┐
       └────→ #16 ────┴→ #18
```

### Milestone 1: issues #19-#26

- #19 Define Milestone 1 team and roster domain contracts
- #20 Deliver authorized team CRUD
- #21 Add secure invitations and membership lifecycle
- #22 Add transactional ownership transfer and team deletion safeguards
- #23 Deliver roster CRUD and manager-controlled player linkage
- #24 Add private Railway Bucket avatar pipeline
- #25 Build web teams, rosters, avatars, and switching
- #26 Build mobile teams, rosters, avatars, switching, and acceptance proof

Dependencies:

```text
#18 → #19 → #20 → #21 → #22
             ├────→ #23 ─┐
             └→ #21 → #24 ├→ #25 → #26
```

### Milestone 2: issues #27-#34

- #27 Define M2 game, RSVP, and push domain contracts
- #28 Persist seasons, games, attendance, and notification operations
- #29 Ship season and game scheduling APIs
- #30 Ship RSVP, team mute, and device-token APIs
- #31 Deliver durable game push notifications from the worker
- #32 Schedule idempotent approximately-24-hour RSVP reminders
- #33 Build typed clients and responsive web scheduling and attendance
- #34 Build mobile games and push lifecycle, then prove M2 operations

Dependencies:

```text
#26 → #27 → #28 → #29 ─┬→ #31 ─┐
                    └→ #30 ─┬→ #31 │
                            ├→ #32 ├→ #34
             #29 + #30 ────→ #33 ─┘
```

### Milestone 3: issues #1-#6

- #1 Define result, goal, and statistics domain contracts
- #2 Persist authoritative results and optional goal details
- #3 Add transactional result, goal, and statistics APIs
- #4 Build web post-game result and statistics flows
- #5 Build mobile post-game result and statistics flows
- #6 Verify the Milestone 3 result and statistics vertical slice

Dependencies:

```text
#34 → #1 → #2 → #3 ─┬→ #4 ─┐
                     └→ #5 ─┴→ #6
```

### Milestone 4: issues #7-#12

- #7 Harden API security boundaries and secret redaction
- #8 Complete production observability and incident runbooks
- #9 Prove load and failure recovery behavior
- #10 Complete accessibility, dark mode, and adaptive-layout review
- #11 Configure EAS preview and internal-store delivery
- #12 Verify Railway recovery and certify beta readiness

Dependencies:

```text
#6 ─┬→ #7 ─┐
    ├→ #8 ─┴→ #9 ──────────┐
    └→ #10 → #11 ──────────┴→ #12
```

Issue URLs follow:

`https://github.com/marknotfound/puckflow/issues/<number>`

### Dependency-link cleanup

Most issue bodies name dependencies by title. For easier navigation, update them to use issue-number links according to the graph above. In particular:

- #1 should depend on #34.
- #3 should link #2.
- #4 and #5 should link #3.
- #6 should link #4 and #5.
- #7, #8, and #10 should link #6.
- #9 should link #7 and #8.
- #11 should link #10.
- #12 should link #9 and #11.

The earlier milestone issues should also be normalized to number links where they currently use titles.

---

## 9. Recommended next sequence

1. Read `docs/puckflow-mvp-plan.md` completely.
2. Read this handoff completely.
3. Fix M0 Railpack and Postgres issues before any other editing.
4. Verify the dependency ledger against current official registries/docs.
5. Normalize issue-manifest labels in all five plans.
6. Review cross-plan interfaces and commands.
7. Write the master plan index with issue links and dependency graph.
8. Update GitHub issue dependency text to use issue numbers.
9. Run the writing-plans self-review:
   - spec coverage
   - placeholder scan
   - type/signature consistency
10. Run `git diff --check` and inspect every untracked plan.
11. Verify all 34 GitHub issues, milestone assignments, and labels.
12. Commit the plans only after the written plan set is coherent.
13. Ask the user to choose execution mode:
   - Subagent-driven (recommended)
   - Inline execution

Do not claim the implementation plan is complete until the local plans and remote tracker both pass verification.

---

## 10. Quick verification commands

```bash
git status --short --branch
git diff --check
rg -n 'TBD|TODO|FIXME|implement later|appropriate error handling|write tests for the above|similar to Task' docs/superpowers/plans
rg -n 'Dockerfile|docker build|postgres:17\.5|area:tooling|area:core|area:database|type: feature' docs/superpowers/plans
wc -l docs/puckflow-mvp-plan.md docs/superpowers/plans/*.md
```

GitHub verification requires network access:

```bash
gh issue list --repo marknotfound/puckflow --state open --limit 100
gh api 'repos/marknotfound/puckflow/milestones?state=open'
gh api repos/marknotfound/puckflow/labels --paginate
```

Expected tracker totals:

- 34 open implementation issues
- 5 open milestones
- 20 custom tracking labels, plus GitHub defaults

---

## 11. Subagent outputs

The three subagents completed successfully and reported:

- M0: placeholder, naming-consistency, and whitespace checks passed within that plan.
- M1: `git diff --check` passed and no implementation files were changed.
- M2: placeholder and whitespace scans passed.

Those are local plan reviews, not substitutes for the cross-plan review described above.
