# Expo SDK 57 mutable-registry verification deviation

Reviewed: `2026-07-17`

Status: `accepted-version-ledger-deviation`

Owner: repository owner / mobile platform operations

The Milestone 0 plan intentionally pins the Expo SDK 57 dependency ledger at
the exact versions verified on 2026-07-13. Expo's mutable online compatibility
ledger changed after that approval. We preserve the approved exact pins rather
than silently converting a registry check into an unreviewed dependency update.

Online result: **FAIL (exit 1)**

The check run on 2026-07-17 reported these checked-in exact pins and current
registry recommendations:

| Checked-in exact pin | Mutable registry recommendation | Pin authority |
| --- | --- | --- |
| `expo@57.0.4` | `~57.0.6` | Milestone 0 plan |
| `expo-linking@57.0.2` | `~57.0.3` | Milestone 0 plan |
| `expo-router@57.0.4` | `~57.0.6` | Milestone 0 plan |
| `expo-secure-store@57.0.0` | `~57.0.1` | Milestone 0 plan |
| `expo-system-ui@57.0.0` | `~57.0.1` | Milestone 0 plan |
| `@types/jest@30.0.0` | `29.5.14` | Checked-in exact mobile test-tool pin |
| `jest@30.4.2` | `~29.7.0` | Milestone 0 plan |
| `jest-expo@57.0.1` | `~57.0.2` | Milestone 0 plan |

The online check did not recommend changes for the other approved native
runtime pins, including `expo-status-bar@57.0.1`, `react@19.2.3`,
`react-native@0.86.0`, and `@sentry/react-native@7.11.0`.

## Compatibility evidence

Using Node 24.18.0 and pnpm 11.13.0 on 2026-07-17:

- `pnpm --filter @puckflow/mobile test` passed 13 tests in 4 suites, including
  native rendering, token cache, public configuration, dark/light navigation
  themes, and WCAG contrast contracts.
- `pnpm --filter @puckflow/mobile typecheck` exited 0.
- `pnpm --filter @puckflow/mobile exec expo config --type public` exited 0 and
  produced only the approved iOS/Android identifiers and public configuration.
- The release gate also requires a production iOS Expo export with the public
  Clerk key, API URL, and Sentry DSN statically inlined before this deviation is
  accepted for a commit.

This evidence demonstrates the checked-in client paths used by Milestone 0; it
does not make the mutable online registry check pass.

## Impact and compensating controls

Expo CLI continues to warn that the eight rows above are not its current best
compatibility selections. That may leave patch-level fixes unapplied or expose
test-runner differences from Expo's current recommendation. We compensate by
keeping the approved ledger immutable, running native unit/theme/configuration
checks, producing a production bundle in a clean deployment fixture, pinning
EAS CLI exactly at `21.0.0`, and requiring this record through a repository
contract test. No store submission is authorized by the Milestone 0 profiles.

Revisit trigger: amend the approved dependency ledger or upgrade Expo SDK; an
Expo/React Native security advisory, a failed production export, or a native
runtime regression also requires immediate review. Resolve the deviation in an
intentional dependency-change commit that updates the plan, exact manifests,
lockfile, compatibility evidence, and this contract together.

## Exact resolution check

Run from the repository root with Node 24.18.0 and pnpm 11.13.0:

```bash
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_registry_check \
EXPO_PUBLIC_API_URL=https://api.example.test \
EXPO_PUBLIC_SENTRY_DSN= \
pnpm --filter @puckflow/mobile exec expo install --check
```

Resolution requires exit 0 against intentionally approved exact manifest
versions plus all mobile tests, type checking, public config, and production
bundle verification. Do not report this command as passing while this deviation is active.
