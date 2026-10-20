---
date: 10-20-26
status: accepted
track: a
phase: m2-p3
supersedes: ["spec 12.7 M2 row (replay excludes hidden)"]
---

# 0014 M2 exits without "replay excludes hidden"; it moves to the M3 P2 gate

## Context

Spec 12.7 lists "replay excludes hidden" among the M2 security tests. Hiding a result from view (`result_visibility`, the `resultHidden` event, FR-062, SEC-013) lands in M3 P2 with "hide owner-only" (spec 12.2 M3 P2 row, 12.7 M3 row). In M2 the hide feature is flagged off and nothing can be hidden, so replay (spec 10.4) carries only `sourceStatus` rows (ids and statuses) and there is no hidden result for a test to exclude. A test written now would pass without proving anything. The developer ruled D-M2P3-2 on 10-19-26, as recommended (M2 P3 Track A plan, "Rulings").

## Options

1. Move the item to the M3 P2 gate, where hide and its replay filter land, and exit M2 with it open and named.
2. Build `result_visibility` and the replay filter in M2 P3. That pulls a migration and critical work forward from M3 P2, with no M2 story that needs it.

## Decision

Option 1. The spec 12.7 M2 row's security tests are: no cross-user events; admin-only audit routes; bearer REST + WS. "Replay excludes hidden" moves to the M3 P2 gate. The test that closes it is a hidden case in `packages/api/test/ws/replay.test.ts` (spec 10.4): a result hidden by its owner is never replayed, to that owner or to anyone else. It is written with hide in M3 P2 and joins the M3 exit's "hide owner-only" check.

M2 exits with the item open and named: `docs/testing/m2-security-map.md` points its row here, and the M3 P2 gate cell in `docs/superpowers/plans/STATUS.md` names the test.

## Consequences

- Spec 12.7 carries `Overridden by ADR-0014 (M2 row, replay excludes hidden).` under its table.
- The M3 P2 gate in `STATUS.md` names the `replay.test.ts` hidden case (spec 10.4).
- `docs/testing/m2-security-map.md` links this ADR in place of "pending".
- No code, contract or migration changes in M2.
