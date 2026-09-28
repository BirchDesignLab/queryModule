---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "824ce15dd623a184e35aca01390b97af32e669ec"
verdict: "approve"
---

# Sensitive review: feat/a-p1-wave-2 (M0 P1 Track A, wave A2)

Reviewed 09-27-26 by Opus 5.5 at effort high (critical tier, ADR-0007).

## Scope

Branch `feat/a-p1-wave-2`, 1a64606..824ce15 (18 commits, 33 files). This includes the merge of origin/main at 5a1a02f and the review fix pass 5a1a02f..824ce15 (commit 824ce15, 10 files).

The wave delivers:
- Tasks 7 to 11 (#110 to #114):
  - Migration 0001 adds three audit_event append-only triggers (BEFORE UPDATE, BEFORE DELETE, and audit_event_no_replace). Migration 0002 adds nullable default_view and locale to user_preference.
  - runMigrations runs through the serialising Db. checkAuditTriggers pins each trigger's stored SQL and fails closed.
  - `scripts/ci/check-audit-migrations.ts` guards audit_event: only additive changes and the initial triggers pass, and nothing may touch the schema table.
  - SEC-006 key canaries, with guard tables for the first-boot case.
  - AuditService.record writes only through the caller's transaction.
- `scripts/ci/check-schema-writes.ts`: the source layer for #189. It blocks writable_schema and any schema-table write in packages/api/src.
- #172 (openapi route parity), #183 (bounded logger walk), #184 (core-purity alias and destructure tracking), and the dependabot ignores.

## Findings summary

- Critical: 0.
- Important: 3 findings covering 2 defects, all fixed in the fix pass.
  - G-I1: comment stripping in check-schema-writes.ts did not know about strings. It is now a scanner that knows about strings, templates and regex literals, so a glob or URL holding `/*` or `//` no longer hides a later `PRAGMA writable_schema`.
  - G-I2 and C-I1: the migration guard accepted CREATE UNIQUE INDEX on audit_event. It now accepts only a non-unique CREATE INDEX, per spec 9.2 and 5.5 and ruling C-I1 (fix). The fix is limited to the guard.
- Minor: 7 from the first review, all fixed:
  - G-M1: UPDATE OR <conflict> and any schema prefix are now caught.
  - G-M2: the core-purity alias terminator now matches the destructure path.
  - C-M1: the CI guard now pins the exact trigger text from migration 0001, with a parity test against migrate.ts.
  - C-M2: SQL comments between keywords are now caught.
  - C-M3: check-schema-writes.ts is now critical tier.
  - C-M4: the canary create path is now one IMMEDIATE transaction that never overwrites, followed by a verify.
- Ruler rulings kept as stands: none. C-I1 was a fix ruling, and it is addressed.
- Controller rulings: none for this review.

Gate on the fix head: lint clean, typecheck clean, and 1259 tests passed in 94 files with coverage thresholds met. RED and GREEN were shown for every fix.

## Cross-cutting checks

1. Risk: the new CI-layer trigger pin can be matched by a changed statement that also gets past the startup check. migrate.ts compares the whitespace-collapsed raw text, so a quote-kind change fails closed at startup. See M2 below.
2. Risk: the canary race test wraps a path the real code does not take. withTransaction calls `db.transaction(..., { behavior: "immediate" })` (tx.ts:12), so the wrapper sits on the real path and the re-read inside the transaction is serialised.
3. Risk: the guards are no longer wired into CI, or the new canary SQL trips the source guard. ci.yml:86 and :88 still run both CLIs. On packages/api/src, check-schema-writes prints "no schema-table writes".

## Answers to the controller's questions

1. Statement forms and the migration guard. With today's schema, no statement gets past the triggers at run time. The one gap from the first review was a future unique index that lets REPLACE delete a row without firing a trigger. The guard now closes it: unique, partial-unique, commented, quoted and `main.`-prefixed forms are all rejected. An in-place WHEN clause or RAISE edit to 0001 is now rejected in CI. The one exception is a quote-kind change (M2), and startup still rejects that.
2. checkAuditTriggers and runMigrations. The fix did not change them. They still require all three triggers with their pinned text and fail closed.
3. Key canaries. Before, a second process could overwrite a canary sealed under another key between the read and the create. Now the create re-reads the row and checks the guard table inside one IMMEDIATE transaction, then inserts with ON CONFLICT DO NOTHING, and the stored row must open under this process's key. A concurrent process with a different key therefore fails with KeyCanaryError and never overwrites the other canary.
4. AuditService and check-schema-writes.ts. AuditService is unchanged. The source guard now catches the string, template, regex, SQL-comment, conflict-clause and schema-prefix forms raised in the first review. A narrow residual needs contrived code (M1). #189 remains the connection-level block.

## Remaining Minors

- M1 (new): `scripts/ci/check-schema-writes.ts:78-86`. The division-versus-regex guess can be wrong in three cases: division after `}`, division after a property named like a keyword (for example `this.in / 2`), and a regex after `)`. The scanner then resumes inside a later string, and a `/*` in that string hides the code after it. The comment at :84 says a wrong guess never hides code, which is not true. Suggested fix: treat a word preceded by `.` as a value, and correct the comment.
- M2 (new): `scripts/ci/check-audit-migrations.ts:143`. The pin compares `detect`, which drops string-literal quotes. An in-place edit to `WHERE 'id' = NEW.id` therefore passes CI, and it disables audit_event_no_replace (verified in node:sqlite). Startup rejects it through migrate.ts `collapse`. Suggested fix: compare the whitespace-collapsed raw text, the same way migrate.ts does.
- Deferred minors already ledgered stay deferred:
  - canary tests do not close their db handles;
  - the writeCanary overwrite path is untested (writeCanary is now runbook-only);
  - a malformed key raises RangeError or KeyCanaryError depending on whether the row exists;
  - the tampered-canary AAD cases;
  - the T11 and #184 minors.
- Follow-ups: #189 (a connection-level writable_schema block, critical). Turning on REQUIRED_PRAGMAS recursive_triggers, or tightening checkAuditTriggers, belongs to the T6/T8 db surface, as ruling C-I1 notes.
