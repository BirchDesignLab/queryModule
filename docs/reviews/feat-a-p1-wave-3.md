---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "9b9e07ffb06664406501d47511e48a7cb6945315"
verdict: "approve"
---

# Review: feat/a-p1-wave-3 (critical slice)

Date: 09-28-26.

## Scope

Branch feat/a-p1-wave-3, range 938b798eb91f911b43f8e8b3dd33ab1fda155e7c..9b9e07ffb06664406501d47511e48a7cb6945315.
The wave delivers Track A P1 Tasks 14 to 17 (Better Auth, EventBus, IdentityService and
requireSession, the auth rate limiter, the app, deps and auth routes), plus inline #195
(the audit trigger pin keeps quotes), #190, the Dependabot typescript rule, the
`**/vite.config.ts` gate glob and the test-helper database close, and #193 (project-sync
Status). The merge of origin/main at the head (#202, #207) is not in scope.

Critical-tier files reviewed in full: `.github/sensitive-paths`, `packages/api/src/seams.ts`,
`scripts/ci/check-audit-migrations.ts`, `scripts/ci/check-audit-migrations.test.ts`.
The gate slice ran first in the same run: approve, 0 open critical or important.

## Findings summary

- Critical: 0. Important: 0. Minor: 3.
- Ledger rulings kept as they stand: the contract freeze (no change under
  packages/core/src/contracts in the range); T15 tier (Principal.email is `string | null`,
  actorOf returns AuditActor); #104 C-M2 (audited sessionId is the session row id); T14
  bearer fix (signed-only bearer, set-auth-token stripped for web); T17 C1 and C3 (JSON-only
  sign-in, allowlisted auth paths); #193 design (branch detection dropped).
- No controller ruling was needed in this slice.

## Cross-cutting checks

1. `packages/api/src/db/migrate.ts`: does the #195 pin drift from the startup
   `checkAuditTriggers`? Same statements (pinned by test), same whitespace collapse,
   case-sensitive compare and `;` strip. One gap: the guard turns comments into a space and
   startup does not, so a commented trigger passes CI and then startup refuses to serve
   (fail-closed, Minor M1).
2. `packages/core/src/contracts/audit.ts` and the Principal builder in
   `packages/api/src/auth/identity.ts`: does a null `Principal.email` break an AuditActor
   write? No. `AuditActorSchema.email` is nullable, identity.ts sets `email` through
   `auditEmail` and `sessionId` from the session row id.
3. `packages/api/src/auth/routes.ts` with users.ts, audit/service.ts, rate-limit.ts, the
   bearer config in auth.ts and a grep of `withTransaction`: can an auth path skip the
   limit, lockout or audit, or write audit rows outside the caller's tx? No bypass found.
   One fail-closed gap (Minor M3).

## Answers to the controller's questions

1. Auth and sessions: no. One handler covers `/api/v1/auth/*` (routes.ts:27). It returns
   404 unless standalone mode is on and the path is exactly sign-in/email, sign-out or
   get-session (:20-29). Every POST takes the IP limit first (:31-37). Sign-in rejects
   non-JSON bodies and an empty email (:72-79) and checks the lock before Better Auth
   (:82-87). The bearer plugin requires signed tokens, and a later hook strips
   set-auth-token for any request with an Origin (auth.ts:22-40, :115). Non-POST
   get-session is not IP-counted; it is left for the controller to rule on.
2. Audit: loginFailed, loginSucceeded and logout each go through `AuditService.record(tx, ...)`
   inside withTransaction (routes.ts:52-64, :95-102, :124-131). sessionId is the session row
   id (:90-100; identity.ts:90), never the token. There is one row per outcome and no
   double write. `Principal.email: string | null` keeps every actorOf write valid
   (audit.ts:201). routes.ts:98 is the one actor not built from a Principal (M3).
3. Transactions: no. The withTransaction bodies (routes.ts:52, :95, :124; rate-limit.ts:49,
   :62) use only tx. None nests another transaction or calls Better Auth. The Better Auth
   adapter is built with `transaction: false` (auth.ts:90).
4. Migration guard: yes. `pin` keeps quotes and literals raw on both sides of the compare
   (check-audit-migrations.ts:64-71, :114, :148), so a quote-kind edit to any of the three
   triggers fails. The committed 0001 is accepted, and the guard tests pass 63/63 at the
   head. It matches checkAuditTriggers except for comments (M1, fail-closed).
5. project-sync: this slice did not check it. Those files are gate tier, and the gate
   slice approved them.

## Remaining Minors

- M1 `scripts/ci/check-audit-migrations.ts:56-63`: `pin` turns comments into a space,
  but startup compares sqlite_master text that keeps them. Keep comment text in `pin`
  and add a test with an inline comment.
- M2 `scripts/ci/check-audit-migrations.test.ts:190-199`: the #195 assertion accepts
  "not allowed". The double-quoted RAISE case never reaches the pin. Assert "differs from
  migration 0001" for the seven cases that do.
- M3 `packages/api/src/auth/routes.ts:98`: the loginSucceeded actor uses the raw stored
  email and role, not `auditEmail`. If the address is invalid, the parse throws after the
  session is created, which gives a 500 and an unaudited session row whose token the
  client never receives.
