---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "f7a3ac94f5dd446cdc29a4f8a11bb8314c44039e"
verdict: "approve"
---

# Review: feat/a-p1-wave-4b

Date: 09-28-26

## Scope

Branch feat/a-p1-wave-4b, range 7b5fac04ce89d95311475a13a130e15f9a465832..f7a3ac94f5dd446cdc29a4f8a11bb8314c44039e (15 commits). The first review covered 7b5fac0..ea4711f in two slices, critical and gate. The re-review covered the fix range ea4711f..f7a3ac9.

The wave delivers:

- T19 (#122): WebSocket heartbeat and upgrade checks (`packages/api/src/ws/server.ts`).
- T20 (#123): fail-closed startup (`packages/api/src/startup.ts`, `packages/api/src/main.ts`).
- T21 (#124): dev launcher (`scripts/dev/*`, root `dev`, `dev:api` and `e2e` scripts).
- T22 (#125): route matrix tests.
- T23 (#126): the Better Auth logger now goes through the redacting logger (`auth/auth.ts`, `deps.ts`).
- Fixes #212 G-M1, G-M2, C-M1 and C-M2 (login-failure counting, the auditEmail actor, the audit trigger pin keeping comments, and each guard case naming its check).
- `packages/api/src/events/**` made gate tier.

## Findings summary

- Critical: 0.
- Important: 1, C-I1. `packages/api/src/main.ts` matched no sensitive glob, yet it owns the spec 8.1 fail-closed exit and the fatal line. Resolved: `.github/sensitive-paths` now lists it under `[critical]` next to startup.ts, and CLAUDE.md lists it too. `scripts/ci/sensitive-review.test.ts` checks the tier.
- Minor: 4.
  - G-G-m1, addressed. A Drizzle `Failed query ... params:` string message is now logged as `database error`.
  - G-G-m2, addressed. Only Error or error-shaped objects map to `errorName`, so a user record's `name` no longer reaches a log line.
  - C-M1, addressed. Every guard rejection case names the check it must hit.
  - C-M2, stands as no action. The CI pin is stricter than startup about comments, which fails closed.
- Rulings kept as stands: none at Important.
- Controller rulings: none on these findings.

The fix report shows RED then GREEN for C-I1, G-G-m1 and G-G-m2, and a mutation check for C-M1. `pnpm lint`, `pnpm typecheck` and `pnpm coverage` all exited 0 (1584 tests).

## Cross-cutting checks

First review:

- The CI trigger pin and startup's trigger check agree. CI only accepts what startup accepts, and the one divergence (C-M2) makes CI stricter.
- The startup failure path writes name and message only, never a stack or secret value. This check found C-I1.
- The WebSocket upgrade needs a live principal and an allowed Origin before handleUpgrade.
- Better Auth dist error paths: raw DB text reaches the sink only through the string-message path, which was G-G-m1.
- `.gitignore` covers `.dev/`, and `allowImportingTsExtensions` is type-level only.

Re-review:

- drizzle-orm 0.45.3's DrizzleQueryError text is `Failed query: <sql>`, a newline, then `params: <values>`. The G-G-m1 filter matches it.
- Every source file added on the branch now has the right tier. main.ts and startup.ts are critical, and ws/server.ts is gate. `scripts/dev/*` is ordinary.
- `scripts/dev/secrets.ts` writes random dev-only values into a gitignored local directory (modes 0700 and 0600) and never loads or sends them. The loader and key checks stay in critical files, so ordinary tier fits.

## Answers to the controller's questions

1. **Startup.** Every step fails closed. The order is env, secrets, deps (open with key, migrate, triggers, canaries, config, logger, auth), the MFA guard, app, listen, then WebSocket. env comes first because the secrets dir comes from the env. main.ts writes one fatal JSON line with name and message only and exits 1. The MFA refusal logs a fixed reason through the redacting logger, closes the db and throws.
2. **WebSocket.** No upgrade reaches handleUpgrade without a resolved principal (X-Background: 1) and an allowed Origin. A missing Origin is accepted only with a Bearer header, and then the cookie is dropped. The error listener is removed just before handleUpgrade. A failed ping liveness check closes with 4001 through an idempotent endSession.
3. **Login failures.** Only `INVALID_EMAIL_OR_PASSWORD` counts toward lockout and writes an audit row. Any other 401 returns 500 internal and logs only the Better Auth code.
4. **Logging.** Better Auth logs only through the redacting logger. After this fix, a string message carrying DB params and a non-error object's `name` are both kept out of log lines. WebSocket and startup errors log only the error name, or name and message where the message is fixed.
5. **Migration guard.** The pin keeps comments, as startup's sqlite_master comparison does. Every rejection case, including the two earlier blocks, now names the check it must hit.
6. **Dev launcher.** `.dev/` is gitignored, and `.dev/data` and `.dev/secrets` are siblings (T21 ruling). The root scripts are additive and `verify` is unchanged.

## Remaining Minors

- C-M2: the CI pin is stricter than startup when a pinned-trigger chunk has a leading or trailing comment. It fails closed, and the committed 0001 passes. No action.
- Deferred ledger minors carried from T19 to T21:
  - T19: the WebSocket re-check fails open on a DB error.
  - T20 critic:M2: a SIGTERM then SIGINT runs stop twice.
  - T20 critic:M3: there is no uncaughtException handler. main.ts is now critical tier, so that change will get a critical review.
  - T21 critic:M1 to M4: the dev launcher's seed marker, child exits, Windows permission bits and e2e directory cleanup.
