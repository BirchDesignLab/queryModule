---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "503ef39a518e06f51deaa734a4b47bcdd3ea582d"
verdict: "approve"
---

# Review: feat/m2-a-p2-wave-4 (10-18-26)

## Scope

Branch feat/m2-a-p2-wave-4, range 67b1b0a43ec1e085d60d98ace56bf81574e3f8ca..503ef39a518e06f51deaa734a4b47bcdd3ea582d (review 2; review 1 approved 712ff4a, and the only change since is 503ef39, ws/server.ts frame window on the monotonic clock plus its test). Wave AW4 delivers: the #716 G-M1 Better Auth session ceiling margin; Task 10 (#718, D-M2P0-4) the stored publish note, migration 0011 freezing it once a row leaves draft, the publisher's name on the version list and live config, and the C-m1 one-row backfill check; Task 11 (#719, NFR-004) Server-Timing on every 202 from request receipt; Task 12 (#720, D-M2P2-4) the ackReceipt log metric and scripts/ops/ack-stats.ts; the C1 per-socket client frame cap (4029).

Gate slice: approve, 0 open critical or important findings. Critical slice (this reviewer, Opus 5.5 high): approve, 0 critical, 0 important, 1 minor.

## Findings summary

- Critical: 0. Important: 0. Minor: 1 (critical slice), listed below.
- No critical or important finding needed resolving in this review.
- Rulings kept as they stand: D-M2P0-4 (note stored and served, never in audit), D-M2P2-2, D-M2P2-4 (ackReceipt is a log metric, not audit), #716 G-M1 ruling, C1 ruling (frame cap 120 per 60 s, close 4029).
- Controller rulings kept: Task 10 manager ruling (drizzle/meta is generated; snapshot and journal verified by a checker, not reviewed line by line); T10 Q1 (publish and rollback answers omit publishedByName) and T12 Q2 filed by the manager; G-G-m2 filed by the manager.

## Cross-cutting checks

1. packages/api/drizzle/0009_config_document_hash.sql, risk: 0011 drops or alters a 0009 frozen-trigger condition. Found: verbatim match apart from the one added note clause, and the startup check text in db/migrate.ts equals 0011, so a drifted trigger fails boot closed.
2. packages/core/src/contracts/admin.ts, risk: a stored note or publisher name failing ConfigVersionSchema (a 500 on the versions list), or an untrimmed note stored. Found: PublishNoteSchema trims and bounds the note the same way on input and output; publishedByName max 128 matches the admin user name bound.
3. packages/api/src/app.ts, risk: the receipt mark registered after the body cap or X-Requested-With check, or on other routes. Found: mounted first for POST /api/v1/queries only, ahead of the cap, requireRequestedWith and requireSession.

## Answers to the controller's questions

1. Confirmed: since 712ff4a only ws/server.ts and test/ws/frame-cap.test.ts changed; the critical files are identical to the approved head and were re-read in full with no new critical or important finding.
2. Reviewed 0011_config_note.sql, the recreated site_config_version_frozen trigger and CONFIG_VERSION_TRIGGER_SQL in db/migrate.ts; the snapshot JSON was not read line by line per the manager ruling.
3. Yes: every 0009 condition is kept verbatim; `NEW.note IS NOT OLD.note` sits inside the `OLD.status <> 'draft'` group, so published and superseded notes are frozen (NULL included) while a draft's note stays writable, with tests for each direction. No path writes or rewrites an audit row; the note is never in configPublished details or a log line.
4. Yes: the receipt mark is set before the body cap and requireRequestedWith on POST /api/v1/queries only; Server-Timing is set only on the fresh, replay and idempotency-race 202s; error responses carry none.
5. Yes: no frame value in any log line (the cap line names the session only); the owner check (authorizeQueryAccess read own) runs before the audit read; every client frame spends the budget before parsing or any DB read; the window runs on d.monotonic.nowMs(); 4029 is a local close code separate from the contract's 4001.

## Remaining Minors

- C-m1 (critical slice, test coverage): packages/api/src/queries/route.ts. The lost-idempotency-race 202 carries Server-Timing through the shared final header line, but no test pins it; add one race test asserting the header.
- Gate slice minors, if any, are recorded in the gate slice report.
