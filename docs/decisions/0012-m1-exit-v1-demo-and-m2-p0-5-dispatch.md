---
date: 09-29-26
status: accepted
track: all
phase: m1-p3
supersedes: ["spec 12.2 M1 P3 row (Track A cell)", "spec 12.7 M1 row", "master plan 4.1 P3 row (gate and Track A cell)"]
---

# 0012 M1 exits on the v1 front-end demo; dispatch moves to M2 P0.5

## Context

Spec 12.2 puts the mock adapter, `event_log`, WS `sourceStatus` and dispatch deadlines in M1 P3 (Track A), and spec 12.7 makes M1's exit A1 to A5 green, keyboard-only A1 and A4, the route x caller matrix, axe in every scenario and a live smoke that includes submit and settle (spec 8.7 steps 3 and 4). On 09-29-26 the developer set a different target for M1 P3: a demoable front-end v1 for a company, for three personas (dispatcher, officer, admin), whose core loop is an implementer's visual config builder, publish, and a dispatcher form that reacts (ADR-0011). Query responses from a backend are not required now; submit ends at the 202 acknowledgment (P2, FR-064). Rulings D-A30 (a), D-A33 (a), D-B16 (a) in the P3 plans (developer via checker, 09-29-26).

## Options

1. Redefine M1's exit as the v1 demo and move the dispatch work to a new phase before M2 P1.
2. Keep M1's exit as written and promote `m1` only after the backend lands.
3. Promote an interim tag (for example `m1-ui`) now and `m1` after the backend.

## Decision

Option 1.

**M1 exit (replaces the spec 12.7 M1 row and the master plan 4.1 P3 gate):**

- Core loop e2e: an admin publishes builder changes (a field, a rule that makes a field required, a default, picklist values, a subtype value, a terminal command, a quick-access button), each seen first in the builder preview and then in an open dispatcher form without a reload; a stale submit gets 409 and refetches; rollback restores the previous form (Track A P3 Task 35).
- Persona screens for dispatcher (`dispatch`), officer (`mobileUnit`, a spec 6.3 subset verified at 1024x768) and admin (the `/admin` console), with a persona e2e (Track B P3 Task 21).
- Stories A1 to A5 green and tagged; A4 "runs" is asserted to the 202 acknowledgment (its "clean no-record" result moves to M2 P0.5); keyboard-only A1 and A4; axe in every scenario.
- Security: the route x caller matrix for config, queries, meta and the admin routes; unknown keys rejected; hidden values accepted and pruned, neither persisted nor dispatched (spec 10.3; wording corrected 10-04-26 by the M1 phase review, SUBMIT-3); `configHash` 409; log capture for config publish and user creation.
- Smoke steps 1, 2, 3 (submit, 202) and 5 against the live URL; restore test; `docs/releases/m1.md`; product docs; promote `m1`.

**New phase M2 P0.5 dispatch** (between M2 P0 contracts and M2 P1 feed), Track A with a Track B cell:

- Track A: the parked M1 P3 Track A waves: fixture policy and mock generator, `event_log`, Adapter API v1 and the mock adapter, dispatcher with deadlines and caps, T2 with `sourceResponded` and `sourceStatus`, startup sweep, `welcome.latestSeq`, SIGTERM drain, smoke steps 3 and 4 (settle), dispatch security rows (task texts kept in `2026-09-29-track-a-p3.md`).
- Track B: the parked wave B6 (feed socket, live per-source status; `2026-09-29-track-b-p3.md`).
- Gate: A4's "clean no-record" at the API layer and in the UI status list, smoke 1 to 5, the dispatch and lifecycle tests, `source-status.spec.ts`.
- Plan files: `<date>-m2-track-a-p0-5.md`, `<date>-m2-track-b-p0-5.md`, written from the parked task texts at the phase's start.

M2 P1 (feed) needs M2 P0.5 done; M2 P0 (contracts) may run before or beside it.

## Consequences

- Spec 12.2 (M1 P3 row, Track A cell) and 12.7 (M1 row) carry `Overridden by ADR-0012.`; the master plan 4.1 P3 row is read through this ADR (the master plan changes only for process, 1.4).
- `STATUS.md` gains the M2 P0.5 dispatch row in this ADR's PR (master plan 4.5: the ADR that schedules work adds its row).
- The backend-leads rule (master plan 3.4) is inverted for this stretch: Track A builds front-end admin code in M1 P3 (ADR-0011, D-A28). The lead is restored in M2 P0.5.
- Submits made before M2 P0.5 keep `pending` source rows until the startup sweep lands; `docs/releases/m1.md` says so. The ack text never claims results.
- Stories keep their milestones in `docs/testing/stories.json`; only A4's result half moves, recorded in the M2 P0.5 plan.
