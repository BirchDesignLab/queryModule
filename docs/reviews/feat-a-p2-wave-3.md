---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "d3a0d9bcd8dacf7471b2b9553b3871c393d6df2a"
verdict: "approve"
---

# Review: feat/a-p2-wave-3 (critical slice)

Date: 09-28-26. Reviewer: Opus 5.5, effort high. The gate slice of this run approved with 0 open critical or important findings.

## Scope

Branch feat/a-p2-wave-3, range 36932f2..d3a0d9bcd8dacf7471b2b9553b3871c393d6df2a. Wave A3 of Track A P2 (plan 2026-09-28-track-a-p2, Tasks 11 to 15):

- Task 11 (#277): shared AES-256-GCM helper (keys/aead.ts), per-request values and payload DEKs wrapped under DATA_KEY (keys/request-keys.ts), key canaries on the helper, byte-compatible with P1.
- Task 12 (#278, gate): lost-data-key shreds request_key and audits one retentionPurged per scope.
- Task 13 (#279): query_request, source_result and request_key tables (drizzle 0003), insert-once, write-once and no-delete triggers (0004), no-REPLACE and positive-rowid triggers (0005), checkQueryTriggers at server startup and in the ops boot smoke.
- Task 14 (#189): the app connection refuses writable_schema on every statement path.
- Task 15 (#280): every gate CLI runs main through isMainModule.

## Findings summary

- Critical: 0. Important: 0. Minor: 1 (m1).
- Run 1 findings resolved in 9ace737 (C-I1 INSERT OR REPLACE by explicit rowid, C-I2 REPLACE through the idempotency index, C-M1 status CHECK, C-M2 fixed-message PartValuesError, G-G-I1, G-G-m1, G-G-m2) and the re-review residuals rr:N1 (UPDATE OR REPLACE by rowid) and rr:N2 (the -1 rowid wedge) resolved in 0eab4d8. All confirmed fixed and pinned in QUERY_TRIGGER_SQL.
- Rulings kept as they stand: Task 11 quality:I1 / critic:C1 (IV and tag lengths pinned; no caller passes authTagLength or bypasses the helper, confirmed); Task 14 quality:CV1, critic:CV1, progress-r1-1 (no defensive-mode option in @libsql/client 0.18); the deferred minors queued in the ledger (not re-reported).
- No new controller ruling needed.

## Cross-cutting checks

1. A critical guard bypassed through a lower-tier import: scripts/ci/check-audit-migrations.ts and check-schema-writes.ts (critical) now import scripts/ci/is-main-module.mjs (gate). Reported as minor m1, following the deps.ts precedent; the startup trigger check stays the primary control.
2. An ops path skipping the writable_schema refusal: openForOps opens through openDatabase and createClient appears only in db/client.ts. No bypass.
3. A statement form outside the tests still deleting or overwriting a row: an in-memory probe of 0003 to 0005 refused UPSERT (DO UPDATE and DO NOTHING), UPDATE OR REPLACE via source_id, oid and _rowid_, multi-row and SELECT-sourced REPLACE, and REPLACE with text or real part_id through the idempotency index; normal inserts and pending to returned still pass.

## Answers to the controller's questions

1. No statement form (INSERT or UPDATE with OR REPLACE, UPSERT, explicit rowid, UPDATE OR REPLACE) can delete or overwrite a query_request or source_result row: UPDATE and DELETE abort (0004:1-2, 0004:13-14, 0005:17-18); BEFORE INSERT triggers cover every uniqueness constraint and the rowid (0005:1-15); source_result_write_once pins every unique column and the rowid (0004:4-11). The positive-rowid triggers (0005:20-26) never refuse a normal insert. Startup fails closed on a missing or altered trigger on the server (deps.ts:43, db closed on throw) and in the ops boot smoke (ops/check-triggers.ts:24).
2. No caller can open with a truncated tag or wrong-length IV (aead.ts:36, authTagLength 16 at :39); a wrong IV fails authentication. Each seal takes a fresh random 12-byte IV and DEKs are fresh per request. Errors carry fixed messages and no cause; DEKs are returned only to the creating caller by design. P1 canaries still open (same AAD bytes, IV 12, tag 16).
3. Yes: lost-data-key shreds request_key and writes one retentionPurged per scope, zero counts included, in the same transaction as the canary write (ops/lost-key.ts:48-86); an audit failure rolls it all back; before the table exists only the canary is rewritten.
4. Yes: every guarded scripts/ci CLI uses isMainModule; the others run unguarded top-level code. The spawn test removes its link as a link (rmdirSync on a junction, unlinkSync elsewhere) before any recursive removal, only inside its mkdtemp directory, and a failed link removal stops the cleanup before rmSync runs.

## Remaining Minors

- m1: add scripts/ci/is-main-module.mjs to [critical] in .github/sensitive-paths (and the CLAUDE.md critical list), since it decides whether the critical audit-migration and schema-write guards run.
