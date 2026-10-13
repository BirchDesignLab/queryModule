---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "cbc5ccb216d6554b6e1584760cff7baed4462b4a"
verdict: "approve"
mode: "fast"
---

# Review: ci/workflow-harness

Date: 10-13-26

## Scope

Branch ci/workflow-harness, range b9f2868e9356c601ef2eb4abdc36f17fc580069c..cbc5ccb216d6554b6e1584760cff7baed4462b4a (one commit, #627). Adds the root script `sdd:harness` (node scripts/sdd/workflow-harness.mjs), appends it to `pnpm verify`, and runs it as one unconditional step in the existing `test` job of ci.yml. Removes a duplicate drift test from check-generated.test.ts. Gate files: .github/workflows/ci.yml, package.json, scripts/ci/check-generated.test.ts, scripts/ci/ci-workflow.test.ts (46 lines, fast path).

## Findings summary

Critical 0, Important 0, Minor 2. No rulings contested; the context rulings (Windows load flakes are not findings; pnpm verify EXIT 0 at cbc5ccb) stand. No controller rulings needed.

## Cross-cutting checks

1. scripts/sdd/workflow-harness.mjs: risk of dependencies absent in the test job. Node built-ins only, spawns only process.execPath, exits 1 on any failed scenario.
2. scripts/sdd/append-ledger.mjs: risk of a transitive non-built-in import. Built-ins only.
3. scripts/ci/changed-paths.mjs: risk a harness-relevant change is skipped as docs_only. A PR touching only .claude/workflows/README.md skips the test job; the push-to-main run executes everything and catches it (Minor M2).

## Answers to the controller's questions

1. Yes. The step at ci.yml:164-166 has no `if` and no continue-on-error, so a failing scenario fails `test`, and the `ci` aggregate (ci.yml:384, 398-403) fails on any result other than success or skipped. The `test` job `if` (ci.yml:140), the board job (ci.yml:355) and the ci needs list are unchanged; no new job. Pinned by ci-workflow.test.ts:537-551.
2. No. The harness imports only Node built-ins (workflow-harness.mjs:19-24, append-ledger.mjs:18-20) and reads repo files present in the checkout (ci.yml:144-147).

## Remaining Minors

- M1 scripts/ci/ci-workflow.test.ts:548-551: the "adds no job" test checks only for a job named `harness`; pin the full job list or the ci needs list instead.
- M2 scripts/ci/changed-paths.mjs:10-19: a README-only change under .claude/workflows/ is docs_only, so the harness README assertions (workflow-harness.mjs:2628-2634) run only on the push to main.
