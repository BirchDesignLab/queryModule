---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "bbde8941e7a367ba595b97aed13e71cbbe084e36"
verdict: "approve"
---

# Review: feat/m2-a-p1-wave-3

Date: 10-13-26.

## Scope

Branch feat/m2-a-p1-wave-3, range 794a8cd14c4f4a16b0de450528e904b16f82a64e..bbde8941e7a367ba595b97aed13e71cbbe084e36 (base origin/main after #618, scope frozen at bbde894). The wave (M2 P1 Track A, wave 3) delivers: replay of missed WebSocket events by lastSeq with the 500-event and 24 h caps and resync (Task 5, #590); the socket-close-mid-dispatch replay gate test and ws-events replay rows (Task 6, #591); smoke step 4 reading the query detail over HTTP (Task 7, #592); oasdiff on every PR with api-breaking reporting (#614); the board-only CI fast path (#617, with the C1 fix in bbde894); the wave critic K-1 fix (a ping before hello no longer extends the idle window); AW2 review minors C-m1 to C-m3; STATUS updates.

Slices, one run: gate slice (Opus 5.5 medium: .github/workflows/ci.yml, packages/api/src/ws/server.ts, scripts/ci/changed-paths.mjs and its tests, scripts/ci/ci-workflow.test.ts, scripts/ops/smoke-feed.ts, scripts/ops/smoke.test.ts) then critical slice (Opus 5.5 high: packages/api/src/dispatch/event-log.ts).

## Findings summary

- Gate slice: approve, 0 open critical, 0 open important.
- Critical slice: approve. Critical 0, important 0, minor 2.
- No critical or important finding to resolve.
- Rulings kept as stands: Task 5 lastSeq null floor = welcome.latestSeq (spec 4.7, ws.ts:19); Windows load flakes are not findings (verify at bbde894 EXIT 0, 4586 passed); contracts frozen in AW3, openapi.json unchanged; gate test path test/dispatch/replay-mid-dispatch.test.ts accepted in place of the spec 10.4 path.
- Controller ruling: #617 C1 and Q1 fixed in bbde894 (manager ruling: board_only is true only when every changed file is exactly docs/board/board-data.json).

## Cross-cutting checks (critical slice)

1. Event_log writers that replay could not rebuild: only dispatch/outcome.ts and dispatch/sweep.ts write, both through the typed appendEvent (type sourceStatus, non-null fields). Safe today.
2. Snapshot consistency of latestSeq and rows: db/tx.ts withTransaction is one IMMEDIATE transaction on the single connection; both reads use it. Consistent.
3. Unvalidated caller input: ws/server.ts parses hello with the strict WsClientMessageSchema (lastSeq integer, min 0, or null) and passes the session user id. A negative cursor or a client-named user cannot reach eventsSince.

## Answers to the controller's questions

None asked.

## Remaining Minors

- m1 packages/api/src/dispatch/event-log.ts:112, :118: no test pins a row at exactly now - EVENT_LOG_RETENTION_MS for replay (the prune edge is pinned, the replay edge is not). Add one boundary case.
- m2 packages/api/src/dispatch/event-log.ts:124-136 (with wave critic K-3): a stored row failing WsEventSchema throws without its seq and closes the socket 1011 on every reconnect; unreachable with today's writers. When resultHidden rows land (M3), map rows per type and on a parse failure log seq and type and return resync instead of throwing.
