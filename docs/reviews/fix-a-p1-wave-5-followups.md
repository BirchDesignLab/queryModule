---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "e58fd93787355917849dda0023bf6760405dc436"
verdict: "approve"
---

# Review: fix/a-p1-wave-5-followups

Date: 09-28-26. Gate tier only, no critical slice.

## Scope

Branch fix/a-p1-wave-5-followups. Range dcf5203029e06717452088365771e5d5f669f9a0..e58fd93787355917849dda0023bf6760405dc436. Wave 5 follow-ups #230 and #231:

- The `image` job waits for `checks`, so it installs only after the lockfile guard (G-M1).
- A test guards that every push to main builds the image (#230).
- promote.yml restores no pnpm cache (G-M2).
- boot-smoke `down` fails if a seeded demo password appears in the service log, and fails closed on grep errors (G-M3, spec 8.5).
- gh-setup-project.mjs skips the parent link for a follow-up with no parent (board cap).

Gate files reviewed: .github/workflows/ci.yml, .github/workflows/promote.yml, scripts/ci/boot-smoke.sh, scripts/ci/ci-workflow.test.ts, scripts/ci/promote-workflow.test.ts, scripts/ops/gh-setup-project.mjs, scripts/ops/gh-setup-project.test.ts (69 changed lines).

## Findings summary

Critical 0, important 0, minor 3. Each ruling stands as ruled: the #230 premise correction (no workflow change, pinned by test), G-M1, G-M2, G-M3, and the board-cap carry.

## Cross-cutting checks

- scripts/ops/seed.ts: the boot-smoke parse could miss the password field. The output is a header line, then `email\trole\tpassword`, so the parse is correct, and `checked -gt 0` blocks a vacuous pass.
- scripts/ops/board-data-schema.mjs: the skip could hide a bad or null parent. The schema rejects null and unknown parents, so only an absent parent is skipped.
- package.json: setup-node could auto-cache and undo G-M2. `packageManager` is pnpm, and automatic caching covers npm only, so nothing is restored today (see Minor 1).

## Answers to the controller's questions

1. Worktree C:/git/queryModule-a, issues #230 and #231: reviewed at e58fd937. Precondition holds.
2. #230: changed-paths.mjs:99-101 prints `docs_only=false` for any push. `image` and `checks` are gated only on docs_only (ci.yml:240, 53), so every main push builds, smoke-tests and uploads the image that publish loads. ci-workflow.test.ts:164-176 fails if either gate or the push behaviour changes. The one exception is a run cancelled by a newer main push, which spec 9.3 mandates.
3. G-M1: on a main push, image is skipped only when changes or checks fails or is cancelled. ci then fails, and publish does not run. On a PR, image waits for checks to succeed, and the lockfile guard is checks' first step after checkout.

## Remaining Minors

1. promote.yml:62-65: set `package-manager-cache: false` on setup-node and assert it in the test, so the no-cache rule does not depend on setup-node's default.
2. ci-workflow.test.ts:164: the title overclaims "every main sha"; a cancelled main run (spec 9.3) gets no image.
3. gh-setup-project.test.ts:198-214: the test checks only the source's shape. This matches the file's existing pattern.
