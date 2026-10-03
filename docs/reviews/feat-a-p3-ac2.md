---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "a09d8085b980ea35db4aa42ca4459e435f190c86"
verdict: "approve"
---

# Review: feat/a-p3-ac2 (10-03-26), combined record

Two wave-review runs cover this branch; the controller assembled this record from both (the front matter's effort is the critical slice's).

1. **Run wf_3748b1e0-25e** on b16d54a..632a4b8 (merge base with main to the end of the AC2 sdd-wave): gate slice Opus 5.5 medium and critical slice Opus 5.5 high (12 critical, 12 gate files, 2472 lines). Findings G-I1 to G-I4, C-I1 and the minors were ruled and fixed in 960e47f; the re-review at Opus 5.5 high found every Important addressed and one new gate Important (rr:N-I1) plus minors. No critical file changed after 960e47f (`git diff --name-only 960e47f a09d808`: packages/api/src/auth/routes.ts, packages/api/test/security/auth-limits.test.ts).
2. **Run wf_462d4b95-6a2** on 960e47f..a09d808 (the inline rr:N-I1 fix): gate slice Opus 5.5 medium, verdict approve, recorded below.

Open minors (G-G-m3, G-G-m4, rr:N-m1 from run 1; G-m1, G-m2 from run 2) are tracked in #505; none blocks.


# Review: feat/a-p3-ac2 (gate slice, re-review r2), 10-03-26

## Scope
Branch feat/a-p3-ac2, range 960e47f9c50952b250ea0b085e0e60d2861591d9..a09d8085b980ea35db4aa42ca4459e435f190c86, gate file packages/api/src/auth/routes.ts. The wave delivers user administration (ADR-0011) with disabled accounts; this commit (rr:N-I1) routes a disabled account's sign-in through Better Auth's own handler so body validation and credential checks match active and unknown accounts.

## Findings summary
- Critical: 0. Important: 0. Minor: 2.
- rr:N-I1 (important, prior re-review): resolved in a09d808. Malformed bodies answer the same 400 with no lockout count for disabled and active accounts; tests cover missing, non-string and over-long password and padded email.
- Rulings kept as stands: G-I2 (same 401, same credential cost, counts toward lockout), C-I1 (audits accountDisabled), D-A26 (no session for a disabled account), #212 G-M2 (only bad-credentials 401s count).
- Controller rulings: none new in this slice.

## Cross-cutting checks
1. packages/api/src/auth/auth.ts, risk of a session-create hook turning a correct-password disabled sign-in into a 500 oracle, or bearer's set-auth-token leaking: no database hooks; the disabled path discards Better Auth's response headers. No issue.
2. packages/api/src/auth/identity.ts, risk of a surviving session row being usable: resolve refuses any session whose user has disabledAt set (identity.ts:68). Fail-closed.
3. packages/api/test/security/auth-limits.test.ts, risk of untested behaviour: tests pin 401, no Set-Cookie, zero session rows, verify count, malformed-body parity and no loginFailed rows.

## Answers to the controller's questions
1. Yes. Non-JSON or empty email: same 400 before lookup (routes.ts:104,110). Locked: same 429 (routes.ts:113-117). Malformed body: Better Auth's 400 for all, disabled branch skipped (routes.ts:125), no count. Bad credentials: 401 INVALID_EMAIL_OR_PASSWORD and one recordFailure on the same account key for disabled (routes.ts:131-133), active and unknown (routes.ts:157). Other 401s: internal 500, no count, for all (routes.ts:129,156).
2. No. Sessions are deleted by user id before answering (routes.ts:127); the 401 is a new response with no Set-Cookie (routes.ts:133); loginSucceeded (routes.ts:142-149) is unreachable for a disabled target. If the delete itself throws, a row may survive but no cookie is sent and resolve refuses it.

## Remaining Minors
- m1 auth-limits.test.ts:45: test title says "hashes"; it now asserts verify.
- m2 routes.ts:127: a throwing session delete answers 500 rather than 401 (visible only to a password holder; fail-closed). Optional try/catch with log and 401.
