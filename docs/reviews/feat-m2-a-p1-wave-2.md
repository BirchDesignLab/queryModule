---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "375a0fea8c3a51e8944f025ed47ca405b348a698"
verdict: "approve"
---

# Review: feat/m2-a-p1-wave-2

Date: 10-13-26. Critical slice (the only slice this run; no gate file in scope).

## Scope

Branch feat/m2-a-p1-wave-2, range 21338f84a4b6256476e73e9eeeb2e837610f3316..375a0fea8c3a51e8944f025ed47ca405b348a698. The wave delivers M2 P1 Track A AW2: GET /api/v1/queries/:correlationId, the owner's read through the access policy with per-scope DEK unwrap and purged handling (#561, spec 5.1, 5.2, 5.5), and GET /api/v1/queries, the caller's requests newest first with keyset cursor paging (#589, #561, spec 5.1, 6.7); plus AW1 review C-M1, the mock matcher property now generating behaviour scenarios. Critical files: packages/api/src/queries/read.ts, packages/api/src/queries/route.ts, packages/core/src/mock/match.test.ts.

## Findings summary

Critical 0, important 0, minor 3. No critical or important finding to resolve. Rulings kept as they stand: Windows load flakes are not findings; contracts frozen in AW2 (routes.ts "planned" status and the contract's 400 for a malformed id are known and deferred, spec 5.2 404-not-403 governs); AW1 #611 oasdiff ERRs expected; admin read routes and NDJSON stay in M2 P2. No controller rulings were requested.

## Cross-cutting checks

1. packages/api/src/queries/policy.ts, risk of existence leaks through the detail route: malformed ids are denied before any DB read, the "own" route grants only the owner, an admin has no path there. No leak.
2. packages/api/src/keys/request-keys.ts, risk of AAD or zeroing mismatch with read.ts: AADs match the sealing helpers, a wrong-length DEK is zeroed before the throw, plaintext is zeroed. Consistent.
3. packages/core/src/contracts/queries.ts (with BoundedIdSchema and the dispatcher's errorCode values), risk of the strict read schemas rejecting failed or timed-out rows: status enum, errorCode and timedOutAt shapes all accept what the dispatcher stores; cursor and page bounds agree. No mismatch.

## Answers to the controller's questions

None asked.

## Remaining Minors

- m1: no detail read test for a failed (FAIL1) or timedOut (TIMEOUT) source (read-one.test.ts; read.ts:96-112).
- m2: purge test shreds both request_key scopes at once; payload-only and values-only shreds untested (read-one.test.ts:161-179; read.ts:107, 127).
- m3: default limit 25 and inclusive limit=100 untested at the route (read.ts:157).
