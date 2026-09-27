---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "9676d85ab7164e1988be85e44079a595e2e75752"
verdict: "approve"
---

# Review: feat/a-p1-wave-1

Date: 09-27-26

## Scope
The branch is feat/a-p1-wave-1. The first review covered the wave range 7dd896d39342040d5a2701c167c34499b0e0846e..c9f6d6016e739f55a044d82f7b589ce15a0d2cf9. This re-review covered the fix pass c9f6d60..9676d85ab7164e1988be85e44079a595e2e75752. The wave is M0 P1 Track A wave A1, Tasks 2 to 6 (#105 to #109) plus #96. It delivers:
- the api runtime dependencies and workspace settings
- readDeployEnv
- the secrets loader and the tiered .github/sensitive-paths inserts
- the spec 5.9 redacting logger
- the encrypted libSQL client, with a serializing lock, a bounded lock wait, a re-entrancy guard and withTransaction (BEGIN IMMEDIATE)
- the W6 review minors from #96

## Findings summary
The first review raised 0 critical, 4 important and 13 minor findings. There were no progress-check findings.

Important findings, all resolved in 9676d85:
- G-I1 and C-I1: the logger emitted Buffer and typed-array key material byte by byte. The walk now emits `[redacted]` for any ArrayBuffer view or ArrayBuffer (logger.ts:75). Key-name suffixes also redact credentialKey, dataKey and similar keys.
- G-I2: a secretValue containing a quote, a backslash or a control character survived JSON escaping. String leaves, keys and msg are now scrubbed before serialising, and the JSON-escaped form is scrubbed on the line (logger.ts:68, 86, 115, 119, 130).
- G-I3: a one-shot redactKeys iterator stopped redacting in child loggers. The keys are materialised once, and child() passes the Set on (logger.ts:109, 137-144).

Minor findings:
- Addressed: G-M1, G-M2, G-M3, G-M4, G-M5, C-M2, C-M3, C-M4.
- Standing as plan-mandated, both verified against the plan: G-M6 (image:smoke refers to boot-smoke.sh ahead of Task 27) and the Error.message part of C-M1 (plan Task 5 specifies name and message).

The fix introduced one new minor finding (see Remaining Minors).

No Important finding is kept as a stand. The ledger rulings T2, T3, T4, T5, T6 and #96 G-M5 still hold unchanged. There are no controller rulings.

The fix report shows RED then GREEN for every change. Lint (biome ci, 210 files), typecheck (tsc -b) and coverage (1009 tests) passed.

## Cross-cutting checks
1. The new rule that a SEED_PASSWORD_SECRET shorter than 32 characters fails closed could break boot in some provisioning path. It does not: dev secrets (plan line 3605) and CI secrets (plan line 4297) are both 44 characters, no repo fixture sets the value, and the seed script reads the secret directly. The secret remains optional for the server.
2. Every changed source file stays inside its tier: secrets.ts and db/** are critical, log/** is gate. The fix adds no new source files.
3. The C-M2 fix depends on how @libsql/client 0.18.0 defines `Transaction.closed` and `close()`. Checked: `closed` is `!db.inTransaction`, and `close()` runs ROLLBACK only while a transaction is open, then returns the connection to the pool. The body's own error now reaches the caller, and the lock is released.

## Answers to the controller's questions
1. db/client.ts, deadlock or lock leak: none through withTransaction. Waits are bounded. Rollback after SQLite has already ended the transaction now settles through close(), without masking the body's error. The re-entrancy guard walks enclosing scopes, so a nested transaction on another database no longer hides the outer one. Such a call now fails at once with NestedTransactionError instead of timing out.
2. secrets.ts, secret values in errors or returns: none. The new SEED_PASSWORD_SECRET length error names only the secret, and a test confirms the value is not echoed.
3. log/logger.ts, values surviving redaction: the reproduced paths are closed. These were binary key material, JSON-escaped secretValues, one-shot key iterators and header or token key variants. Error.message is still emitted as the plan specifies, and it is scrubbed for secretValues.
4. sensitive-paths and sensitive-review.ts, tier lowering: the fix pass did not touch them. The first review's answer stands: nothing was lowered.

## Remaining Minors
- N-M1: logger.ts:78-91. Cycle detection now tracks only the current path, so an object graph with heavy sharing is walked once per path. That can be exponential in depth, the same as JSON.stringify. A depth or node budget would bound it.
- G-M6: `pnpm image:smoke` fails until Task 27 creates scripts/ci/boot-smoke.sh. No CI step runs it.
- C-M1 residual: Error.message is emitted apart from the secretValues scrub.
- Plural key forms (tokens, secrets, cookies, passwords) are not matched by the suffix rule. Values nested under such keys are still redacted when their own keys match.
