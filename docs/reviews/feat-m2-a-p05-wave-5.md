---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "33e5a971bc225035e13b0189b81c59226170659c"
verdict: "approve"
---

# Review: feat/m2-a-p05-wave-5

Date: 10-06-26. Mixed review (manager ruling (A) 10-06-26): gate slice first, critical slice last.

## Scope

Branch feat/m2-a-p05-wave-5, range 2dbc5ca822e25b228a3343c27b1baff134f1c137..33e5a971bc225035e13b0189b81c59226170659c. The wave delivers: smoke step 4 (Task 14 #541: feed waits for every dispatched source to settle, bounded, secrets off argv and output) and #503 (smoke request key tied to core IDENTITY_SOURCES); T14 review minors Q3 to Q6; Task 15 #542 tests (mock gate, adapter log capture, dispatch audit rows, startup mock refusals); Task 16 #543 SEC-005 password minimum as a single source (packages/core/src/config/password.ts) read by Better Auth and the change-password page; the review fix commit 33e5a97 (G-I1 password.ts listed at gate, G-M1, G-M2). Critical slice: .github/sensitive-paths.

## Findings summary

- Gate slice: approve, 0 critical, 0 important open. G-I1 (important) resolved in 33e5a97 by listing packages/core/src/config/password.ts under [gate] and in the CLAUDE.md gate list, with a tier test and an unmocked >= 12 test. G-M1 and G-M2 fixed in the same commit.
- Critical slice: approve, 0 critical, 0 important, 1 minor (C-m1, RR-M1).
- Rulings kept as they stand: AW4 drain 503 and route-matrix ruling; AW4 review minors on #574; accepted T15 deferral (mock-gate startup refusals in startup.test.ts); #560 Windows load flakes are not regressions.
- Controller ruling: manager ruling (A) 10-06-26, keep 33e5a97 and run the mixed review; developer approved the CLAUDE.md gate-list line.

## Cross-cutting checks

1. New [gate] line parses and is not lowered: scripts/ci/sensitive-review.test.ts run at head, 75 passed; shipped tier file classifies password.ts as gate; no [deps] or [exempt] glob matches it; nothing else in the file moved.
2. RR-M1 shadowing: auth.ts and ChangePasswordPage.tsx import through "@querymodule/core/config", mapped by packages/core/package.json to the ordinary src/config/index.ts. A local export there, or an exports remap, could shadow the gated constant. Minor, deferred to #574.
3. CLAUDE.md and .github/sensitive-paths agree on password.ts at gate.

## Answers to the controller's questions

1. RR-M1: real but minor. Not a one-liner to close fully (both index.ts and packages/core/package.json are ordinary vectors). Deferred to #574 with the fix: a gate-tier test under packages/api/src/auth/ that reaches the minimum by the same import specifier auth.ts uses, or refuses an 11-character password unmocked.

## Remaining Minors

- C-m1 (RR-M1), packages/core/src/config/index.ts:11: ordinary re-export path to the gated SEC-005 minimum; to #574.
