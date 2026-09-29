---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "6a7d86994f5b94788883aa8c233cd678d646edf4"
verdict: "approve"
---

# Review: feat/a-p2-wave-6 (gate slice)

Date: 09-28-26

## Scope

Branch feat/a-p2-wave-6, range 26ae2b5b3f9514d5475317a6831de219bf815bef..6a7d86994f5b94788883aa8c233cd678d646edf4, gate tier only. The wave delivers: #225 WebSocket upgrade limit per IP (60 per minute, 429 with Retry-After) with the Origin check before identity.resolve; #237 hardened CI step 12 no-echo guard, smoke, restore-test (readonly per-file secret binds, leftover volume removed) and deploy-pull (per-step failure lines); #171 rename-aware oasdiff diffing the merge base from the PR head sha; #288 sign-out keeps the cookie and writes no logout row while the session row survives; #295 terminal/** 95% coverage threshold and coverage excludes for __fixtures__ and shell scripts. Task 25 (#220) was reverted to main and is not in this PR.

## Findings summary

- Critical: 0. Important: 0. Minor: 2.
- Prior gate review findings G-M1 (4xx passthrough without Set-Cookie), G-M2 (row gone with non-2xx answer test) and G-M3 (deploy-pull step names) are in place; the gate files are unchanged since that review.
- Rulings kept as stands: Task 23 host behaviour of restore-test and deploy-pull, step 12 QM_BASE_URL propagation, localhost reachability on runners, missing bind source on host; Task 24 real-run oasdiff behaviour, isMainModule under tsx, oasdiff acceptance of the renamed file. Checker rulings on #225 (401 to 403) and the root typecheck fix stand.
- No controller rulings requested in this run.

## Cross-cutting checks

1. strip-comments revert complete: no diff against the base on strip-comments.ts, its test or biome.json.
2. .github/sensitive-paths covers every changed gate file (scripts/ci/**, scripts/ops/**, **/vitest.config.ts, packages/api/src/auth/**, packages/api/src/ws/**).
3. The #225 limiter path has a test: packages/api/test/security/ws-auth.test.ts expects 429 with Retry-After on the 61st upgrade.

## Answers to the controller's questions

None asked.

## Remaining Minors

- packages/api/src/ws/server.ts:39-44: toRequest comment still describes the Origin check as downstream of resolve; it now runs first.
- scripts/ci/openapi-base.ts:1-10: header documents only `<base-ref> <out>`; the optional head-ref and head-out arguments the CI step uses are not described.
