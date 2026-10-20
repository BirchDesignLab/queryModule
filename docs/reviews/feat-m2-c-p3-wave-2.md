---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "b841ba0d49ef24aa9c2a11c8c9b4a260c5442d77"
verdict: "approve"
---

# Review: feat/m2-c-p3-wave-2 (gate slice)

Date: 10-20-26.

## Scope

Branch feat/m2-c-p3-wave-2, range 827955f2ca7462545c9045bedc99f4223562e5fd..b841ba0d49ef24aa9c2a11c8c9b4a260c5442d77. Wave CW2 (M2 P3 lane C, plan Tasks 12 to 15): ack-stats logic moves to packages/api/src/ops/ack-stats.ts behind a thin scripts/ops wrapper (#771); add-demo-users keeps the grant-failure cause by class and code, fixes the recovery pointer and hashes only new accounts (#782); phaseBodyUpdate cuts only at a Plan-labeled trailer line and keeps text typed on it (#770); CORS_ORIGINS entries fail closed at boot (CW1 m1, ordinary).

Gate files reviewed: packages/api/src/ops/ack-stats.ts, packages/api/src/ops/add-demo-users.ts, scripts/ops/ack-stats.ts, scripts/ops/ack-stats.test.ts (moved to packages/api/test/ops/), scripts/ops/board-model.mjs, scripts/ops/board-model.test.ts.

## Findings summary

Critical 0, important 0, minor 4. Task 14 ledger rulings (G-m-1 anchor to the plan label; old-format fallback replaced whole) kept as they stand. No controller rulings needed.

## Cross-cutting checks

1. scripts/ops/gh-setup-project.mjs (phaseBodyUpdate caller): the generated trailer always starts "Plan: " or "Plans: " (phasePlanLine), so the new anchor never misses it. Cleared.
2. scripts/ops/add-demo-users.ts and docs/demo.md: the wrapper prints only e.message, so the attached cause never reaches output; the anchor #add-missing-demo-accounts exists. Cleared.
3. packages/api/build.mjs: every scripts/ops/*.ts is a bundle entry; the wrapper bundled to scratch with the same esbuild options gives the same JSON and exit codes 0, 1 and 2. Cleared.

## Answers to the controller's questions

1. Same output and exit codes (0 printed, 1 unreadable, 2 usage); bundled wrapper runs (verified by building and running it).
2. Existing accounts are skipped before derive and hash (spy test); the message carries the cause class and code only, never the cause message or a password; the in-transaction re-check stays.
3. Hand-added text is kept byte for byte on every documented path; the loss paths (no head, no Plan-labeled trailer line, generated tail changed) are all stated in the JSDoc. A prefix-shortened tail misses an update without losing text (minor m2).
4. CORS_ORIGINS check throws DeployEnvError at boot naming the key, never the value; empty means PUBLIC_ORIGIN only.

## Remaining Minors

- m1 add-demo-users.ts:36 JSDoc still names scripts/ops/grant-role.ts; the message says node scripts/ops/grant-role.js.
- m2 board-model.mjs:229 startsWith(want) plans no update when a new trailer tail is a strict prefix of the old one; not in JSDoc (ledger Q2).
- m3 board-model.test.ts: no test for the tail-changed branch that drops typed text (ledger Q1).
- m4 env.ts:46 ORIGIN_RE accepts a query, fragment or space after the host; such an entry refuses silently rather than failing at boot (fail closed).
