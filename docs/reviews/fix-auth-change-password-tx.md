---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "906008e02004bbe68b152fc77b6edb62edb5ecc0"
verdict: "approve"
---

# Review: fix/auth-change-password-tx

Date: 10-17-26. Gate slice, Opus 5.5 medium.

## Scope
Branch fix/auth-change-password-tx, range 5132459360d95e32a204be4d4d87ecedcdeb7989..906008e02004bbe68b152fc77b6edb62edb5ecc0 (906008e, #690 PR-2). The app performs change-password itself: verify and hash through Better Auth's $context.password, then the account.password update, the must_change_password clear and the passwordChanged row commit in one transaction. The clear-must-change-password plugin is removed. Gate files: packages/api/src/auth/auth.ts, packages/api/src/auth/routes.ts.

## Findings summary
Critical 0, important 0, minor 3. Ruling on #690 (option A, conditions a to f) kept as stands; the plan Rulings line "passwordChanged audit failure" is marked closed by this PR. No controller rulings needed.

## Cross-cutting checks
1. packages/api/src/db/tx.ts: withTransaction awaits the async callback and rolls back on throw, so the three writes are atomic.
2. packages/api/src: no server-side auth.api.changePassword caller relied on the removed plugin to clear the flag.
3. Better Auth update-user.mjs: /change-password is POST only, so non-POST requests forwarded to Better Auth cannot change a password; refusal codes match.

## Answers
1. Atomicity: one withTransaction (routes.ts:288-305) holds all three writes; the hash is computed before it but stored only inside. The audit failure test proves the old password works, the flag stays set and no row is written.
2. Guards and parity: IP limiter (routes.ts:35-41), resolveGated (250), revokeOtherSessions and same-password refusals (257, 262), Better Auth codes and order (265-278) kept; a missing or non-string field is 400 validationFailed (259-260).
3. Secrets: the log has ids and errorName only, audit details targetUserId and via, the response { token: null }; hash and verify only via $context.password with its config bounds.
4. Plugin removal: /change-password was its only matcher; other Better Auth password paths are 404 (tested) and non-POST hits a POST-only endpoint. The pin test catches loss of $context.password hash or verify, changed length config, or a credential row not keyed providerId "credential".

## Remaining Minors
- auth.ts:212 comment still points at the removed plugin.
- routes.ts:259-260 a malformed body maps to the client's samePassword message.
- Tests lack CREDENTIAL_ACCOUNT_NOT_FOUND, over-long currentPassword and non-POST /change-password cases.
