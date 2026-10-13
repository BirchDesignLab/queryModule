---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "61a173d8fabb57ee92b8ad527fd5d97e5d61e9a9"
verdict: "approve"
mode: "fast"
---

# Review: fix/ci-board-fetch-depth

Date: 10-13-26

## Scope

Branch fix/ci-board-fetch-depth, range 6247b4df8abadd89c5d65cac091d639c58a59ca6..61a173d8fabb57ee92b8ad527fd5d97e5d61e9a9 (one commit, 9 lines, gate tier). The `board` job (#617) checkout now fetches full history so the R4 equivalence case in scripts/ops/board-data.test.ts can `git show` the move commit; a new ci-workflow.test.ts case pins `fetch-depth: 0` and `persist-credentials: false` on that checkout.

## Findings summary

Critical 0, important 0, minor 0. No ruling ids contested; ruling in force (Windows load flakes are not findings) kept as stands. No controller rulings needed.

## Cross-cutting checks

1. scripts/ops/board-data.test.ts:199-216, risk that full history still misses the needed commit: R4 reads the fixed main commit 8a438d2, reachable with fetch-depth 0 on both the PR merge ref and push; a missing commit fails, never skips.

## Answers to the controller's questions

1. Yes. .github/workflows/ci.yml:355-359: board checkout sets `fetch-depth: 0` and keeps `persist-credentials: false`. The ci.yml diff is only those two added lines (357-358). Job id and name `board` (348-349), `needs: changes` (350), `if` (351), the required `ci` aggregate name and needs (379-381), workflow permissions (16-17) and every other job are unchanged.

## Remaining Minors

None.
