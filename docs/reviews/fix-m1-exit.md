---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "26d65ffd386c1de0657ecfb325c32aa7b0379fc1"
verdict: "approve"
---

# Review: fix/m1-exit

Date: 10-04-26.

## Scope

Branch fix/m1-exit, range ae68d2cb82f7866f631c3dbc861c03665c9d8b1e..26d65ffd386c1de0657ecfb325c32aa7b0379fc1. The M1 exit PR (Task 17, #237; #487): backup.sh rclone version floor, smoke step 3 query submit, restore-test ALLOW_MOCK_SOURCES, image revision label, and the M1 whole-phase review fixes LS-1, LS-2, AUD-2 to AUD-5 and Q3, plus residual and minor passes. Mixed PR: gate slice (Opus 5.5 medium) ran first and approved with 0 open critical or important findings; this critical slice (Opus 5.5 high) covers packages/api/src/main.ts and packages/api/src/startup.ts.

## Findings summary

Critical slice: 0 critical, 0 important, 2 minor. Gate slice: approve, 0 open critical or important.

- LS-2 verified: the "startup refused" stderr line keeps the message only for fixed-text startup classes (StartupRefusedError, DeployEnvError, ConfigLoadError, SecretConfigError, KeyCanaryError, TriggerMissingError, DatabaseOpenError, DatabaseLockTimeoutError); any other error gives its name and a SQLITE_ or Node system code token only (spec 5.9, 8.1).
- bootstrap's configLoaded audit failure now throws a fixed StartupRefusedError with no cause and closes the DB first; the audit row contract (SEC-010, spec 5.8 step 7) is unchanged.
- Rulings kept as they stand: developer 10-04-26 phase review split; X1 AUD-3 (403 for a stale principal); X1 CV1 (boot-smoke AUD-4 confirmed by CI); gate item 9 run, not waived. No controller rulings in this slice.

## Cross-cutting checks

1. Fixed-text whitelist embedding a value: every class definition and non-test throw site read (env.ts, config/load.ts, admin/config activate and store, secrets.ts, keys/canary.ts, db/migrate.ts, db/client.ts). All messages are fixed text, keys, pointers, names, paths or numbers. No leak.
2. packages/api/src/log/error-fields.ts letting a value through: message kept only for whitelisted instances, cause walk bounded at 5, codes only as SQLITE_ or E-prefixed uppercase tokens, name filtered. Safe.
3. Tests on the real path: startup.test.ts unit cases and main-fatal.test.ts child-process cases (bad PORT, EADDRINUSE without the address, bootstrap refusal with no cause) assert the new behaviour.

## Answers to the controller's questions

None asked.

## Remaining Minors

- M-1 startup.ts:98-105: the bootstrap catch drops the driver code from its log line; add `error: errorFields(e)` (name and code token only) so operators can tell SQLITE_FULL from a trigger abort.
- M-2 startup.ts:26: the FIXED_TEXT_STARTUP_ERRORS comment undersells what the classes carry (JSON pointers, message keys, a timeout number); reword to "app-built fixed text, never a value" and warn that a class added there must never embed a value.
