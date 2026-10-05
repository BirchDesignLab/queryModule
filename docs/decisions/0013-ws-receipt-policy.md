---
date: 10-05-26
status: accepted
track: core
phase: m2-p0
supersedes: ["spec 4.7"]
---

# 0013 WebSocket receipt policy: tolerant clients, strict server

## Context

Spec 4.7 says "the API validates on write and on send; the client validates on receipt", and every WebSocket message schema in `packages/core/src/contracts/ws.ts` is a strict object inside a closed discriminated union. M2 and M3 add server messages (`resultHidden`, `resync`, `delegationChanged`) and may add fields. A client that parses receipt with the strict union rejects any message a newer server sends, so every additive change would need a `MIN_CLIENT_VERSION` bump (deploy config, spec 4.7, 7) and would strand open tabs and installed apps until they update. The spec does not say how a client treats a message it does not know (#66, #511 C-M4; FR-065, NFR-003).

## Options

1. Strict everywhere: the client parses with the server's strict union. Simple; every additive change is breaking for older clients and needs a `MIN_CLIENT_VERSION` bump.
2. Tolerant clients, strict server: the server stays strict on what it sends and receives; clients drop unknown message types and strip unknown keys. Additive changes are free; a breaking change still bumps `MIN_CLIENT_VERSION`. Cost: a client-side receipt parser and its tests.
3. Tolerant both ways: the server also accepts unknown client keys. Weakens input validation at a trust boundary (SEC-014) for no current need.

## Decision

Option 2, ruled by the developer 10-05-26 (D-M2P0-1 in the M2 P0 contracts plan).

- The server stays strict: it validates every message it sends against `WsServerMessageSchema` and every message it receives against `WsClientMessageSchema` (strict objects, closed unions).
- Clients parse receipt tolerantly:
  - a message whose `type` the client does not know is dropped (not an error, not a disconnect);
  - unknown keys on a known type are stripped;
  - a known type that fails its schema after stripping is dropped and counted (a client metric), never applied.
- An additive WebSocket change (a new server message type, a new optional field) needs no `MIN_CLIENT_VERSION` bump. A breaking change (a removed or retyped field, a changed meaning, a new required client message) still bumps it.
- Clients dedup events by the `seq` high-water mark (spec 4.7), so the server must publish each user's events in `seq` order (M2 P0.5 Track A Task 9 guarantees it).
- The same policy applies to `ApiError` bodies received by the client (#66).

## Consequences

- `ws.ts` keeps strict schemas; its doc comment points here. `resultHidden` and `resync` join the server union additively in the same PR.
- The client half is built in M2 P0.5 Track B Task 5 (feed socket parser); the heartbeat probe and `ApiError` receipt parser follow in #66 (M2 P1 Track B).
- Spec 4.7 carries `Overridden by ADR-0013.` under its heading (only the sentence "the client validates on receipt", which now means tolerant receipt).
- Master plan 8 contract changes for WebSocket messages state additive or breaking against this rule.
