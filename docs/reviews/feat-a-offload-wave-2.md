---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "91e5f545140ef51e51742521015fc3c1c3253a74"
verdict: "approve"
---

# Review: feat/a-offload-wave-2 (gate slice)

Date: 09-28-26.

## Scope

Branch feat/a-offload-wave-2, range ef1ec700cf3f116dacec0d93279dc05178c5a988..91e5f545140ef51e51742521015fc3c1c3253a74. The wave delivers Track A plan Task 26 (check-triggers and audit-stats ops scripts, openForOps), Task 31 (online encrypted backup, age and rclone upload), Task 34 (lost CREDENTIAL_KEY and DATA_KEY runbooks) and Task 24 lib only (grantRole with roleChanged audit), plus the scripts/tsconfig.json reference to packages/api. Gate files reviewed: packages/api/src/ops/{audit-stats,backup,check-triggers,grant-role,lost-key}.ts, scripts/ops/{audit-stats.ts,backup.sh,backup.ts,check-triggers.ts,lost-data-key.ts,lost-key.ts}, scripts/tsconfig.json.

## Findings summary

- Critical: 0. Important: 0. Minor: 2.
- Rulings kept as they stand: scripts/tsconfig.json reference (emit condition verified), T31 IC1 (withTransaction holds the write lock), IC2, C1 (guard against DATA_DIR), C2, T26 I1 and I2, T34 GUARD_TABLES = CANARY_GUARD_TABLES, T24 lib only, openForOps skips migrations and canary by design.
- Deferred minors recorded in context (T26 M1-M2, T31 M1-M3, T34 M1-M4, T24 M1-M4) stay minor.

## Cross-cutting checks

1. tsconfig reference emits declarations next to sources: clean detached worktree at the head, tsc -b exit 0; git status --ignored shows only dist/, dist-types/ and tsbuildinfo; no .d.ts or .d.ts.map under scripts/ or packages/api/src outside dist/.
2. Key or canary plaintext leak through canary errors: packages/api/src/keys/canary.ts KeyCanaryError names only the key variable; writeCanary params carry ciphertext, iv and authTag only; KeyCanaryError is not reachable from recoverLostKey.
3. Guard directory and lock mode: env.ts sets dbFile = join(DATA_DIR, "querymodule.db"); db/tx.ts uses behavior "immediate".

## Answers to the controller's questions

1. tsc -b emits nothing next to sources; output goes to each project's ignored dist/ (packages/api/dist/src/ops, scripts/dist/ops). No .gitignore change.
2. No path in T34 (success, RunbookOutdatedError, KeyCanaryError, trigger-check failure, argv refusal) prints or carries key material, the DB key or canary plaintext. Messages are fixed text, table names, trigger names or key variable names.
3. The write lock (BEGIN IMMEDIATE) is held for the whole copy and manifest write. The guard resolves against DATA_DIR and handles traversal and relative paths, with one edge (minor m1). backup.sh puts no secret in argv or logs.

## Remaining Minors

- m1 packages/api/src/ops/backup.ts:41: rel.startsWith("..") accepts a child directory whose name starts with ".." (for example /data/..x). Use rel === ".." or rel.startsWith(".." + sep), and add a test. No live caller passes such a path.
- m2 packages/api/src/ops/check-triggers.ts:10-18: doc says "never throws" but openForOps sits outside the try. The CLI still exits non-zero. Move the open inside the try or amend the doc.
