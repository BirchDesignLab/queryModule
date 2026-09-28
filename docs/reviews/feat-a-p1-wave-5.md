---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "599bac9fef03deda6e890d66cd5cdbc77208869a"
verdict: "approve"
---

# Review: feat/a-p1-wave-5 (09-28-26)

## Scope

Branch feat/a-p1-wave-5, worktree C:/git/queryModule-a, range 4460145ae2176752a97f181ef1cdeef8bf624cd2..599bac9fef03deda6e890d66cd5cdbc77208869a. Re-review after the d5a42c9 approval: gate slice at Opus 5.5 medium, fast path (approved, 0 open critical or important), critical slice at Opus 5.5 high on packages/api/src/main.ts only.

The wave delivers plan tasks 24 (#127), 25 (#128), 27 (#130), 29 (#132), 30 (#133) and #67, #208, #224: the seed and role CLIs, ops CLIs compiled into the image, the image, boot smoke, Playwright step 12 and publish jobs in ci.yml, the web zod jitless CSP fix, the sensitive-review main-merge tests, and main.ts failing closed on uncaughtException and unhandledRejection. The only change since d5a42c9 is 599bac9 (#130, #229): chmod 777 on the throwaway CI backup-out dir in scripts/ci/boot-smoke.sh so the uid 10001 container can write to the runner-owned bind mount on Linux.

## Findings summary

- Critical slice: 0 critical, 0 important, 2 minor (carried, unchanged).
- Gate slice: approved with 0 open critical or important.
- Rulings kept as stands (w5-review-context.md): the #224 ruling (event and error class name only, no message or stack, 10 s drain, exit 1, second event exits at once) is met by main.ts; T29 layout ruling holds; checker ruling on #229 (no --user, the container stays uid 10001) is met by 599bac9.

## Cross-cutting checks

1. Cleanup on Linux after the container writes into backup-out: packages/api/src/ops/backup.ts writes flat files only (backup.ts:47, 59, 73), no subdirectories. The parent is runner-owned mode 777 without the sticky bit, so `rm -rf "$backup_out"` (boot-smoke.sh:160) and `rm -rf "$work"` (boot-smoke.sh:166) remove the uid 10001 files. No risk.
2. A structure test pinning boot-smoke.sh internals: only scripts/ci/ci-workflow.test.ts:141-156 references it, and it checks ci.yml steps, not the script body. Nothing to extend.
3. The new comment's host claim: scripts/ops/backup.sh:16 chowns the backup staging volume to 10001:10001. Claim holds.

## Answers to the controller's questions

1. The 599bac9 change is correct and minimal: chmod 777 on the throwaway CI dir only (boot-smoke.sh:82), same pattern as the throwaway secrets (boot-smoke.sh:168). The container stays uid 10001: no --user in the script (backup run at boot-smoke.sh:116-118), and the service container is still asserted `Config.User = 10001` (boot-smoke.sh:182). Cleanup still works on Linux (cross-cutting check 1). Linux proof is the PR's CI run.
2. packages/api/src/main.ts (#224) is unchanged since d5a42c9 (git diff --quiet exit 0 over main.ts, startup.ts and main-fatal.test.ts). The earlier approval stands at 599bac9: both events call fail() (main.ts:40-41), fatal line with event and a regex-guarded class name only (main.ts:16-17, 31), bounded 10 s drain (main.ts:5, 32-38), exit 1 on every fatal path, second event exits at once (main.ts:28), clean SIGTERM exits 0 only when not failing (main.ts:46-53).

## Remaining Minors

- m1. packages/api/test/main-fatal.test.ts:93-94 asserts exit code not 0 rather than exactly 1; tighten to `toBe(1)`.
- m2. No test for the second-fatal-event path (main.ts:28) or SIGTERM during a fatal drain (main.ts:48).
