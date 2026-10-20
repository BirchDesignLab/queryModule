---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "f5c0cc0d19e31e6643452a931a9e777b797d94da"
verdict: "approve"
---

# Review: feat/m2-a-p3-wave-1 (critical slice)

Date: 10-20-26.

## Scope

Branch feat/m2-a-p3-wave-1, range 2ad7c52afff1902a94b2e1cb3490145755052346..f5c0cc0d19e31e6643452a931a9e777b797d94da, M2 P3 Track A wave AW1 (#786 to #791). Critical files: packages/api/src/admin/config/draft.ts, packages/api/src/admin/config/publish.ts, packages/api/src/audit/routes.ts, packages/api/src/dispatch/sweeper.ts, packages/api/src/queries/prepare.ts, packages/api/src/queries/route.ts, packages/api/src/startup.ts, packages/core/src/terminal/tokenize.test.ts.

The wave delivers: the sweeper honors stop() before each session and selects up to 4 batches of 500 per tick, skipping ids that failed earlier in the tick (Task 1); the fatal close takes the drain's order (Task 2); the admin query read mounts in queries/route.ts beside the owner's read with one shared queryStringErrors helper (Task 3); publish and rollback answers carry publishedByName (Task 4); a Server-Timing test on the idempotency loser (Task 5); a comment rewrap in the tokenize tests (Task 6).

## Findings summary

- Critical: 0. Important: 0. Minor: 2.
- No critical or important finding needed resolution.
- Rulings kept as they stand: the TryMatchPane.test.tsx selector exception (Manager 10, 10-19-26); Task 1 review Q1 fixed inline at e53e4cd; the deferred task-review minors (Task 3 Q1, Q2, Q3; Task 4 name read before activate()) stay minor.
- Controller rulings asked of this review: C1 is Minor (follow-up issue); C2 is Minor (follow-up issue).

## Cross-cutting checks

1. Moved admin read gains or loses middleware: app.ts (unchanged) registers every global middleware, including the /api/v1/* body cap and requireRequestedWith, before the first mount; no intervening mount function registers app.use. Chain unchanged.
2. publishedByName names a different user than publishedBy: activate.ts:76 writes publishedBy from event.actor.id, the same id publish.ts:196 looks up. Match.
3. Splitting the shared adminGuard instance changes behavior: admin/access.ts:19-34 is a stateless closure. No change.

## Answers to the controller's questions

1. C1 is Minor. fire() discards the tick's counts (sweeper.ts:151-158); committed sessions keep their sessionRevoked rows; the skipped prune runs next tick because lastPruneAt is unchanged (:128-131); batch 2 needs a full first batch (:122). The fire() comment at :153 is stale for this case and rides the follow-up.
2. C2 is Minor. startup.ts calls start() once (:101) and never after a stop (:96, drain :23, close :117).
3. Reading publishedByName before activate() is acceptable: response-only field, no audit or access effect; a read failure throws before activate(), so nothing publishes and rollbackTo removes its draft (publish.ts:288-290).
4. Task 3 confirmed: same middleware chain (body cap, requireRequestedWith, adminGuard(d, "adminAudit", ["admin"])), same URL, bodies, statuses and audit order (admin-read.ts unchanged); app.ts unchanged.

## Remaining Minors

- M1 (C1): sweeper.ts:74-80, :151-154. A select failure on batch 2 to 4 rejects the tick after earlier commits, losing counts and that tick's prune; the fire() comment says nothing changed. Follow-up: catch a later batch's select failure, log, break and return counts; fix the comment.
- M2 (C2): sweeper.ts:162-166. start() during a pending stop() clears the halt flag. Follow-up: refuse start() while a stop is pending, or document the sweeper as not restartable.
