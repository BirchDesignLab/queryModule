---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "18af9b50b483bad7365adea997db1c5391a561a3"
verdict: "approve"
---

# Review: feat/m2-a-p2-wave-3 (10-18-26)

## Scope

Branch feat/m2-a-p2-wave-3, range b2a14792ebc7f8f9820686e48505ffb1794390d3..18af9b50b483bad7365adea997db1c5391a561a3. Wave AW3 of M2 P2 Track A: the in-process sweeper that expires sessions past the live idle or absolute limit with a `sessionRevoked { reason: "expired" }` row and prunes `event_log` hourly (Task 7, #715, spec 5.2); Better Auth's fixed session ceiling and live `expiresAt` in the admin users list (Task 8, #716, AUD-1); the sweeper started after the WebSocket attaches and stopped in the drain, the fatal close and the listen-failure path (Task 9, #717, spec 5.2, 8.1); and the plain-digit check for `limit=` on the admin audit page (#755). Reviewed in two slices: gate (Opus 5.5 medium), then critical (Opus 5.5 high; files `packages/api/src/dispatch/sweeper.ts`, `packages/api/src/startup.ts`, `packages/api/src/audit/routes.ts`).

## Findings summary

- Gate slice: approve, 0 critical, 0 important.
- Critical slice: approve, 0 critical, 0 important, 4 minor.
- No critical or important finding needed resolution.
- Rulings kept as they stand: D-M2P2-2, D-M2P2-3, the #716 ruling (M2 Manager 8, 10-18-26), the #755 ruling (M2 Manager 8).
- No controller rulings were needed.

## Cross-cutting checks

1. `packages/api/src/auth/identity.ts`. Risk: the sweeper's due test differs from identity's live test. Identity's live test is `now - createdAt < absolute && now - updatedAt < idle` on the same columns; the sweeper's `<=` condition is its exact complement. No gap.
2. `packages/api/src/db/client.ts` and `db/tx.ts`. Risk: an in-flight tick holds the SIGTERM drain unbounded. Each transaction is bounded by the 5000 ms lock timeout and busy_timeout; a full tick is not. Recorded as minor m1.
3. `packages/api/src/main.ts`. Risk: the fatal path does not reach the sweeper stop. The fatal handler calls `close()` under a 10 s exit timer; SIGTERM calls `stop()` with no outer timer. The fatal path is covered; the drain bound is noted in m1.

## Answers to the controller's questions

1. Sweep starvation (T7 C1): acceptable at prototype scale and kept as a deferred minor. Identity refuses every due session, so sweep lag never grants access (spec 5.2), and no session is deleted without its audit row (SEC-010); only the row and the 4001 close are delayed.
2. Drain waits a full tick (T9 Q1): it can exceed the spec 8.3 bound only with many due sessions and a slow or lock-contended DB. An overrun ends in SIGKILL with no data or audit loss, because each expiry transaction is atomic. Not required in this PR; a stop flag checked between sessions is a small follow-up.

## Remaining Minors

- m1 `packages/api/src/startup.ts:252`, `packages/api/src/dispatch/sweeper.ts:168`: `stop()` does not short-circuit the per-session loop; add a stopping flag checked between sessions and before the prune.
- m2 `packages/api/src/dispatch/sweeper.ts:160`: the oldest-first batch can starve newer due sessions behind 500 persistently failing ones (deferred T7 C1).
- m3 `packages/api/src/startup.ts:316`: the fatal close awaits the sweeper tick before `server.close()`; await it after the server closes and before `closeDb`.
- m4 `packages/api/src/audit/routes.ts:121`: the route docstring names only from= and to= for the plain-digit check; add limit=.
