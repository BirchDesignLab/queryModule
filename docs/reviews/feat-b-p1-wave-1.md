---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "2da6ea3b649df49ef98e14c338f6645b526e2ebd"
verdict: "approve"
mode: "fast"
---

# Review: feat/b-p1-wave-1

Date: 09-27-26

## Scope
Branch feat/b-p1-wave-1, range b2fe4ed1e9de3f687f8fa4777640cb51b1dcef9d..2da6ea3. Track B P1 wave 1: client and web-ui scaffold with test tooling and dependencies (Task 1), core rules value types, two-digit years and date formats (Task 3), per-dataType canonicalisation with idempotency property (Task 4), query type compile and structured condition evaluation (Task 5), and an explicit 30 s timeout on one sensitive-review test. Gate files: packages/client/tsconfig.json, packages/client/vitest.config.ts, packages/web-ui/tsconfig.json, packages/web-ui/vitest.config.ts, pnpm-workspace.yaml, scripts/ci/sensitive-review.test.ts. Fast path, 31 reviewed lines.

## Findings summary
Critical 0, important 0, minor 2.
Rulings kept as they stand: T1/S1 (msw: false in allowBuilds), T1-complete (Task 1 complete at cf7813a), T-timeout (30_000 ms on one test), critic:G2 (fixed), critic:G3 (stands, follow-up issue), Task 3 spec:S1, Task 4 IC1.

## Cross-cutting checks
1. pnpm honours allowBuilds: packageManager pnpm@12.6.0; base already used allowBuilds for esbuild. OK.
2. msw.workerDirectory set anywhere: not in root, packages/*, apps/* package.json. OK.
3. Gate files covered by .github/sensitive-paths: scripts/ci/**, **/vitest.config.ts, pnpm-workspace.yaml, **/tsconfig.json all listed. OK.

## Answers to the controller's questions
1. T1/S1 is sound and fail-closed: an explicit deny runs no script, the skipped postinstall is inert with no workerDirectory, and enabling it later needs a gate-tier edit.
2. Counting Task 1 complete at cf7813a is acceptable: round 3 re-review addressed every open finding, verify 728/728 and audit clean at cf7813a, and the stop was a harness progress-check defect (PR #174).
3. The timeout does not weaken the check beyond timing: only the third argument to it() changed; all cases and assertions are unchanged and a hang still fails.

## Remaining Minors
- packages/web-ui/tsconfig.json:9 types ["node"] exposes Node globals to browser UI src; fold into the G3 follow-up.
- packages/client/src/tsx-collection.test.tsx is a tautological sentinel; it cannot fail if the include glob regresses.
