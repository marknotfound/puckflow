# PuckFlow Milestone 1 Teams and Rosters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver secure team, membership, invitation, ownership, roster, avatar, and multi-team workflows on web and mobile so a real manager can create a team, invite users, represent non-user players, and control user/player links.

**Architecture:** Extend the Milestone 0 monorepo with pure Zod contracts and policies in `@puckflow/core`, transactional Drizzle repositories in `@puckflow/db`, and thin Express routes backed by team, invitation, roster, and media services. Web and mobile consume the same `@puckflow/api-client` projections and selection rules but keep platform-native navigation, image normalization, and UI. Team access is always resolved on the API; clients use role checks only to hide unavailable controls.

**Tech Stack:** Milestone 0-pinned Node.js LTS and pnpm, TypeScript, Express, Zod, Drizzle ORM, PostgreSQL, Vitest, Supertest, Clerk JWT middleware, Next.js App Router, React Native, Expo Router, Expo Image Picker/Manipulator 57.0.2, AsyncStorage 2.2.0, Railway private S3-compatible Bucket, AWS S3 SDK 3.1086.0, file-type 22.0.1, Sharp 0.35.3, Web Canvas, Testing Library, Playwright 1.61.1.

## Global Constraints

- Scope is only Milestone 1: teams, memberships, invitations, roles, ownership transfer/deletion, roster players, manager-controlled user/player links, avatars, and multi-team switching.
- Do not add seasons, games, RSVP, results, goals, notifications beyond invitation email outbox creation, public profiles, leagues, payments, deep links through installation, or user-driven player claiming.
- Use the Node.js LTS release and `packageManager` version already pinned by Milestone 0; do not change either in this milestone.
- Use UUIDv7 primary keys for application-owned entities and UTC timestamps in storage.
- Team roles are exactly `owner`, `manager`, and `member`; invitations grant `member` only.
- A team has exactly one active owner after every committed mutation. Ownership transfer demotes the old owner and promotes the target member in one transaction.
- Owners alone grant or revoke manager, transfer ownership, and delete a team. Owners and managers edit team profiles, manage invitations, manage roster players and links, and remove ordinary members. Nobody can remove the sole owner.
- Only owners and managers link or unlink users and roster players. A user may have at most one active player per team, and may be a member without being a player.
- Removing a membership unlinks its user from the roster without deleting the player or historical references.
- Private team, member, and roster projections require active membership. Invisible resources return `404`; visible but unauthorized actions return `403`.
- Public invitation projections contain only team name, optional team avatar URL, role, and expiration state. They never contain email, user identifiers, secret digests, audit data, or unrestricted database rows.
- Every non-2xx response is RFC 9457 `application/problem+json` and includes a stable application code and request ID.
- Invitation tokens are high entropy, codes are human-enterable, both expire and are use-limited, and the invitation table stores only digests. When email delivery is requested, the token and fallback code exist at rest only inside an AES-256-GCM sealed outbox payload. Invite acceptance and upload issuance use Milestone 0 rate limiting.
- Sensitive writes append allowlisted audit records in the same transaction: membership addition/removal/role change, ownership transfer, player creation/removal/link change, and team deletion.
- Avatar output is a square, orientation-normalized JPEG or WebP, no larger than `512 x 512`, and no larger than `1 MiB` (`1_048_576` bytes). The server independently verifies bytes, MIME type, dimensions, ownership, and object key before attachment.
- Railway Bucket objects remain private. Authenticated reads go through an authorized API media endpoint; a valid invitation may read only that invited team's current avatar.
- A team avatar read requires the asset to be the team's current attached avatar and the viewer to be an active member. A user avatar read requires the asset to be that user's current attached avatar and the viewer to be that user or share at least one active team with that user.
- Keep mobile targets at least 44 points, support semantic colors and dark mode, and use virtualized roster/team lists.
- All database mutations that combine domain state, audits, and outbox events use one transaction. Never serialize a Drizzle row directly as an API response.
- Apply expand-and-contract migration discipline and retain compatibility with the immediately previous application revision during deployment overlap.
- Every implementation step follows red-green-refactor: focused failing test, observed expected failure, minimal production change, focused pass, broader regression check, then commit.

## Milestone 0 Interfaces Consumed

The implementation worker must verify these contracts before Task 1. If Milestone 0 names differ, make a single mechanical rename in this plan's paths and imports before implementation; behavior and boundaries are fixed.

```ts
// packages/db/src/client.ts
export type Database = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export function createDatabase(url: string): Database;
export function closeDatabase(database: Database): Promise<void>;

// apps/api/src/auth/require-auth.ts
export type AuthenticatedUser = { id: string; clerkId: string };
export type AuthenticatedRequest = Request & { user: AuthenticatedUser; requestId: string };
export const requireAuth: RequestHandler;

// apps/api/src/http/validate.ts
export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler;
export function validateParams<T extends ZodTypeAny>(schema: T): RequestHandler;

// apps/api/src/http/problem.ts
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

// packages/db/src/repositories/audit.ts
export function appendAudit(tx: DbTransaction, input: {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  teamId: string | null;
  requestId: string;
  changes: Record<string, unknown>;
  allowedChangeKeys: readonly string[];
}): Promise<void>;

// packages/db/src/repositories/outbox.ts
export function enqueueOutbox(tx: DbTransaction, input: {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  teamId: string | null;
  actorUserId: string | null;
  payload: JsonObject;
  requestId: string;
  occurredAt: Date;
}): Promise<void>;

// packages/api-client/src/transport.ts
export interface ApiTransport {
  request<T>(input: {
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    path: string;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<T>;
}

// apps/api/src/app.ts and package scripts
export function createApp(deps?: Partial<AppDependencies>): Express;
// `pnpm test`, `pnpm typecheck`, and `pnpm lint` run all workspaces.
// API integration tests receive `TEST_DATABASE_URL` and reset through the M0 test harness.
```

## Exact File Map

| Path | Change | Single responsibility |
|---|---|---|
| `packages/core/src/teams/contracts.ts` | Create | Team, membership, invitation request/response Zod schemas and inferred types |
| `packages/core/src/teams/policies.ts` | Create | Pure role/visibility/action authorization decisions |
| `packages/core/src/teams/invitations.ts` | Create | Token/code generation, normalization, digesting, and expiration/use checks |
| `packages/core/src/rosters/contracts.ts` | Create | Player CRUD/link schemas and projections |
| `packages/core/src/rosters/policies.ts` | Create | Pure roster/link permission checks |
| `packages/core/src/media/avatar.ts` | Create | Shared avatar constants, upload/complete schemas, media projections |
| `packages/core/src/team-selection.ts` | Create | Deterministic active-team selection rule shared by clients |
| `packages/core/src/events/events.ts` | Create | Canonical domain-event union beginning with encrypted `team.invitation` delivery |
| `packages/core/src/index.ts` | Modify | Export Milestone 1 contracts and pure functions |
| `packages/core/src/**/*.test.ts` | Create | Unit coverage for all Milestone 1 contracts and policies |
| `packages/db/src/schema/teams.ts` | Create | Drizzle tables and indexes for teams, memberships, invitations, and players |
| `packages/db/src/schema/index.ts` | Modify | Export team/roster tables to the database schema |
| `packages/db/src/repositories/teams-repository.ts` | Create | Authorized-scope-safe team and membership persistence |
| `packages/db/src/repositories/invitations-repository.ts` | Create | Invitation lookup, creation, redemption, and revocation persistence |
| `packages/db/src/repositories/players-repository.ts` | Create | Roster CRUD and user-link persistence |
| `packages/db/src/repositories/media-repository.ts` | Create | Pending/ready media state and owner attachment persistence |
| `packages/db/drizzle/0001_teams_rosters.sql` | Create | Add team, membership, invitation, player, and media constraints/indexes |
| `packages/db/src/testing/teams-rosters-migration.integration.test.ts` | Create | Empty/prior-schema migration and database invariant tests |
| `apps/api/src/auth/team-scope.ts` | Create | Resolve active membership and expose authorized team scope |
| `apps/api/src/services/team-service.ts` | Create | Team CRUD, membership role/removal, transfer, deletion transactions |
| `apps/api/src/services/invitation-service.ts` | Create | Secure invite creation/preview/acceptance transactions |
| `apps/api/src/services/player-service.ts` | Create | Roster CRUD and link/unlink transactions |
| `apps/api/src/services/media-service.ts` | Create | Presigned upload, independent verification, attachment, authorized reads |
| `apps/api/src/storage/railway-bucket.ts` | Create | Narrow private Bucket interface and AWS SDK adapter |
| `apps/api/src/routes/teams.ts` | Create | Team/member/ownership REST endpoints |
| `apps/api/src/routes/invitations.ts` | Create | Public preview/avatar and authenticated invite endpoints |
| `apps/api/src/routes/players.ts` | Create | Roster and user-link REST endpoints |
| `apps/api/src/routes/media.ts` | Create | Upload issuance/completion and authorized media reads |
| `apps/api/src/routes/index.ts` | Modify | Mount Milestone 1 routes below `/v1` |
| `apps/api/src/app.ts` | Modify | Inject services/Bucket dependencies and apply rate limits |
| `apps/api/test/teams.integration.test.ts` | Create | Team CRUD, roles, visibility, transfer, deletion, audit rollback |
| `apps/api/test/invitations.integration.test.ts` | Create | Invite link/code preview, accept, expiration/use limits, privacy, rate limit |
| `apps/worker/src/invitations/email.ts` | Create | Decrypt and deliver `team.invitation` jobs through Resend with idempotency |
| `apps/worker/src/invitations/email.test.ts` | Create | Ciphertext-at-rest, copy, retry, and redaction tests for invitation email |
| `apps/worker/src/handlers.ts` | Modify | Register the `team.invitation` job handler beside `system.smoke` |
| `apps/worker/src/config.ts` | Modify | Validate Resend and invitation-delivery secrets without logging them |
| `apps/api/test/players.integration.test.ts` | Create | Player CRUD/link constraints, unlink on member removal, audits |
| `apps/api/test/media.integration.test.ts` | Create | Upload authorization, object verification, attachment, private/public reads |
| `packages/api-client/src/teams.ts` | Create | Typed team/member/invitation client methods |
| `packages/api-client/src/players.ts` | Create | Typed roster/link client methods |
| `packages/api-client/src/media.ts` | Create | Platform-neutral three-stage avatar upload orchestration |
| `packages/api-client/src/index.ts` | Modify | Export Milestone 1 API client modules |
| `packages/api-client/src/*.test.ts` | Create | Paths, payloads, projections, and upload sequence tests |
| `apps/web/app/(app)/teams/page.tsx` | Create | Team list, empty state, and create entry point |
| `apps/web/app/(app)/teams/new/page.tsx` | Create | Team creation form |
| `apps/web/app/(app)/teams/[teamId]/layout.tsx` | Create | Membership guard, active team shell, and team navigation |
| `apps/web/app/(app)/teams/[teamId]/page.tsx` | Create | Team overview and invitation quick action |
| `apps/web/app/(app)/teams/[teamId]/roster/page.tsx` | Create | Virtualized roster list and manager controls |
| `apps/web/app/(app)/teams/[teamId]/members/page.tsx` | Create | Member roles, removal, invitation, ownership transfer |
| `apps/web/app/(app)/teams/[teamId]/settings/page.tsx` | Create | Team name/avatar update and owner deletion |
| `apps/web/app/(app)/settings/profile/page.tsx` | Create | Current-user display name and avatar update |
| `apps/web/app/join/[selector]/page.tsx` | Create | Privacy-safe invite preview and authenticated link acceptance |
| `apps/web/app/(app)/join/page.tsx` | Create | Human-enterable fallback-code acceptance |
| `apps/web/components/teams/team-switcher.tsx` | Create | Accessible route-based multi-team switcher |
| `apps/web/components/media/avatar-crop-dialog.tsx` | Create | Square crop interaction and preview |
| `apps/web/lib/media/normalize-avatar.ts` | Create | Orientation-safe Canvas export to the avatar contract |
| `apps/web/lib/team-selection.ts` | Create | Cookie-backed valid team selection adapter |
| `apps/web/test/teams-rosters.spec.ts` | Create | Playwright web smoke journey and access-control UI checks |
| `apps/web/**/*.test.tsx` | Create | Web component and avatar contract tests |
| `apps/mobile/app/(app)/teams/index.tsx` | Create | Native team list and create navigation |
| `apps/mobile/app/(app)/teams/new.tsx` | Create | Native team creation screen |
| `apps/mobile/app/(app)/teams/[teamId]/_layout.tsx` | Create | Native stack/team actions for the active team |
| `apps/mobile/app/(app)/teams/[teamId]/index.tsx` | Create | Team overview screen |
| `apps/mobile/app/(app)/teams/[teamId]/roster.tsx` | Create | FlatList roster screen and manager actions |
| `apps/mobile/app/(app)/teams/[teamId]/members.tsx` | Create | Member/invitation/ownership actions |
| `apps/mobile/app/(app)/teams/[teamId]/settings.tsx` | Create | Team profile/avatar/deletion screen |
| `apps/mobile/app/(app)/settings/profile.tsx` | Create | Current-user display name and avatar update |
| `apps/mobile/app/(app)/join.tsx` | Create | Human-enterable fallback-code acceptance |
| `apps/mobile/src/teams/team-provider.tsx` | Create | AsyncStorage-backed active-team state and reconciliation |
| `apps/mobile/src/teams/team-switcher.tsx` | Create | Accessible native team chooser |
| `apps/mobile/src/media/normalize-avatar.ts` | Create | Expo picker/manipulator normalization adapter |
| `apps/mobile/src/**/*.test.tsx` | Create | Native flows, selection, permissions, accessibility, avatar contract |

---

### Task 1: Freeze domain contracts, policies, invite secrets, and team selection

**Files:**
- Create: `packages/core/src/teams/contracts.ts`
- Create: `packages/core/src/teams/policies.ts`
- Create: `packages/core/src/teams/invitations.ts`
- Create: `packages/core/src/rosters/contracts.ts`
- Create: `packages/core/src/rosters/policies.ts`
- Create: `packages/core/src/media/avatar.ts`
- Create: `packages/core/src/team-selection.ts`
- Create: `packages/core/src/events/events.ts`
- Create: `packages/core/src/teams/contracts.test.ts`
- Create: `packages/core/src/teams/policies.test.ts`
- Create: `packages/core/src/teams/invitations.test.ts`
- Create: `packages/core/src/rosters/contracts.test.ts`
- Create: `packages/core/src/team-selection.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: M0 `ProblemCode`, UUID string schema, ISO timestamp schema, and `MediaAssetProjection` if already present.
- Produces: `TeamRole`, `TeamAction`, `TeamSummary`, `TeamDetail`, `MembershipProjection`, `InvitationPrivateProjection`, `InvitationPublicProjection`, `PlayerProjection`, all request schemas, `canTeam`, `canRoster`, `createInvitationSecrets`, `normalizeInviteCode`, `isInvitationUsable`, `sealInvitationDelivery`, `openInvitationDelivery`, the initial `team.invitation` domain event, avatar constants/schemas, and `selectActiveTeamId`.

- [ ] **Step 1: Write failing schema and policy tests**

```ts
it("permits only the documented role actions", () => {
  expect(canTeam("owner", "transfer_ownership")).toBe(true);
  expect(canTeam("manager", "edit_team")).toBe(true);
  expect(canTeam("manager", "change_roles")).toBe(false);
  expect(canTeam("member", "manage_invitations")).toBe(false);
  expect(canRoster("manager", "link_user")).toBe(true);
  expect(canRoster("member", "link_user")).toBe(false);
});

it("rejects manager-granting invitations", () => {
  expect(CreateInvitationBody.safeParse({ role: "manager" }).success).toBe(false);
});

it("keeps a valid selected team and otherwise chooses the first", () => {
  const teams = [{ id: "a" }, { id: "b" }];
  expect(selectActiveTeamId("b", teams)).toBe("b");
  expect(selectActiveTeamId("missing", teams)).toBe("a");
  expect(selectActiveTeamId(null, [])).toBeNull();
});
```

- [ ] **Step 2: Run the focused tests and observe the missing exports**

Run: `pnpm --filter @puckflow/core test -- teams/contracts.test.ts teams/policies.test.ts rosters/contracts.test.ts team-selection.test.ts`

Expected: FAIL with import/export errors for `canTeam`, `CreateInvitationBody`, `canRoster`, and `selectActiveTeamId`.

- [ ] **Step 3: Add exact enums, action matrices, and projections**

```ts
export const TeamRoleSchema = z.enum(["owner", "manager", "member"]);
export type TeamRole = z.infer<typeof TeamRoleSchema>;
export type TeamAction =
  | "view" | "edit_team" | "manage_invitations" | "manage_roster"
  | "link_user" | "remove_member" | "change_roles"
  | "transfer_ownership" | "delete_team";

const allowed: Record<TeamRole, ReadonlySet<TeamAction>> = {
  owner: new Set(["view", "edit_team", "manage_invitations", "manage_roster", "link_user", "remove_member", "change_roles", "transfer_ownership", "delete_team"]),
  manager: new Set(["view", "edit_team", "manage_invitations", "manage_roster", "link_user", "remove_member"]),
  member: new Set(["view"]),
};
export const canTeam = (role: TeamRole, action: TeamAction): boolean => allowed[role].has(action);
export type RosterAction = "create_player" | "edit_player" | "deactivate_player" | "link_user" | "unlink_user";
export const canRoster = (role: TeamRole, _action: RosterAction): boolean => role === "owner" || role === "manager";

export const TeamSummarySchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(80),
  avatar: AvatarProjectionSchema.nullable(), role: TeamRoleSchema,
});
export const TeamDetailSchema = TeamSummarySchema.extend({
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  permissions: z.array(z.string()),
});
export const MembershipProjectionSchema = z.object({
  id: z.string().uuid(), teamId: z.string().uuid(), role: TeamRoleSchema,
  user: z.object({ id: z.string().uuid(), displayName: z.string(), avatar: AvatarProjectionSchema.nullable() }),
  joinedAt: z.string().datetime(),
});
export const InvitationStateSchema = z.enum(["active", "expired", "exhausted", "revoked"]);
export const InvitationPrivateProjectionSchema = z.object({
  id: z.string().uuid(), teamId: z.string().uuid(), role: z.literal("member"),
  targetEmail: z.string().email().nullable(), expiresAt: z.string().datetime(),
  maxUses: z.number().int(), useCount: z.number().int(), state: InvitationStateSchema,
  acceptUrl: z.string().url(), fallbackCode: z.string(), createdAt: z.string().datetime(),
});
export const InvitationPublicProjectionSchema = z.object({
  teamName: z.string(), avatarUrl: z.string().url().nullable(), role: z.literal("member"),
  expiresAt: z.string().datetime(), state: InvitationStateSchema,
});
export const CreateTeamBody = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const UpdateTeamBody = CreateTeamBody.partial().refine((v) => Object.keys(v).length > 0);
export const CreateInvitationBody = z.object({
  role: z.literal("member").default("member"),
  targetEmail: z.string().email().max(320).optional(),
  expiresInHours: z.number().int().min(1).max(168).default(72),
  maxUses: z.number().int().min(1).max(50).default(1),
}).strict();
export const ChangeMemberRoleBody = z.object({ role: z.enum(["manager", "member"]) }).strict();
export const TransferOwnershipBody = z.object({ membershipId: z.string().uuid() }).strict();
```

- [ ] **Step 4: Add roster, avatar, and selection contracts**

```ts
export const PlayerStatusSchema = z.enum(["active", "inactive"]);
export const PlayerProjectionSchema = z.object({
  id: z.string().uuid(), teamId: z.string().uuid(), displayName: z.string(),
  jerseyNumber: z.string().max(4).nullable(), position: z.string().max(32).nullable(),
  status: PlayerStatusSchema,
  linkedUser: z.object({ id: z.string().uuid(), displayName: z.string(), avatar: AvatarProjectionSchema.nullable() }).nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export const CreatePlayerBody = z.object({
  displayName: z.string().trim().min(1).max(80),
  jerseyNumber: z.string().trim().max(4).nullable().default(null),
  position: z.string().trim().max(32).nullable().default(null),
}).strict();
export const UpdatePlayerBody = CreatePlayerBody.partial().extend({ status: PlayerStatusSchema.optional() })
  .refine((v) => Object.keys(v).length > 0);
export const PutPlayerUserLinkBody = z.object({ userId: z.string().uuid() }).strict();

export const AVATAR_MAX_DIMENSION = 512;
export const AVATAR_MAX_BYTES = 1_048_576;
export const AvatarMimeSchema = z.enum(["image/jpeg", "image/webp"]);
export const AvatarProjectionSchema = z.object({
  id: z.string().uuid(), url: z.string(), mimeType: AvatarMimeSchema,
  width: z.number().int().positive(), height: z.number().int().positive(),
  byteSize: z.number().int().positive(), updatedAt: z.string().datetime(),
});
export const RequestAvatarUploadBody = z.object({
  ownerType: z.enum(["user", "team"]), ownerId: z.string().uuid(),
  mimeType: AvatarMimeSchema, byteSize: z.number().int().positive().max(AVATAR_MAX_BYTES),
  width: z.number().int().positive().max(AVATAR_MAX_DIMENSION),
  height: z.number().int().positive().max(AVATAR_MAX_DIMENSION),
}).strict().refine((v) => v.width === v.height, { path: ["height"], message: "Avatar must be square" });
export const AvatarUploadProjectionSchema = z.object({
  asset: z.object({ id: z.string().uuid(), status: z.literal("pending") }),
  upload: z.object({
    url: z.string().url(), fields: z.record(z.string(), z.string()),
    maxBytes: z.literal(AVATAR_MAX_BYTES), expiresAt: z.string().datetime(),
  }),
});

export function selectActiveTeamId<T extends { id: string }>(preferred: string | null, teams: readonly T[]): string | null {
  return teams.some((team) => team.id === preferred) ? preferred : teams[0]?.id ?? null;
}
```

- [ ] **Step 5: Implement secret creation without storing plaintext**

```ts
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function digestInvitationSecret(secret: string, pepper: string): string {
  return createHmac("sha256", pepper).update(secret).digest("hex");
}
export function createInvitationSecrets(pepper: string): {
  token: string; tokenDigest: string; code: string; codeDigest: string;
} {
  const token = randomBytes(32).toString("base64url");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rawCode = Array.from(randomBytes(8), (byte) => alphabet[byte & 31]).join("");
  const code = `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;
  return { token, tokenDigest: digestInvitationSecret(token, pepper), code, codeDigest: digestInvitationSecret(normalizeInviteCode(code), pepper) };
}
export function isInvitationUsable(invite: { expiresAt: Date; useCount: number; maxUses: number; revokedAt: Date | null }, now: Date): boolean {
  return invite.revokedAt === null && invite.expiresAt.getTime() > now.getTime() && invite.useCount < invite.maxUses;
}

export type InvitationDelivery = {
  invitationId: string; teamId: string; recipient: string; token: string; fallbackCode: string;
};
export type SealedInvitationDelivery = {
  algorithm: 'aes-256-gcm'; iv: string; ciphertext: string; authTag: string;
};
export function sealInvitationDelivery(value: InvitationDelivery, key: Uint8Array): SealedInvitationDelivery {
  if (key.byteLength !== 32) throw new Error('INVITATION_DELIVERY_KEY must decode to 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { algorithm: 'aes-256-gcm', iv: iv.toString('base64url'), ciphertext: ciphertext.toString('base64url'), authTag: cipher.getAuthTag().toString('base64url') };
}
export function openInvitationDelivery(value: SealedInvitationDelivery, key: Uint8Array): InvitationDelivery {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(value.authTag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64url')), decipher.final()]).toString('utf8')) as InvitationDelivery;
}
```

- [ ] **Step 6: Run core tests, typecheck, and commit**

Run: `pnpm --filter @puckflow/core test && pnpm --filter @puckflow/core typecheck`

Expected: all core tests PASS and TypeScript reports zero errors.

```bash
git add packages/core/src
git commit -m "feat(core): define team and roster contracts"
```

---

### Task 2: Add team, membership, invitation, player, and media persistence

**Files:**
- Create: `packages/db/src/schema/teams.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/repositories/teams-repository.ts`
- Create: `packages/db/src/repositories/invitations-repository.ts`
- Create: `packages/db/src/repositories/players-repository.ts`
- Create: `packages/db/src/repositories/media-repository.ts`
- Create: `packages/db/drizzle/0001_teams_rosters.sql`
- Create: `packages/db/src/testing/teams-rosters-migration.integration.test.ts`

**Interfaces:**
- Consumes: M0 `users`, `Database`, `DbTransaction`, UUIDv7 helper, migration/test harness.
- Produces: `teams`, `teamMemberships`, `invitations`, `players`, `mediaAssets`; repository factories `createTeamsRepository`, `createInvitationsRepository`, `createPlayersRepository`, `createMediaRepository`; unique indexes enforcing one owner and one active linked player per team.

- [ ] **Step 1: Write database invariant tests**

```ts
it("rejects a second active owner", async () => {
  await seedMembership({ teamId, userId: ownerA, role: "owner" });
  await expect(seedMembership({ teamId, userId: ownerB, role: "owner" }))
    .rejects.toMatchObject({ code: "23505", constraint: "team_memberships_one_owner_idx" });
});

it("allows only one active player link per user and team", async () => {
  await seedPlayer({ teamId, linkedUserId: memberId, status: "active" });
  await expect(seedPlayer({ teamId, linkedUserId: memberId, status: "active" }))
    .rejects.toMatchObject({ code: "23505", constraint: "players_one_active_user_link_idx" });
});
```

- [ ] **Step 2: Run the migration test and observe missing relations**

Run: `pnpm --filter @puckflow/db test:integration -- teams-rosters-migration.integration.test.ts`

Expected: FAIL because `teams`, `team_memberships`, `invitations`, and `players` do not exist.

- [ ] **Step 3: Add the checked-in migration with structural invariants**

```sql
CREATE TYPE team_role AS ENUM ('owner', 'manager', 'member');
CREATE TYPE player_status AS ENUM ('active', 'inactive');
CREATE TYPE media_owner_type AS ENUM ('user', 'team');

CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  owner_type media_owner_type NOT NULL,
  owner_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE,
  mime_type text,
  width integer,
  height integer,
  byte_size integer,
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'rejected')),
  uploader_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id uuid PRIMARY KEY,
  name varchar(80) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  avatar_asset_id uuid REFERENCES media_assets(id),
  creator_user_id uuid NOT NULL REFERENCES users(id),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE team_memberships (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role team_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  UNIQUE (team_id, user_id)
);
CREATE UNIQUE INDEX team_memberships_one_owner_idx
  ON team_memberships(team_id) WHERE role = 'owner' AND removed_at IS NULL;
CREATE TABLE invitations (
  id uuid PRIMARY KEY, team_id uuid NOT NULL REFERENCES teams(id),
  target_role team_role NOT NULL DEFAULT 'member' CHECK (target_role = 'member'),
  token_digest char(64) NOT NULL UNIQUE, code_digest char(64) NOT NULL UNIQUE,
  target_email varchar(320), expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 50),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count BETWEEN 0 AND max_uses),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE players (
  id uuid PRIMARY KEY, team_id uuid NOT NULL REFERENCES teams(id),
  linked_user_id uuid REFERENCES users(id), display_name varchar(80) NOT NULL,
  jersey_number varchar(4), position varchar(32), status player_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX players_one_active_user_link_idx
  ON players(team_id, linked_user_id)
  WHERE linked_user_id IS NOT NULL AND status = 'active';
CREATE INDEX media_assets_owner_idx ON media_assets(owner_type, owner_id, status);
```

- [ ] **Step 4: Implement narrow repository contracts**

```ts
export interface TeamsRepository {
  insertTeam(input: NewTeam): Promise<TeamRow>;
  insertMembership(input: NewMembership): Promise<MembershipRow>;
  listForUser(userId: string): Promise<TeamSummaryRow[]>;
  findVisible(teamId: string, userId: string): Promise<TeamScopeRow | null>;
  updateProfile(teamId: string, patch: { name?: string; avatarAssetId?: string | null }): Promise<TeamRow>;
  listMembers(teamId: string): Promise<MemberProjectionRow[]>;
  listActiveUserIds(teamId: string, tx?: DbTransaction): Promise<string[]>;
  hasActiveMembership(teamId: string, userId: string, tx?: DbTransaction): Promise<boolean>;
  findActiveMembership(teamId: string, membershipId: string): Promise<MembershipRow | null>;
  findActiveMembershipByUser(teamId: string, userId: string): Promise<MembershipRow | null>;
  findMembershipByUser(teamId: string, userId: string): Promise<MembershipRow | null>;
  restoreMembership(membershipId: string, role: "member"): Promise<MembershipRow>;
  changeRole(membershipId: string, role: "manager" | "member"): Promise<MembershipRow>;
  removeMembership(membershipId: string, at: Date): Promise<void>;
  transferOwner(teamId: string, oldOwnerId: string, newOwnerId: string): Promise<void>;
  softDelete(teamId: string, at: Date): Promise<void>;
}

export interface PlayersRepository {
  list(teamId: string, includeInactive: boolean): Promise<PlayerProjectionRow[]>;
  findVisible(playerId: string, userId: string): Promise<PlayerScopeRow | null>;
  getById(scope: TeamScope, playerId: string, tx?: DbTransaction): Promise<PlayerRow | null>;
  listForTeam(scope: TeamScope, tx?: DbTransaction): Promise<PlayerRow[]>;
  insert(input: NewPlayer): Promise<PlayerRow>;
  update(playerId: string, patch: PlayerPatch): Promise<PlayerRow>;
  deactivate(playerId: string, at: Date): Promise<PlayerRow>;
  linkUser(playerId: string, userId: string): Promise<PlayerRow>;
  unlinkUser(playerId: string): Promise<PlayerRow>;
  unlinkUserForRemovedMembership(teamId: string, userId: string): Promise<string[]>;
}
```

- [ ] **Step 5: Verify migrations on empty and representative prior databases**

Run: `pnpm --filter @puckflow/db test:migrations && pnpm --filter @puckflow/db test:integration -- teams-rosters-migration.integration.test.ts`

Expected: PASS for an empty database, M0 schema upgrade, unique owner constraint, unique active link constraint, and old-revision reads of M0 tables.

- [ ] **Step 6: Run database typecheck and commit**

Run: `pnpm --filter @puckflow/db typecheck`

Expected: zero TypeScript errors.

```bash
git add packages/db/src packages/db/drizzle
git commit -m "feat(db): add team and roster persistence"
```

---

### Task 3: Implement team CRUD and authorized team scope

**Files:**
- Create: `apps/api/src/auth/team-scope.ts`
- Create: `apps/api/src/services/team-service.ts`
- Create: `apps/api/src/routes/teams.ts`
- Modify: `apps/api/src/routes/index.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/teams.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 `CreateTeamBody`, `UpdateTeamBody`, `TeamDetailSchema`, `canTeam`; Task 2 `TeamsRepository`; M0 auth, validation, Problem Details, transaction, and audit helpers.
- Produces: `TeamScope = { teamId, actorUserId, membershipId, role, requestId }`, `resolveTeamScope(teamId, actorUserId, requestId)`, `requireTeamRole(minimum)`, `requireTeamAction(action)`, `TeamService.create/list/get/update/remove`, and REST endpoints `POST /v1/teams`, `GET /v1/me/teams`, `GET|PATCH|DELETE /v1/teams/:teamId`.

- [ ] **Step 1: Write failing create/list/update/visibility tests**

```ts
it("creates a team and owner atomically", async () => {
  const response = await api(owner).post("/v1/teams").send({ name: "Night Owls" });
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ name: "Night Owls", role: "owner" });
  expect(await activeOwners(response.body.id)).toHaveLength(1);
});

it("returns 404 to a non-member and 403 to a member editing", async () => {
  expect((await api(stranger).get(`/v1/teams/${teamId}`)).status).toBe(404);
  const denied = await api(member).patch(`/v1/teams/${teamId}`).send({ name: "No" });
  expect(denied.status).toBe(403);
  expect(denied.type).toContain("application/problem+json");
});
```

- [ ] **Step 2: Run focused integration tests and observe 404 route failures**

Run: `pnpm --filter @puckflow/api test -- teams.integration.test.ts -t "creates|returns 404"`

Expected: FAIL because the team routes are not mounted.

- [ ] **Step 3: Implement team scope as the only private repository gateway**

```ts
export async function resolveTeamScope(repos: Repositories, teamId: string, actorUserId: string, requestId: string): Promise<TeamScope | null> {
  const row = await repos.teams.findVisible(teamId, actorUserId);
  if (!row || row.team.deletedAt || row.membership.removedAt) return null;
  return { teamId, actorUserId, membershipId: row.membership.id, role: row.membership.role, requestId };
}

export function requireTeamAction(action: TeamAction): RequestHandler {
  return async (req: AuthenticatedRequest, res, next) => {
    const scope = await resolveTeamScope(req.services.repos, req.params.teamId, req.user.id, req.requestId);
    if (!scope) return next(new NotFoundProblem("Team not found"));
    if (!canTeam(scope.role, action)) return next(new ForbiddenProblem("Action is not permitted"));
    req.teamScope = scope;
    next();
  };
}
```

- [ ] **Step 4: Implement atomic creation and curated projections**

```ts
async create(actor: Actor, body: CreateTeamInput): Promise<TeamDetail> {
  return this.db.transaction(async (tx) => {
    const repos = this.repos.withTransaction(tx);
    const team = await repos.teams.insertTeam({ id: uuidv7(), name: body.name, creatorUserId: actor.userId });
    await repos.teams.insertMembership({ id: uuidv7(), teamId: team.id, userId: actor.userId, role: "owner" });
    return repos.teams.projectDetail(team.id, actor.userId);
  });
}

router.post("/teams", requireAuth, writeRateLimit, validateBody(CreateTeamBody), asyncRoute(async (req, res) => {
  const team = await req.services.teams.create(actorFrom(req), req.body);
  res.status(201).json(team);
}));
router.get("/me/teams", requireAuth, asyncRoute(async (req, res) => {
  res.json({ items: await req.services.teams.list(req.user.id) });
}));
```

- [ ] **Step 5: Implement manager profile edits and owner-only soft deletion**

```ts
async remove(scope: TeamScope, actor: Actor): Promise<void> {
  await this.db.transaction(async (tx) => {
    await this.repos.withTransaction(tx).teams.softDelete(scope.teamId, this.clock.now());
    await appendAudit(tx, {
      id: uuidv7(),
      actorUserId: actor.userId, action: "team.deleted", entityType: "team",
      entityId: scope.teamId, teamId: scope.teamId, requestId: actor.requestId,
      changes: { deleted: { before: false, after: true } },
      allowedChangeKeys: ["deleted"],
    });
  });
}
```

- [ ] **Step 6: Verify route, rollback, Problem Details, and audit behavior**

Run: `pnpm --filter @puckflow/api test -- teams.integration.test.ts`

Expected: PASS for owner creation, multi-team list roles, manager update, member `403`, invisible `404`, owner-only deletion, audit insertion, and rollback when audit insertion fails.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @puckflow/api typecheck`

Expected: zero TypeScript errors.

```bash
git add apps/api/src/auth apps/api/src/services/team-service.ts apps/api/src/routes apps/api/src/app.ts apps/api/test/teams.integration.test.ts
git commit -m "feat(api): add authorized team lifecycle"
```

---

### Task 4: Implement invitations, memberships, roles, removal, and ownership transfer

**Files:**
- Create: `apps/api/src/services/invitation-service.ts`
- Modify: `apps/api/src/services/team-service.ts`
- Modify: `apps/api/src/routes/invitations.ts`
- Modify: `apps/api/src/routes/teams.ts`
- Modify: `apps/api/src/routes/index.ts`
- Create: `apps/api/test/invitations.integration.test.ts`
- Modify: `apps/api/test/teams.integration.test.ts`
- Create: `apps/worker/src/invitations/email.ts`
- Create: `apps/worker/src/invitations/email.test.ts`
- Modify: `apps/worker/src/handlers.ts`
- Modify: `apps/worker/src/config.ts`
- Modify: `apps/worker/package.json`

**Interfaces:**
- Consumes: Tasks 1-3 invite helpers, projections, authorized scope, team service/repositories; M0 outbox, audit, rate limit, Problem Details.
- Produces: `InvitationService.create/preview/accept/revoke`; `handleInvitationEmail(job,deps)`; membership list/role/remove and ownership transfer service methods; endpoints `POST /v1/teams/:teamId/invitations`, `DELETE /v1/teams/:teamId/invitations/:invitationId`, `GET /v1/invitations/:selector`, `GET /v1/invitations/:selector/avatar`, `POST /v1/invitations/:selector/accept`, `GET /v1/teams/:teamId/members`, `PATCH|DELETE /v1/teams/:teamId/members/:membershipId`, and `POST /v1/teams/:teamId/transfer-ownership`.

- [ ] **Step 1: Write failing invitation privacy and acceptance tests**

```ts
it("accepts both the link token and fallback code without persisting secrets", async () => {
  const created = await api(manager).post(`/v1/teams/${teamId}/invitations`).send({ role: "member", maxUses: 2 });
  expect(created.body.fallbackCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  expect(created.body.acceptUrl).toContain("/join/");
  expect(JSON.stringify(await db.query.invitations.findFirst())).not.toContain(created.body.fallbackCode);
  const linkToken = new URL(created.body.acceptUrl).pathname.split("/").at(-1)!;
  expect((await api(joinerA).post(`/v1/invitations/${linkToken}/accept`)).status).toBe(200);
  expect((await api(joinerB).post(`/v1/invitations/${created.body.fallbackCode.toLowerCase()}/accept`)).status).toBe(200);
});

it("limits public preview fields", async () => {
  const preview = await publicApi.get(`/v1/invitations/${token}`);
  expect(Object.keys(preview.body).sort()).toEqual(["avatarUrl", "expiresAt", "role", "state", "teamName"]);
});
```

- [ ] **Step 2: Run invite tests and observe unmounted route failures**

Run: `pnpm --filter @puckflow/api test -- invitations.integration.test.ts`

Expected: FAIL with `404` for invitation create/preview/accept routes.

- [ ] **Step 3: Implement secure invite creation and optional email outbox event**

Run: `pnpm --filter @puckflow/worker add --save-exact resend@6.17.2`

Expected: the worker manifest and lockfile record exactly `resend@6.17.2`.

```ts
async create(scope: TeamScope, actor: Actor, body: CreateInvitationInput): Promise<InvitationPrivateProjection> {
  const secrets = createInvitationSecrets(this.invitePepper);
  return this.db.transaction(async (tx) => {
    const invite = await this.repos.withTransaction(tx).invitations.insert({
      id: uuidv7(), teamId: scope.teamId, targetRole: "member",
      tokenDigest: secrets.tokenDigest, codeDigest: secrets.codeDigest,
      targetEmail: body.targetEmail ?? null,
      expiresAt: addHours(this.clock.now(), body.expiresInHours), maxUses: body.maxUses,
      createdByUserId: actor.userId,
    });
    if (body.targetEmail) await enqueueOutbox(tx, {
      id: uuidv7(), eventType: "team.invitation", aggregateType: "invitation", aggregateId: invite.id,
      teamId: scope.teamId, actorUserId: actor.userId, requestId: actor.requestId, occurredAt: this.clock.now(),
      payload: sealInvitationDelivery({ invitationId: invite.id, teamId: scope.teamId, recipient: body.targetEmail, token: secrets.token, fallbackCode: secrets.code }, this.invitationDeliveryKey),
    });
    return projectPrivateInvitation(invite, secrets.token, secrets.code, this.webBaseUrl);
  });
}
```

The invitation table stores only HMAC digests. The outbox stores only the AES-256-GCM sealed delivery object; `INVITATION_DELIVERY_KEY` is a 32-byte base64url Railway secret available only to API and worker. Register `team.invitation` in the M0 worker handler map. The handler calls `openInvitationDelivery`, sends through Resend with idempotency key `outbox:<outboxEventId>`, includes the link and fallback code, and passes only `recipientDomain`, `invitationId`, `teamId`, and provider message ID to structured logs. Resend transient failures use the existing job retry path; permanent address rejection completes the job with a sanitized target failure.

- [ ] **Step 4: Implement preview and locked acceptance**

```ts
async accept(selector: string, actor: Actor): Promise<TeamDetail> {
  return this.db.transaction(async (tx) => {
    const repos = this.repos.withTransaction(tx);
    const invite = await repos.invitations.findForUpdateByEitherDigest(
      digestInvitationSecret(selector, this.invitePepper),
      digestInvitationSecret(normalizeInviteCode(selector), this.invitePepper),
    );
    if (!invite || !isInvitationUsable(invite, this.clock.now())) throw new ConflictProblem("Invitation is unavailable");
    const existing = await repos.teams.findMembershipByUser(invite.teamId, actor.userId);
    if (existing?.removedAt === null) return repos.teams.projectDetail(invite.teamId, actor.userId);
    if (existing) {
      await repos.teams.restoreMembership(existing.id, "member");
      await appendAudit(tx, membershipAddedAudit(actor, invite.teamId));
    } else {
      await repos.teams.insertMembership({ id: uuidv7(), teamId: invite.teamId, userId: actor.userId, role: "member" });
      await appendAudit(tx, membershipAddedAudit(actor, invite.teamId));
    }
    await repos.invitations.incrementUseCount(invite.id);
    return repos.teams.projectDetail(invite.teamId, actor.userId);
  });
}
```

- [ ] **Step 5: Write failing role, removal, and transfer tests**

```ts
it("lets only the owner promote a member", async () => {
  expect((await api(manager).patch(memberPath).send({ role: "manager" })).status).toBe(403);
  expect((await api(owner).patch(memberPath).send({ role: "manager" })).body.role).toBe("manager");
});

it("transfers ownership atomically and blocks sole-owner removal", async () => {
  expect((await api(owner).delete(ownerMembershipPath)).status).toBe(409);
  await api(owner).post(`/v1/teams/${teamId}/transfer-ownership`).send({ membershipId: targetMembershipId }).expect(200);
  expect(await roles(teamId)).toEqual(expect.arrayContaining([{ userId: owner.id, role: "manager" }, { userId: target.id, role: "owner" }]));
  expect(await activeOwners(teamId)).toHaveLength(1);
});
```

- [ ] **Step 6: Implement membership mutations with exact permission distinctions**

```ts
async removeMember(scope: TeamScope, actor: Actor, membershipId: string): Promise<void> {
  await this.db.transaction(async (tx) => {
    const repos = this.repos.withTransaction(tx);
    const target = await repos.teams.findActiveMembership(scope.teamId, membershipId);
    if (!target) throw new NotFoundProblem("Membership not found");
    if (target.role === "owner") throw new OwnerRequiredProblem("Transfer ownership before removing the owner");
    if (scope.role === "manager" && target.role !== "member") throw new ForbiddenProblem("Managers may remove members only");
    await repos.teams.removeMembership(target.id, this.clock.now());
    const unlinkedPlayerIds = await repos.players.unlinkUserForRemovedMembership(scope.teamId, target.userId);
    await appendAudit(tx, membershipRemovedAudit(actor, target, unlinkedPlayerIds));
  });
}
```

- [ ] **Step 7: Verify concurrency, privacy, rate-limit, audit, and rollback cases**

Run: `pnpm --filter @puckflow/api test -- invitations.integration.test.ts teams.integration.test.ts && pnpm --filter @puckflow/worker test -- invitations/email.test.ts`

Expected: PASS for token/code acceptance, case/separator normalization, removed-member reactivation as `member`, expired/revoked/exhausted rejection, duplicate accept idempotency without consuming another use, concurrent final-use locking, preview field allowlist, invite rate limit, encrypted invitation email outbox and idempotent Resend delivery, owner-only role changes/transfer, manager ordinary-member removal, sole-owner protection, audit insertion, and transaction rollback.

- [ ] **Step 8: Commit invitation and ownership workflows**

```bash
git add apps/api/src/services apps/api/src/routes apps/api/test apps/worker pnpm-lock.yaml
git commit -m "feat(api): add invitations and ownership controls"
```

---

### Task 5: Implement roster CRUD and manager-only user/player linkage

**Files:**
- Create: `apps/api/src/services/player-service.ts`
- Create: `apps/api/src/routes/players.ts`
- Modify: `apps/api/src/routes/index.ts`
- Create: `apps/api/test/players.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 player schemas/policies, Task 2 player/team repositories, Task 3 team scope, M0 audit and Problem Details.
- Produces: `PlayerService.list/create/update/deactivate/link/unlink`; endpoints `GET|POST /v1/teams/:teamId/players`, `PATCH|DELETE /v1/players/:playerId`, and `PUT|DELETE /v1/players/:playerId/user-link`.

- [ ] **Step 1: Write failing roster CRUD and non-user player tests**

```ts
it("creates an unclaimed player without requiring an account", async () => {
  const response = await api(manager).post(`/v1/teams/${teamId}/players`).send({
    displayName: "Sam Goalie", jerseyNumber: "30", position: "G",
  });
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ displayName: "Sam Goalie", linkedUser: null, status: "active" });
});

it("hides a player from non-members", async () => {
  expect((await api(stranger).patch(`/v1/players/${playerId}`).send({ displayName: "No" })).status).toBe(404);
});
```

- [ ] **Step 2: Run focused tests and observe missing routes**

Run: `pnpm --filter @puckflow/api test -- players.integration.test.ts -t "unclaimed|hides"`

Expected: FAIL with `404` because roster routes are absent.

- [ ] **Step 3: Implement curated player lookup and CRUD**

```ts
async create(scope: TeamScope, actor: Actor, input: CreatePlayerInput): Promise<PlayerProjection> {
  return this.db.transaction(async (tx) => {
    const repos = this.repos.withTransaction(tx);
    const player = await repos.players.insert({ id: uuidv7(), teamId: scope.teamId, ...input, linkedUserId: null, status: "active" });
    await appendAudit(tx, {
      id: uuidv7(),
      actorUserId: actor.userId, action: "player.created", entityType: "player",
      entityId: player.id, teamId: scope.teamId, requestId: actor.requestId,
      changes: { displayName: { before: null, after: player.displayName }, status: { before: null, after: "active" } },
      allowedChangeKeys: ["displayName", "status"],
    });
    return repos.players.project(player.id);
  });
}
```

- [ ] **Step 4: Write failing linkage policy and conflict tests**

```ts
it("allows managers but not members to link a team member", async () => {
  expect((await api(member).put(`/v1/players/${playerId}/user-link`).send({ userId: member.id })).status).toBe(403);
  expect((await api(manager).put(`/v1/players/${playerId}/user-link`).send({ userId: member.id })).body.linkedUser.id).toBe(member.id);
});

it("rejects a non-member and a second active link", async () => {
  expectProblem(await api(manager).put(linkPath).send({ userId: stranger.id }), 422, "VALIDATION_FAILED");
  expectProblem(await api(manager).put(secondLinkPath).send({ userId: member.id }), 409, "PLAYER_LINK_CONFLICT");
});
```

- [ ] **Step 5: Implement link/unlink with membership and unique-conflict checks**

```ts
async link(scope: TeamScope, actor: Actor, playerId: string, userId: string): Promise<PlayerProjection> {
  return this.db.transaction(async (tx) => {
    const repos = this.repos.withTransaction(tx);
    const membership = await repos.teams.findActiveMembershipByUser(scope.teamId, userId);
    if (!membership) throw new ValidationProblem("Linked user must be an active team member", [{ path: "userId", message: "Not a team member" }]);
    try {
      const player = await repos.players.linkUser(playerId, userId);
      await appendAudit(tx, playerLinkAudit(actor, player, null, userId));
      return repos.players.project(player.id);
    } catch (error) {
      if (isConstraint(error, "players_one_active_user_link_idx")) throw new PlayerLinkConflictProblem();
      throw error;
    }
  });
}
```

- [ ] **Step 6: Verify deactivation, unlinking, audits, and rollback**

Run: `pnpm --filter @puckflow/api test -- players.integration.test.ts`

Expected: PASS for roster list, non-user player create, profile update, soft deactivation, owner/manager writes, member `403`, non-member `404`, active-membership link validation, one active link, unlink, membership-removal unlink, allowlisted audits, and rollback on audit failure.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @puckflow/api typecheck`

Expected: zero TypeScript errors.

```bash
git add apps/api/src/services/player-service.ts apps/api/src/routes/players.ts apps/api/src/routes/index.ts apps/api/test/players.integration.test.ts
git commit -m "feat(api): add roster and player linkage"
```

---

### Task 6: Implement private Railway Bucket avatar upload and read flow

**Files:**
- Create: `apps/api/src/storage/railway-bucket.ts`
- Create: `apps/api/src/services/media-service.ts`
- Create: `apps/api/src/routes/media.ts`
- Modify: `apps/api/src/routes/invitations.ts`
- Modify: `apps/api/src/routes/index.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/media.integration.test.ts`
- Modify: `packages/db/src/repositories/media-repository.ts`

**Interfaces:**
- Consumes: Task 1 avatar schemas/constants, Task 2 media repository, Task 3 team scope, Task 4 valid invitation resolution, M0 `media_assets` states and rate limits.
- Produces: `RailwayBucket`, `S3RailwayBucket`, `MediaService.issueAvatarUpload/completeAvatarUpload/readAuthorized/readInviteAvatar`, `POST /v1/media/uploads`, `POST /v1/media/uploads/:assetId/complete`, `GET /v1/media/:assetId`, and invitation-avatar streaming.

- [ ] **Step 1: Add locked runtime dependencies**

Run: `pnpm --filter @puckflow/api add --save-exact @aws-sdk/client-s3@3.1086.0 @aws-sdk/s3-presigned-post@3.1086.0 file-type@22.0.1 sharp@0.35.3`

Expected: API `package.json` contains the four dependencies and `pnpm-lock.yaml` contains exact resolved versions.

- [ ] **Step 2: Write failing upload authorization and verification tests with a fake Bucket**

```ts
it("issues a one-object upload for self or a managed team", async () => {
  const response = await api(manager).post("/v1/media/uploads").send({
    ownerType: "team", ownerId: teamId, mimeType: "image/webp",
    byteSize: 64000, width: 512, height: 512,
  });
  expect(response.status).toBe(201);
  expect(response.body.upload.fields.key).toBe(`avatars/team/${teamId}/${response.body.asset.id}.webp`);
  expect(response.body.upload.maxBytes).toBe(1_048_576);
});

it("rejects a client-compliant claim when actual bytes are oversized", async () => {
  bucket.put(objectKey, oversizedJpegBytes);
  expectProblem(await api(owner).post(`/v1/media/uploads/${assetId}/complete`), 422, "VALIDATION_FAILED");
  expect((await mediaRow(assetId)).status).toBe("rejected");
  expect(bucket.has(objectKey)).toBe(false);
});
```

- [ ] **Step 3: Define a narrow storage interface and S3-compatible adapter**

```ts
export interface RailwayBucket {
  createPresignedAvatarPost(input: { key: string; mimeType: "image/jpeg" | "image/webp"; maxBytes: number; expiresInSeconds: number }): Promise<{ url: string; fields: Record<string, string> }>;
  getObject(key: string): Promise<{ body: Readable; contentLength: number | null; contentType: string | null }>;
  deleteObject(key: string): Promise<void>;
}

export const createRailwayBucket = (env: BucketEnv): RailwayBucket => new S3RailwayBucket(new S3Client({
  endpoint: env.RAILWAY_BUCKET_ENDPOINT,
  region: env.RAILWAY_BUCKET_REGION,
  credentials: { accessKeyId: env.RAILWAY_BUCKET_ACCESS_KEY_ID, secretAccessKey: env.RAILWAY_BUCKET_SECRET_ACCESS_KEY },
  forcePathStyle: true,
}), env.RAILWAY_BUCKET_NAME);
```

- [ ] **Step 4: Implement issuance authorization and immutable object keys**

```ts
async issueAvatarUpload(actor: Actor, input: RequestAvatarUpload): Promise<AvatarUploadProjection> {
  if (input.ownerType === "user" && input.ownerId !== actor.userId) throw new ForbiddenProblem("Cannot update another user avatar");
  if (input.ownerType === "team") await this.assertTeamAction(input.ownerId, actor.userId, "edit_team");
  const assetId = uuidv7();
  const extension = input.mimeType === "image/jpeg" ? "jpg" : "webp";
  const objectKey = `avatars/${input.ownerType}/${input.ownerId}/${assetId}.${extension}`;
  const asset = await this.media.insertPending({ id: assetId, ownerType: input.ownerType, ownerId: input.ownerId, objectKey, declared: input, uploaderUserId: actor.userId });
  const upload = await this.bucket.createPresignedAvatarPost({ key: objectKey, mimeType: input.mimeType, maxBytes: AVATAR_MAX_BYTES, expiresInSeconds: 600 });
  return { asset: projectMedia(asset), upload: { ...upload, maxBytes: AVATAR_MAX_BYTES, expiresAt: addSeconds(this.clock.now(), 600).toISOString() } };
}
```

- [ ] **Step 5: Independently verify and atomically attach uploaded bytes**

```ts
const object = await this.bucket.getObject(asset.objectKey);
const bytes = await readAtMost(object.body, AVATAR_MAX_BYTES + 1);
const detected = await fileTypeFromBuffer(bytes);
const metadata = await sharp(bytes, { failOn: "warning" }).metadata();
const valid = bytes.length <= AVATAR_MAX_BYTES
  && (detected?.mime === "image/jpeg" || detected?.mime === "image/webp")
  && detected.mime === asset.declaredMimeType
  && metadata.width !== undefined && metadata.height !== undefined
  && metadata.width === metadata.height && metadata.width <= AVATAR_MAX_DIMENSION;
if (!valid) {
  await this.media.markRejected(asset.id);
  await this.bucket.deleteObject(asset.objectKey);
  throw new ValidationProblem("Uploaded avatar does not satisfy the avatar contract");
}
return this.db.transaction(async (tx) => {
  const repos = this.repos.withTransaction(tx);
  await repos.media.markReady(asset.id, { mimeType: detected.mime, byteSize: bytes.length, width: metadata.width!, height: metadata.height! });
  await repos.media.attachToOwner(asset.ownerType, asset.ownerId, asset.id);
  return repos.media.project(asset.id);
});
```

- [ ] **Step 6: Implement authorized streaming and invite-limited avatar reads**

```ts
router.get("/media/:assetId", requireAuth, asyncRoute(async (req, res) => {
  const object = await req.services.media.readAuthorized(req.params.assetId, req.user.id);
  res.set({ "Content-Type": object.mimeType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" });
  object.body.pipe(res);
}));
router.get("/invitations/:selector/avatar", invitePreviewRateLimit, asyncRoute(async (req, res) => {
  const object = await req.services.media.readInviteAvatar(req.params.selector);
  res.set({ "Content-Type": object.mimeType, "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff" });
  object.body.pipe(res);
}));
```

- [ ] **Step 7: Verify all media security cases**

Run: `pnpm --filter @puckflow/api test -- media.integration.test.ts`

Expected: PASS for user-self upload, manager team upload, member/other-user denial, upload rate limit, fixed object key, exact POST conditions, missing object, MIME spoof, oversized bytes, non-square image, over-dimension image, rejected-object deletion, ready attachment, replacement, member-authorized read, stranger `404`, valid invite current-avatar read, invalid invite denial, cache headers, and no bucket credentials in responses.

- [ ] **Step 8: Run API regression suite and commit**

Run: `pnpm --filter @puckflow/api test && pnpm --filter @puckflow/api typecheck`

Expected: all API tests PASS and TypeScript reports zero errors.

```bash
git add apps/api packages/db/src/repositories/media-repository.ts pnpm-lock.yaml
git commit -m "feat(api): add private avatar media flow"
```

---

### Task 7: Add typed API clients, avatar orchestration, and deterministic team selection

**Files:**
- Create: `packages/api-client/src/teams.ts`
- Create: `packages/api-client/src/players.ts`
- Create: `packages/api-client/src/media.ts`
- Create: `packages/api-client/src/teams.test.ts`
- Create: `packages/api-client/src/players.test.ts`
- Create: `packages/api-client/src/media.test.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Consumes: Task 1 request/projection types and M0 `ApiTransport`.
- Produces: `createTeamsClient`, `createPlayersClient`, `createMediaClient`, and `uploadAvatar(normalized, owner)` shared by platform adapters.

- [ ] **Step 1: Write failing transport-contract tests**

```ts
it("uses the documented membership and roster paths", async () => {
  await teams.transferOwnership(teamId, membershipId);
  await players.linkUser(playerId, userId);
  expect(transport.calls).toEqual([
    { method: "POST", path: `/v1/teams/${teamId}/transfer-ownership`, body: { membershipId } },
    { method: "PUT", path: `/v1/players/${playerId}/user-link`, body: { userId } },
  ]);
});

it("uploads normalized bytes in issue, direct upload, complete order", async () => {
  await media.uploadAvatar(normalizedWebp, { ownerType: "team", ownerId: teamId });
  expect(events).toEqual(["issue", "bucket-post", "complete"]);
});
```

- [ ] **Step 2: Run focused tests and observe missing factories**

Run: `pnpm --filter @puckflow/api-client test -- teams.test.ts players.test.ts media.test.ts`

Expected: FAIL because `createTeamsClient`, `createPlayersClient`, and `createMediaClient` are not exported.

- [ ] **Step 3: Implement exact team and player client methods**

```ts
export const createTeamsClient = (http: ApiTransport) => ({
  create: (body: CreateTeamInput) => http.request<TeamDetail>({ method: "POST", path: "/v1/teams", body }),
  list: () => http.request<{ items: TeamSummary[] }>({ method: "GET", path: "/v1/me/teams" }),
  get: (teamId: string) => http.request<TeamDetail>({ method: "GET", path: `/v1/teams/${teamId}` }),
  update: (teamId: string, body: UpdateTeamInput) => http.request<TeamDetail>({ method: "PATCH", path: `/v1/teams/${teamId}`, body }),
  remove: (teamId: string) => http.request<void>({ method: "DELETE", path: `/v1/teams/${teamId}` }),
  members: (teamId: string) => http.request<{ items: MembershipProjection[] }>({ method: "GET", path: `/v1/teams/${teamId}/members` }),
  changeRole: (teamId: string, membershipId: string, role: "manager" | "member") => http.request<MembershipProjection>({ method: "PATCH", path: `/v1/teams/${teamId}/members/${membershipId}`, body: { role } }),
  removeMember: (teamId: string, membershipId: string) => http.request<void>({ method: "DELETE", path: `/v1/teams/${teamId}/members/${membershipId}` }),
  transferOwnership: (teamId: string, membershipId: string) => http.request<TeamDetail>({ method: "POST", path: `/v1/teams/${teamId}/transfer-ownership`, body: { membershipId } }),
  createInvitation: (teamId: string, body: CreateInvitationInput) => http.request<InvitationPrivateProjection>({ method: "POST", path: `/v1/teams/${teamId}/invitations`, body }),
  revokeInvitation: (teamId: string, invitationId: string) => http.request<void>({ method: "DELETE", path: `/v1/teams/${teamId}/invitations/${invitationId}` }),
  previewInvitation: (selector: string) => http.request<InvitationPublicProjection>({ method: "GET", path: `/v1/invitations/${encodeURIComponent(selector)}` }),
  acceptInvitation: (selector: string) => http.request<TeamDetail>({ method: "POST", path: `/v1/invitations/${encodeURIComponent(selector)}/accept` }),
});

export const createPlayersClient = (http: ApiTransport) => ({
  list: (teamId: string, includeInactive = false) => http.request<{ items: PlayerProjection[] }>({ method: "GET", path: `/v1/teams/${teamId}/players?includeInactive=${includeInactive}` }),
  create: (teamId: string, body: CreatePlayerInput) => http.request<PlayerProjection>({ method: "POST", path: `/v1/teams/${teamId}/players`, body }),
  update: (playerId: string, body: UpdatePlayerInput) => http.request<PlayerProjection>({ method: "PATCH", path: `/v1/players/${playerId}`, body }),
  deactivate: (playerId: string) => http.request<PlayerProjection>({ method: "DELETE", path: `/v1/players/${playerId}` }),
  linkUser: (playerId: string, userId: string) => http.request<PlayerProjection>({ method: "PUT", path: `/v1/players/${playerId}/user-link`, body: { userId } }),
  unlinkUser: (playerId: string) => http.request<PlayerProjection>({ method: "DELETE", path: `/v1/players/${playerId}/user-link` }),
});
```

- [ ] **Step 4: Implement the three-stage platform-neutral upload**

```ts
export type NormalizedAvatar = { bytes: Uint8Array; mimeType: "image/jpeg" | "image/webp"; width: number; height: number };
export const createMediaClient = (http: ApiTransport, bucketPost: BucketPost) => ({
  async uploadAvatar(file: NormalizedAvatar, owner: AvatarOwner): Promise<AvatarProjection> {
    const issued = await http.request<AvatarUploadProjection>({ method: "POST", path: "/v1/media/uploads", body: {
      ...owner, mimeType: file.mimeType, byteSize: file.bytes.byteLength, width: file.width, height: file.height,
    }});
    await bucketPost(issued.upload.url, issued.upload.fields, file.bytes, file.mimeType);
    return http.request<AvatarProjection>({ method: "POST", path: `/v1/media/uploads/${issued.asset.id}/complete` });
  },
});
```

- [ ] **Step 5: Verify API client tests and commit**

Run: `pnpm --filter @puckflow/api-client test && pnpm --filter @puckflow/api-client typecheck`

Expected: all API client tests PASS with exact paths, bodies, response types, error propagation, and upload ordering.

```bash
git add packages/api-client/src
git commit -m "feat(api-client): add team roster and media clients"
```

---

### Task 8: Build responsive web team, roster, role, invitation, avatar, and switching flows

**Files:**
- Create: all web files in the Exact File Map for `apps/web`
- Modify: `apps/web/app/(app)/layout.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: Task 1 selection/avatar/policy helpers, Task 7 typed clients, M0 authenticated web shell and design tokens.
- Produces: route-based team selection with valid cookie fallback; accessible owner/manager/member surfaces; browser-normalized `NormalizedAvatar`.

- [ ] **Step 1: Write failing selection and Canvas normalization tests**

```ts
it("drops a stale cookie and selects the first active membership", async () => {
  cookies.set("puckflow.active-team-id", "removed-team");
  expect(await resolveWebTeamSelection()).toBe("team-a");
  await selectWebTeam("team-b");
  expect(cookies.get("puckflow.active-team-id")).toBe("team-b");
});

it("exports a square WebP no larger than the shared limits", async () => {
  const result = await normalizeAvatar(sourceFile, { crop: { x: 20, y: 0, size: 800 } });
  expect(result.mimeType).toBe("image/webp");
  expect(result.width).toBe(result.height);
  expect(result.width).toBeLessThanOrEqual(AVATAR_MAX_DIMENSION);
  expect(result.bytes.byteLength).toBeLessThanOrEqual(AVATAR_MAX_BYTES);
});
```

- [ ] **Step 2: Run web unit tests and observe missing components**

Run: `pnpm --filter @puckflow/web test -- team-selection normalize-avatar`

Expected: FAIL because `TeamShell` and `normalizeAvatar` do not exist.

- [ ] **Step 3: Implement route/cookie-based multi-team reconciliation**

```ts
export async function resolveWebTeamSelection(routeTeamId?: string): Promise<string | null> {
  const { items } = await api.teams.list();
  const cookieTeamId = (await cookies()).get("puckflow.active-team-id")?.value ?? null;
  return selectActiveTeamId(routeTeamId ?? cookieTeamId, items);
}
export async function selectWebTeam(teamId: string): Promise<never> {
  "use server";
  const { items } = await api.teams.list();
  if (!items.some((team) => team.id === teamId)) notFound();
  (await cookies()).set("puckflow.active-team-id", teamId, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  redirect(`/teams/${teamId}`);
}
```

- [ ] **Step 4: Implement bounded Canvas normalization with quality fallback**

```ts
export async function normalizeAvatar(file: File, crop: SquareCrop): Promise<NormalizedAvatar> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const size = Math.min(AVATAR_MAX_DIMENSION, crop.size);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d", { alpha: false })!.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size);
  for (const quality of [0.86, 0.76, 0.66, 0.56]) {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Avatar encoding failed")), "image/webp", quality));
    if (blob.size <= AVATAR_MAX_BYTES) return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: "image/webp", width: size, height: size };
  }
  throw new Error("Choose an image with less visual detail; it could not be compressed below 1 MiB.");
}
```

- [ ] **Step 5: Write failing component tests for role-aware controls and accessible dialogs**

```tsx
it("shows link and role controls only to authorized roles", () => {
  render(<RosterPageFixture role="member" />);
  expect(screen.queryByRole("button", { name: "Link user" })).not.toBeInTheDocument();
  rerender(<RosterPageFixture role="manager" />);
  expect(screen.getByRole("button", { name: "Link user" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Transfer ownership" })).not.toBeInTheDocument();
});
```

- [ ] **Step 6: Build all web pages with explicit mutation reconciliation**

```tsx
<TeamSwitcher teams={teams} activeTeamId={team.id} onSelect={(id) => router.push(`/teams/${id}`)} />
<RosterList
  items={players}
  canManage={team.permissions.includes("manage_roster")}
  onCreate={async (input) => setPlayers((current) => insertSorted(current, await api.players.create(team.id, input)))}
  onLink={async (playerId, userId) => setPlayers((current) => replaceById(current, await api.players.linkUser(playerId, userId)))}
/>
```

Implement the named pages with these concrete states: loading skeleton; first-team empty state with `Create team`; zero-player state with `Add player` for owner/manager and read-only copy for member; unclaimed badge when `linkedUser` is null; inactive filter off by default; invitation dialog showing both copyable link and fallback code; public link preview with the allowlisted team fields; signed-in link acceptance; a signed-in fallback-code form; expired/exhausted invite errors; owner-only role/transfer/delete controls; typed team-name confirmation before delete; user-profile and team-settings avatar pick/crop/upload/progress/retry; inline RFC 9457 field errors; focus return after every dialog.

- [ ] **Step 7: Write and run the Playwright manager journey**

```ts
test("manager creates a team, invites, links a player, and switches teams", async ({ page }) => {
  await page.goto("/teams");
  await page.getByRole("link", { name: "Create team" }).click();
  await page.getByLabel("Team name").fill("Night Owls");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("link", { name: "Roster" }).click();
  await page.getByRole("button", { name: "Add player" }).click();
  await page.getByLabel("Player name").fill("Sam Goalie");
  await page.getByRole("button", { name: "Save player" }).click();
  await expect(page.getByText("Unclaimed")).toBeVisible();
  await page.getByRole("button", { name: "Switch team" }).click();
  await page.getByRole("menuitem", { name: "Sunday Skate" }).click();
  await expect(page).toHaveURL(/teams\/sunday-skate-id/);
});
```

Run: `pnpm --filter @puckflow/web test && pnpm --filter @puckflow/web exec playwright test test/teams-rosters.spec.ts`

Expected: web unit tests and the authenticated manager/member smoke journeys PASS at mobile and desktop viewport projects, including keyboard navigation, focus order, labels, 44 CSS-pixel controls, and dark-mode snapshots.

- [ ] **Step 8: Build, typecheck, and commit web flows**

Run: `pnpm --filter @puckflow/web typecheck && pnpm --filter @puckflow/web build`

Expected: zero TypeScript errors and a successful Next.js production build with all team routes listed.

```bash
git add apps/web
git commit -m "feat(web): add team and roster workflows"
```

---

### Task 9: Build native mobile team, roster, role, invitation, avatar, and switching flows

**Files:**
- Create: all mobile files in the Exact File Map for `apps/mobile`
- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Modify: `apps/mobile/package.json`

**Interfaces:**
- Consumes: Task 1 selection/avatar/policy helpers, Task 7 typed clients, M0 authenticated Expo shell and design tokens.
- Produces: `TeamProvider`, native `TeamSwitcher`, Expo-normalized `NormalizedAvatar`, and complete mobile Milestone 1 screens.

- [ ] **Step 1: Add the Expo-compatible persistence and image dependencies**

Run: `pnpm --filter @puckflow/mobile exec expo install --fix @react-native-async-storage/async-storage@2.2.0 expo-image-picker@57.0.2 expo-image-manipulator@57.0.2`

Expected: Expo resolves an SDK-compatible version, updates mobile `package.json`, and records the exact version in `pnpm-lock.yaml`.

- [ ] **Step 2: Write failing provider and image normalization tests**

```tsx
it("reconciles removed persisted teams", async () => {
  await AsyncStorage.setItem("puckflow.activeTeamId", "removed-team");
  render(<TeamProviderFixture teams={[{ id: "team-a", name: "Night Owls" }]} />);
  await waitFor(() => expect(screen.getByText("Night Owls")).toBeVisible());
  expect(await AsyncStorage.getItem("puckflow.activeTeamId")).toBe("team-a");
});

it("returns an orientation-normalized 512 square under 1 MiB", async () => {
  const avatar = await pickAndNormalizeAvatar();
  expect(avatar?.width).toBe(512);
  expect(avatar?.height).toBe(512);
  expect(avatar!.bytes.byteLength).toBeLessThanOrEqual(AVATAR_MAX_BYTES);
});
```

- [ ] **Step 3: Run mobile unit tests and observe missing provider/adapter failures**

Run: `pnpm --filter @puckflow/mobile test -- team-provider normalize-avatar`

Expected: FAIL because `TeamProvider` and `pickAndNormalizeAvatar` are missing.

- [ ] **Step 4: Implement persisted active-team reconciliation**

```tsx
const STORAGE_KEY = "puckflow.activeTeamId";
export function TeamProvider({ children }: PropsWithChildren) {
  const { data: teams = [] } = useTeams();
  const [preferred, setPreferred] = useState<string | null>(null);
  const activeTeamId = selectActiveTeamId(preferred, teams);
  useEffect(() => { AsyncStorage.getItem(STORAGE_KEY).then(setPreferred); }, []);
  useEffect(() => { if (activeTeamId) void AsyncStorage.setItem(STORAGE_KEY, activeTeamId); }, [activeTeamId]);
  const selectTeam = useCallback((id: string) => { setPreferred(id); router.replace(`/teams/${id}`); }, []);
  return <TeamContext.Provider value={{ teams, activeTeamId, selectTeam }}>{children}</TeamContext.Provider>;
}
```

- [ ] **Step 5: Implement Expo crop/manipulation with iterative compression**

```ts
export async function pickAndNormalizeAvatar(): Promise<NormalizedAvatar | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (picked.canceled) return null;
  for (const compress of [0.86, 0.76, 0.66, 0.56]) {
    const output = await ImageManipulator.manipulateAsync(
      picked.assets[0].uri,
      [{ resize: { width: AVATAR_MAX_DIMENSION, height: AVATAR_MAX_DIMENSION } }],
      { compress, format: ImageManipulator.SaveFormat.WEBP, base64: true },
    );
    const bytes = decodeBase64(output.base64!);
    if (bytes.byteLength <= AVATAR_MAX_BYTES) return { bytes, mimeType: "image/webp", width: output.width, height: output.height };
  }
  throw new Error("Choose an image with less visual detail; it could not be compressed below 1 MiB.");
}
```

- [ ] **Step 6: Write failing native permission and accessibility tests**

```tsx
it("keeps manager actions hidden from members and labels the switcher", () => {
  const { rerender } = render(<RosterScreenFixture role="member" />);
  expect(screen.queryByLabelText("Link user")).toBeNull();
  rerender(<RosterScreenFixture role="manager" />);
  expect(screen.getByLabelText("Link user")).toBeTruthy();
  expect(screen.getByLabelText("Switch team")).toHaveProp("accessibilityRole", "button");
});
```

- [ ] **Step 7: Build native-stack screens and explicit mutation reconciliation**

```tsx
<FlatList
  data={players}
  keyExtractor={(player) => player.id}
  renderItem={({ item }) => <PlayerRow player={item} canManage={canManage} onPress={() => openPlayerSheet(item)} />}
  ListEmptyComponent={<RosterEmptyState canManage={canManage} onAdd={openCreateSheet} />}
  contentInsetAdjustmentBehavior="automatic"
/>
```

Implement the named screens using `Stack`, `FlatList`, native alerts/action sheets, semantic colors, dynamic type, and minimum 44-point controls. Match web behavior exactly for first-team empty state, unclaimed/inactive players, a fallback-code join form, role/transfer/removal restrictions, typed deletion confirmation, Problem Details field errors, user-profile and team-settings avatar progress/retry, and immediate removal of a deleted team from the switcher. Do not add deferred install-time deep linking; the mobile app joins through the human-entered code.

- [ ] **Step 8: Run mobile flow, accessibility, and avatar contract tests**

Run: `pnpm --filter @puckflow/mobile test`

Expected: PASS for team create/update/delete, switch persistence/fallback, invitation presentation, member/manager/owner controls, roster CRUD/linking, 44-point targets, accessibility labels, dynamic type layouts, dark mode, canceled image selection, orientation correction, dimension cap, and byte cap.

- [ ] **Step 9: Verify Expo configuration, typecheck, and commit**

Run: `pnpm --filter @puckflow/mobile typecheck && pnpm --filter @puckflow/mobile exec expo config --type public`

Expected: zero TypeScript errors and valid iOS/iPadOS/Android Expo configuration with Image Picker permissions present and no secret Bucket values in the public config.

```bash
git add apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): add team and roster workflows"
```

---

### Task 10: Prove the Milestone 1 exit criterion and security contract

**Files:**
- Create: `apps/api/test/m1-teams-rosters.e2e.test.ts`
- Create: `docs/operations/avatars.md`
- Modify: `docs/operations/railway-production.md`

**Interfaces:**
- Consumes: all Tasks 1-9 and Milestone 0 CI/Railway test harness.
- Produces: one end-to-end executable acceptance test and exact Railway Bucket operations/configuration documentation.

- [ ] **Step 1: Write the complete failing exit-criterion test**

```ts
it("satisfies the Milestone 1 manager journey", async () => {
  const team = await createTeam(owner, "Night Owls");
  const invite = await createInvite(owner, team.id, { targetEmail: "manager@example.test", maxUses: 1 });
  const managerTeam = await acceptInvite(manager, invite.fallbackCode);
  await changeRole(owner, team.id, managerTeam.membershipId, "manager");
  const unclaimed = await createPlayer(manager, team.id, { displayName: "Walk-on", jerseyNumber: null, position: null });
  const claimed = await createPlayer(manager, team.id, { displayName: "Manager Player", jerseyNumber: "19", position: "C" });
  await linkPlayer(manager, claimed.id, manager.id);
  expect((await listPlayers(owner, team.id)).items).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: unclaimed.id, linkedUser: null }),
    expect.objectContaining({ id: claimed.id, linkedUser: expect.objectContaining({ id: manager.id }) }),
  ]));
});
```

- [ ] **Step 2: Run the exit test before final wiring and observe the first concrete mismatch**

Run: `pnpm --filter @puckflow/api test -- m1-teams-rosters.e2e.test.ts`

Expected: FAIL at any interface not wired through the real app/database; record the exact mismatch in the implementation commit and correct only that mismatch.

- [ ] **Step 3: Wire the tested public application dependencies**

```ts
const app = createApp({
  db,
  teams: new TeamService(repositories, clock),
  invitations: new InvitationService(repositories, clock, env.INVITATION_PEPPER, env.WEB_BASE_URL),
  players: new PlayerService(repositories, clock),
  media: new MediaService(repositories, railwayBucket, clock),
});
```

- [ ] **Step 4: Document exact production variables and Bucket lifecycle**

```text
RAILWAY_BUCKET_ENDPOINT       private S3-compatible endpoint
RAILWAY_BUCKET_REGION         Bucket region
RAILWAY_BUCKET_NAME           private application Bucket name
RAILWAY_BUCKET_ACCESS_KEY_ID  API service only
RAILWAY_BUCKET_SECRET_ACCESS_KEY API service only
INVITATION_PEPPER             API service only, rotate only with explicit invite invalidation
INVITATION_DELIVERY_KEY       API and worker only, 32-byte base64url AES key
RESEND_API_KEY                worker only
INVITATION_FROM_EMAIL         worker only, verified Resend sender
WEB_BASE_URL                  canonical HTTPS web origin used in invite links
```

Document: create a private application Bucket; bind Bucket variables only to API; bind invitation delivery/Resend variables only to the named server services; verify `1 MiB` upload conditions; confirm authenticated and invitation-avatar cache headers; confirm rejected object deletion; test credential revocation; treat avatar objects as replaceable while Postgres asset ownership remains authoritative.

- [ ] **Step 5: Run the full milestone verification matrix**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @puckflow/db test:migrations && pnpm --filter @puckflow/web build && pnpm --filter @puckflow/mobile exec expo config --type public`

Expected: all lint, type, unit, integration, migration, web build, and Expo config checks succeed; no test is skipped; no production secret appears in built client configuration.

- [ ] **Step 6: Run the exit test and commit the acceptance proof**

Run: `pnpm --filter @puckflow/api test -- m1-teams-rosters.e2e.test.ts`

Expected: PASS for create team, invite by fallback code, manager promotion, non-user player, member-player link, roster projection, and authorization boundaries.

```bash
git add apps/api/test/m1-teams-rosters.e2e.test.ts apps/api/src/app.ts docs/operations
git commit -m "test: prove Milestone 1 team roster journey"
```

## API Contract Produced by Milestone 1

| Method and path | Authentication | Minimum role | Success |
|---|---|---|---|
| `POST /v1/teams` | user | any signed-in user | `201 TeamDetail` |
| `GET /v1/me/teams` | user | active memberships | `200 { items: TeamSummary[] }` |
| `GET /v1/teams/:teamId` | user | member | `200 TeamDetail` |
| `PATCH /v1/teams/:teamId` | user | manager | `200 TeamDetail` |
| `DELETE /v1/teams/:teamId` | user | owner | `204` |
| `POST /v1/teams/:teamId/invitations` | user | manager | `201 InvitationPrivateProjection` |
| `DELETE /v1/teams/:teamId/invitations/:invitationId` | user | manager | `204` |
| `GET /v1/invitations/:selector` | public, rate-limited | valid invite | `200 InvitationPublicProjection` |
| `GET /v1/invitations/:selector/avatar` | public, rate-limited | valid invite | `200 image bytes` |
| `POST /v1/invitations/:selector/accept` | user, rate-limited | valid invite | `200 TeamDetail` |
| `GET /v1/teams/:teamId/members` | user | member | `200 { items: MembershipProjection[] }` |
| `PATCH /v1/teams/:teamId/members/:membershipId` | user | owner | `200 MembershipProjection` |
| `DELETE /v1/teams/:teamId/members/:membershipId` | user | manager for member, owner for manager/member | `204` |
| `POST /v1/teams/:teamId/transfer-ownership` | user | owner | `200 TeamDetail` |
| `GET /v1/teams/:teamId/players` | user | member | `200 { items: PlayerProjection[] }` |
| `POST /v1/teams/:teamId/players` | user | manager | `201 PlayerProjection` |
| `PATCH /v1/players/:playerId` | user | manager | `200 PlayerProjection` |
| `DELETE /v1/players/:playerId` | user | manager | `200 PlayerProjection` with `status: inactive` |
| `PUT /v1/players/:playerId/user-link` | user | manager | `200 PlayerProjection` |
| `DELETE /v1/players/:playerId/user-link` | user | manager | `200 PlayerProjection` |
| `POST /v1/media/uploads` | user, rate-limited | self or team manager | `201 AvatarUploadProjection` |
| `POST /v1/media/uploads/:assetId/complete` | user | issuing uploader still authorized | `200 AvatarProjection` |
| `GET /v1/media/:assetId` | user | current owner or member of owning team | `200 image bytes` |

## GitHub Issue Manifest

### 1. Define Milestone 1 team and roster domain contracts

- **Issue:** [#19](https://github.com/marknotfound/puckflow/issues/19)
- **Labels:** `type:feature`, `area:data`, `area:teams`, `priority:p0`
- **Dependencies:** [#18](https://github.com/marknotfound/puckflow/issues/18)
- **Body:** Add the complete Zod projection/request contract, pure role/link policies, invitation secret utilities, deterministic team selection, Drizzle schema, checked-in migration, and narrow repositories. Preserve M0 runtime and error contracts.
- **Acceptance criteria:**
  - Roles and invitation target role are database- and schema-constrained.
  - One active owner and one active linked player per user/team are covered by database tests.
  - Token/code plaintext is never persisted.
  - Empty and M0 upgrade migrations pass.
  - Core and database typechecks pass.
- **Plan task refs:** Tasks 1-2

### 2. Deliver authorized team CRUD

- **Issue:** [#20](https://github.com/marknotfound/puckflow/issues/20)
- **Labels:** `type:feature`, `area:api`, `area:teams`, `priority:p0`
- **Dependencies:** [#19](https://github.com/marknotfound/puckflow/issues/19)
- **Body:** Add team scope resolution and team create/list/read/update/delete endpoints. Creation must add the sole owner atomically; deletion is owner-only, soft, audited, and invisible afterward.
- **Acceptance criteria:**
  - Team creation yields exactly one owner.
  - Multi-team list returns each active role and no deleted teams.
  - Managers can edit; members receive `403`; non-members receive `404`.
  - Deletion writes an allowlisted audit in the same transaction.
  - All errors use Problem Details.
- **Plan task refs:** Task 3

### 3. Add secure invitations and membership lifecycle

- **Issue:** [#21](https://github.com/marknotfound/puckflow/issues/21)
- **Labels:** `type:feature`, `area:api`, `area:auth`, `area:teams`, `priority:p0`
- **Dependencies:** [#20](https://github.com/marknotfound/puckflow/issues/20)
- **Body:** Support manager-created member invitations, public privacy-safe preview, high-entropy links and fallback codes, optional email outbox creation, acceptance, revocation, expiration/use limits, member removal, and owner-only role changes.
- **Acceptance criteria:**
  - Link token and normalized fallback code both work.
  - Expired, revoked, exhausted, and concurrent final-use cases are deterministic.
  - Public preview is field-allowlisted.
  - Managers cannot change roles or remove managers.
  - Membership audits/outbox rows commit or roll back with mutations.
- **Plan task refs:** Task 4

### 4. Add transactional ownership transfer and team deletion safeguards

- **Issue:** [#22](https://github.com/marknotfound/puckflow/issues/22)
- **Labels:** `type:security`, `area:api`, `area:teams`, `priority:p0`
- **Dependencies:** [#21](https://github.com/marknotfound/puckflow/issues/21)
- **Body:** Complete owner-only transfer and deletion workflows, including demotion/promotion in one transaction, sole-owner removal protection, and security-event auditing.
- **Acceptance criteria:**
  - Transfer targets an active team member.
  - The old owner becomes manager and the target becomes the sole owner after commit.
  - Failed transfer/audit leaves roles unchanged.
  - The sole owner cannot be removed.
  - Deleted teams disappear from all member lists and private reads.
- **Plan task refs:** Tasks 3-4

### 5. Deliver roster CRUD and manager-controlled player linkage

- **Issue:** [#23](https://github.com/marknotfound/puckflow/issues/23)
- **Labels:** `type:feature`, `area:api`, `area:teams`, `priority:p0`
- **Dependencies:** [#19](https://github.com/marknotfound/puckflow/issues/19), [#20](https://github.com/marknotfound/puckflow/issues/20)
- **Body:** Add private roster list, non-user player creation, edits, soft deactivation, and owner/manager-only user link/unlink. Ensure membership removal unlinks but preserves the player.
- **Acceptance criteria:**
  - Non-user players require no account or email.
  - Members can view but cannot mutate or claim players.
  - Only active team members may be linked.
  - A linked user has at most one active player in a team.
  - Removal/deactivation/link changes are audited and rollback-safe.
- **Plan task refs:** Task 5

### 6. Add private Railway Bucket avatar pipeline

- **Issue:** [#24](https://github.com/marknotfound/puckflow/issues/24)
- **Labels:** `type:feature`, `area:api`, `area:media`, `priority:p1`
- **Dependencies:** [#20](https://github.com/marknotfound/puckflow/issues/20), [#21](https://github.com/marknotfound/puckflow/issues/21)
- **Body:** Add self/team-authorized upload issuance, immutable object keys, direct private Bucket upload, independent byte/MIME/dimension validation, atomic attachment, authorized media streaming, and invitation-limited team avatar streaming.
- **Acceptance criteria:**
  - Only JPEG/WebP square images up to `512 x 512` and `1 MiB` become ready.
  - Invalid or spoofed uploads are rejected and deleted.
  - User uploads are self-only; team uploads require manager role.
  - Authenticated and invitation reads enforce owner/team scope with explicit private cache headers.
  - Bucket credentials never enter client config or API responses.
- **Plan task refs:** Task 6

### 7. Build web teams, rosters, avatars, and switching

- **Issue:** [#25](https://github.com/marknotfound/puckflow/issues/25)
- **Labels:** `type:feature`, `area:web`, `area:teams`, `priority:p1`
- **Dependencies:** [#21](https://github.com/marknotfound/puckflow/issues/21), [#23](https://github.com/marknotfound/puckflow/issues/23), [#24](https://github.com/marknotfound/puckflow/issues/24)
- **Body:** Build responsive App Router team list/create/detail/member/roster/settings pages, role-aware actions, accessible invite/link/transfer/delete dialogs, Web Canvas avatar normalization, and route/cookie multi-team switching.
- **Acceptance criteria:**
  - Owner, manager, and member controls match the API policy.
  - Invite UI always displays both link and fallback code.
  - Claimed, unclaimed, active, and inactive roster states are clear.
  - Stale/deleted active team selection falls back deterministically.
  - Mobile/desktop Playwright journeys, keyboard, dark mode, and avatar contract tests pass.
- **Plan task refs:** Tasks 7-8

### 8. Build mobile teams, rosters, avatars, switching, and acceptance proof

- **Issue:** [#26](https://github.com/marknotfound/puckflow/issues/26)
- **Labels:** `type:feature`, `type:test`, `area:mobile`, `area:teams`, `priority:p1`
- **Dependencies:** [#25](https://github.com/marknotfound/puckflow/issues/25)
- **Body:** Build Expo Router native-stack team/member/roster/settings screens, AsyncStorage team selection, Expo avatar normalization, accessible manager/owner controls, and the full Milestone 1 cross-service acceptance test and Railway operations notes.
- **Acceptance criteria:**
  - Active team persists and reconciles after membership loss or deletion.
  - Native screens cover team CRUD, invites, roles, transfer, roster CRUD, and linkage.
  - Image selection/crop/compression meets the shared contract on iOS and Android.
  - Dynamic type, semantic dark colors, labels, and 44-point targets pass tests.
  - Full monorepo verification and the real-manager exit-criterion test pass.
- **Plan task refs:** Tasks 7, 9-10
