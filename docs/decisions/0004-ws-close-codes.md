---
date: 09-26-26
status: accepted
track: core
phase: m0-p0
supersedes: ["spec 4.7"]
---

# 0004 WebSocket close codes

## Context

Spec 4.7 (WebSocket messages) says the server closes the socket "with code 4001 when its session ends (logout, expiry, revocation) and 4003 on a rejected Origin". Spec 5.3 and 10.3 reject a bad Origin at the upgrade, so no socket exists and a 4003 close for Origin can never be sent. Spec 4.7, 5.2 (sweeper, step c) and 5.3 all close session expiry and revocation with 4001. `WS_CLOSE_CODES` freezes at the M0 P0 gate with the rest of the WebSocket contract (SEC-014, FR-043, FR-065), after which it is additive-only.

Two plans then diverged. Lead ruling R3 in the P0 contracts plan (Task 5) set `WS_CLOSE_CODES = { sessionEnded: 4001, sessionRevoked: 4003 }`, giving revocation and expiry a code that contradicts spec 4.7, 5.2 and 5.3, with no ADR. The Track A P1 plan (`docs/superpowers/plans/2026-09-25-track-a-p1.md`, line 48) listed a third variant, `{ sessionEnded: 4001, originRejected: 4003 }`, while its code uses only `sessionEnded`.

## Options

1. Keep 4003 for a rejected Origin: follows the 4.7 sentence; the code is unreachable, because Origin is rejected before the upgrade completes (5.3, 10.3).
2. R3's `sessionRevoked: 4003` for revocation and expiry: lets a client tell revocation from logout; contradicts 4.7, 5.2 and 5.3, and no screen needs the distinction yet.
3. One code, `sessionEnded: 4001`, for every session end; 4003 stays unassigned: matches 4.7, 5.2 and 5.3; cost is none.

## Decision

Option 3. `WS_CLOSE_CODES = { sessionEnded: 4001 } as const` in `packages/core/src/contracts/ws.ts`. 4001 closes the socket on every session end: logout, session expiry, session revocation and user disable (spec 4.7, 5.2, 5.3). Origin and session checks reject the upgrade with HTTP before any socket exists: 401 without a live session; 403 for a foreign Origin, or a missing Origin without `Authorization: Bearer` (spec 5.3, 10.3). They are never close codes. There is no `sessionRevoked` and no `originRejected`, and 4003 stays unassigned.

## Consequences

- The client treats a 4001 close as "session over, re-authenticate".
- If a later UI needs to tell expiry from revocation, a new code is added additively through the master plan 8 procedure.
- The P0 contracts plan Task 5 text and the Track A P1 plan line 48 are corrected in the same commit.
- Spec 4.7 carries `Overridden by ADR-0004.` under its heading.
