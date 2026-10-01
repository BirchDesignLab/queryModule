---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "40c723f74b8c889c9bad8c8164b8c3eefbb234fa"
verdict: "approve"
---

# Review: feat/lean-sdd-login-stats

Date: 10-01-26

## Scope
Branch feat/lean-sdd-login-stats, range 7553d6fe2d456b54d236b50ba8f68579fe186322..40c723f74b8c889c9bad8c8164b8c3eefbb234fa, gate slice only. The wave delivers a read-only ops CLI, login-stats, printing sign-ins per account (count, distinct client IPs, last sign-in UTC, optional --since YYYY-MM-DD) from audit_event loginSucceeded rows, and adds it to the image boot smoke. Gate files: packages/api/src/ops/login-stats.ts, scripts/ops/login-stats.ts, scripts/ci/boot-smoke.sh.

## Findings summary
- Critical: 0. Important: 0. Minor: 2.
- No ledger rulings or controller rulings were contested; developer rulings of 10-01-26 (output shape, "never", strict --since, exit 2) stand and are met.

## Cross-cutting checks
1. packages/api/src/ops/audit-stats.ts (openForOps): risk of migrations or a canary in the ops open path. None; env, secrets, encrypted open only.
2. packages/api/src/auth/routes.ts:96-103: risk of a details key or actor id mismatch giving silent zero counts. loginSucceeded writes clientIp and actor.id as the user id; the query matches.
3. packages/api/src/db/schema.ts and db/client.ts: risk of wrong raw SQL column names. Drizzle casing is snake_case; actor_user_id, at, type, details exist.

## Answers to the controller's questions
1. No client IP value, extra email or secret is printed: output is account email, counts and a UTC time (login-stats.ts:62-68); IPs are only counted inside SQL (login-stats.ts:43); stderr gets only the usage string (scripts/ops/login-stats.ts:16-18).
2. Yes. One SELECT over user and audit_event (login-stats.ts:40-50), opened through openForOps with no migration; the db is closed in finally (scripts/ops/login-stats.ts:22-26); a usage error exits before the open.
3. Yes. Exactly zero args or "--since YYYY-MM-DD" with a UTC round-trip check (login-stats.ts:17-31); anything else exits 2 (scripts/ops/login-stats.ts:13-20); the smoke asserts 2 on "--since yesterday".

## Remaining Minors
- M1 login-stats.ts:43: distinct IPs skips null clientIp rows, so an unknown address is not counted; document it or count it as one bucket.
- M2 boot-smoke.sh:110-118: the smoke runs on an empty db, so it proves exit codes, not row shape; the unit test carries row shape.
