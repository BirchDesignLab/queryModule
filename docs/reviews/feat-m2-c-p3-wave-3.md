---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "4184a542ec11fdfb592cfe1b18e68ddfcfde7e3e"
verdict: "approve"
---

# Review: feat/m2-c-p3-wave-3

Date: 10-20-26.

## Scope

Branch feat/m2-c-p3-wave-3, range ac047ab46f58fa04d9c4dc4ce6de31b0436d6d0e..4184a542ec11fdfb592cfe1b18e68ddfcfde7e3e. The wave delivers `db:reset` (#821, ADR-0015): it backs up, wipes and reseeds the demo database on a mock-only site. It also carries the #822 CW2 minors: exact-origin checks for CORS_ORIGINS and PUBLIC_ORIGIN (G-m4), plus the add-demo-users JSDoc and the board-model pins (G-m1 to G-m3). The run has two slices. The gate slice (Opus medium) approved with 0 open critical or important findings. The critical slice (Opus high) reviewed packages/api/src/ops/db-reset.ts in full. The manager ruled it critical because it deletes audit rows.

## Findings summary

- Critical: 0. Important: 0. Minor: 1 (C-m1, below).
- Ledger rulings kept as stands: ruling 1 (the HTTP probe is the primary guard; the write lock is a point-in-time check), ruling 2 (mock gate = ALLOW_MOCK_SOURCES plus every loaded source mock), ruling 3 (output names the backup; docs/deploy.md gives the restore), Q6 (post-delete failures name the backup and docs/deploy.md).
- Deferred task minors Q1 to Q6 were resolved by controller commits eccba46, 72487ff, a360ffc and 1ad8a7a: probe before open, guard 4 and mock-null tests, backup name from env.dbFile, and backup path on partial failures. Deferred minor Q2 (lock not held through the delete) stands under ruling 1. Q3 (open writes before the site guards) stands as harmless now that the probe runs first.

## Cross-cutting checks

1. packages/api/src/ops/backup.ts. Risk: the printed backup file is not the file written, the backup is incomplete, or it lands in the data dir. Found: takeBackup refuses an outDir inside dirname(dbFile), checkpoints, then copies `basename(dbFile)` and `-wal` under a write transaction and writes the manifest. db-reset prints the same name, under `/backup`. No issue.
2. packages/api/src/seed/seed.ts and packages/api/src/ops/add-demo-users.ts. Risk: a password in the partial-failure messages that db-reset prints to stderr. Found: emails, counts, cause class and code only. No issue.
3. scripts/ops/db-reset.ts. Risk: the probe hits a host or port the app does not listen on. Found: `http://${DB_RESET_APP_HOST ?? "app"}:${env.port}` with the service's own env. deploy/compose.yml names the project `querymodule`, so the restore command's `querymodule_data` volume is right. No issue.

## Answers to the controller's questions

1. No path opens or writes the database while the app answers its health route. The probe runs before the open, and only a refused connection or a DNS failure counts as stopped. A write lock held before the open is refused (SQLITE_BUSY from loadDeps). One held after the open is refused by guard 4, and one held during the backup fails the backup with nothing deleted. Residual window, accepted by ruling 1: an app started between the checks and the unlink. Every refusal leaves no backup, no delete and no new file. Refusals after the open may follow the app's normal start-sequence writes (C-m1).
2. No. ALLOW_MOCK_SOURCES off, `LoadedConfig.mock` null, an empty or non-mock source, or a --confirm that differs from the loaded site id each refuses.
3. Yes. The backup must succeed before the delete. It holds the db and -wal copied under the write lock, sits outside `/data`, and is printed before the delete. Every post-delete failure names the backup file and docs/deploy.md. The restore command removes the -wal and -shm, copies `querymodule.db*` (not manifest.json), chowns to 10001 and runs between stop and start. Correct.
4. Only stdout carries passwords (the seed and add-demo-users table). Stderr is fixed text plus error name and code, and the CLI discards the log sink. The range touches no audit, migration, startup or scripts/ci file. ADR-0015 states the exception precisely, apart from the lock wording in C-m1.
5. Yes. `new URL(v).origin === v` over http and https refuses a path, query, fragment, user info, trailing slash, uppercase host, default or invalid port, unicode host and `null`. It accepts every tracked value: the deploy origin, `http://localhost:3000`, `http://localhost:5173`, `http://127.0.0.1:9` and the URL-normalized `target.origin` values.

## Remaining Minors

- C-m1: docs/decisions/0015-demo-database-reset.md:28 and docs/deploy.md:104 overstate two things. They describe the write lock as taken "before deleting anything" or "first". They also say every refusal "leaves nothing behind". In the code, the lock is a point-in-time busy check released before the backup and the unlink (ruling 1). Refusals after the open can follow loadDeps' normal start writes. Fix: reword both docs to match.
