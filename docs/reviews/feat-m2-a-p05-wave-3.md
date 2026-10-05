---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "6e1d499657610001601265dfa9ad9ccce2353612"
verdict: "approve"
---

# Review: feat/m2-a-p05-wave-3 (critical slice)

Date: 10-05-26.

## Scope

Branch feat/m2-a-p05-wave-3, range 5f101af2bcb7b7706903e30c91c3690c9e7d02ee..6e1d499657610001601265dfa9ad9ccce2353612. The wave delivers M2 P0.5 Track A Wave 3:

- AW2 review minors C-m1 and C-m2: createMockAdapter runs the fixture policy itself, and the adapter serves a checked private copy of the mock.
- Task 8 (#535): the in-process dispatcher with per-source deadlines, caps 4 per source and 32 global, credentialsMissing without an adapter call, the timers seam (spec 5.2 step 5).
- Task 9 (#536): outcome transaction T2 (write-once update, sourceResponded audit, sourceStatus event_log row, seq-ordered outbox publish, d.fatal fail-closed path) (spec 5.2 step 6).
- Task 10 (#537): dispatch tests and stories.json A4.
- AW3 critic fixes (a) requester envelope on sourceResponded, (b) planJobs before T1 and bindJobs after it with a post-commit backstop, (c) abort acknowledgement is not a late settlement, (e) and (f) test pins, m2 latency from the acknowledgment, m3 doc note.

Critical files reviewed in full: `adapters/mock.ts`, `dispatch/dispatcher.ts`, `dispatch/outcome.ts`, `dispatch/timers.ts`, `main.ts`, `queries/acknowledge.ts`, `queries/route.ts`. The gate slice ran first and approved with no open critical or important finding.

## Findings summary

- Critical: 0. Important: 0. Minor: 3 (below).
- All five manager must-checks hold: adapters reached only through registry.get with the pinned snapshot; sourceResponded carries the requester's envelope and the credential owner (SEC-010, SEC-011); every throwing guard runs before T1 and the post-commit backstop fails closed through d.fatal; T2 is write-once, one transaction, published after commit in seq order, DEK zeroed; logs carry ids and error class only (spec 5.9).
- Rulings kept as they stand: (b) shape with backstop, (c), (d) residual, m2, m3, m4, M1 carried to Task 13, Task 9 d.fatal microtask rethrow, Task 10 story tags, the AW2 registry rulings.
- D-A15 governs over spec v2 :203 (`maxConcurrent` parsed, caps are constants); set aside, not a finding.

## Cross-cutting checks

1. `deps.ts` (d.fatal wiring): risk that fatal throws synchronously or skips the abort. Found: abortAll first, then a microtask rethrow to main.ts fail(). No gap.
2. `core/src/config/schema.ts:47` (timeoutMs source): risk of Node timer overflow. Found: no upper bound on timeoutMs; recorded as minor C-m2.
3. `events/bus.ts` (publish inside T2's try after commit): risk that a handler throw mislabels a committed T2 as failed and stalls the outbox. Found: each handler runs under try/catch, publish never throws. No gap.

## Answers to the controller's questions

None asked.

## Remaining Minors

- C-m1 `queries/route.ts:151`: the 202 body is schema-parsed after T1 commits and jobs are enqueued, so a schema miss (bug only) would answer 500 for a committed query; pre-existing shape, retry replays the 202. Parse before commit, inside acknowledge.
- C-m2 `dispatch/dispatcher.ts:134-137`, `:213`: a timeoutMs above 2147483647 ms is clamped by Node to 1 ms, timing out every job on that source at once (fails safe). Bound timeoutMs in the config schema or clamp in the dispatcher.
- C-m3 `adapters/mock.ts:128`, `queries/route.ts:84`, `:115`: doc comment lines edited this wave exceed 100 columns; reflow.
