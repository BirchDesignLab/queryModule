---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "d5a42c9738a6d21fefc81561e21c73baa9ae5168"
verdict: "approve"
---

# Review: feat/a-p1-wave-5 (09-28-26)

## Scope

Branch feat/a-p1-wave-5, worktree C:/git/queryModule-a, range 4460145ae2176752a97f181ef1cdeef8bf624cd2..d5a42c9738a6d21fefc81561e21c73baa9ae5168. Mixed wave-review: gate slice at Opus 5.5 medium (approved, 0 open critical or important), critical slice at Opus 5.5 high on packages/api/src/main.ts only.

The wave delivers plan tasks 24 (#127), 25 (#128), 27 (#130), 29 (#132), 30 (#133) and #67, #208, #224: the seed and role CLIs, ops CLIs compiled into the image, the image, boot smoke, Playwright step 12 and publish jobs in ci.yml, the web zod jitless CSP fix, the sensitive-review main-merge tests, and main.ts failing closed on uncaughtException and unhandledRejection.

## Findings summary

- Critical slice: 0 critical, 0 important, 2 minor.
- Gate slice: approved with 0 open critical or important.
- Rulings kept as stands (w5-review-context.md): the #224 ruling (event and error class name only, no message or stack, 10 s drain, exit 1, second event exits at once) is met by main.ts; T29 layout ruling (publish needs ci, push to main only, exact smoke-tested image) holds.

## Cross-cutting checks

1. packages/api/src/startup.ts stop(): a second concurrent stop (SIGTERM during a fatal drain) cannot report success; every path exits 1 and the 10 s timer bounds a hang.
2. Other process listeners in packages/api/src and tests: none that could print a message or stack; boot-smoke.sh still requires SIGTERM exit 0 and no key material in the log.
3. ci.yml image and publish: publish runs only on push to main after ci succeeds and pushes the artifact the image job smoke-tested. Observation for the controller: on a docs-only push to main the image job is skipped and publish fails at download-artifact (fails closed, nothing pushed).

## Answers to the controller's questions

1. Worktree C:/git/queryModule-a, branch feat/a-p1-wave-5, head d5a42c9; issues #127, #128, #130, #132, #133, #67, #208, #224. The critical slice covers #224.
2. #224: yes. Both events call fail() (main.ts:40-41): one fatal line with event and a regex-guarded class name only (main.ts:16-17, 31), bounded 10 s drain of server and DB (main.ts:5, 32-38), exit 1 on every path, and the clean SIGTERM path exits 0 when not failing (main.ts:46-53). Tested in main-fatal.test.ts with a loaded secret in the message.
3. The image and publish jobs leave the existing steps, conditions, permissions and sensitive-review job unweakened; ci adds image to its needs under the same allowlist; publish has packages: write only for itself, runs only on push to main, and loads and pushes the exact smoke-tested image.

## Remaining Minors

- m1. packages/api/test/main-fatal.test.ts:93-94 asserts exit code not 0 rather than exactly 1; tighten to `toBe(1)`.
- m2. No test for the second-fatal-event path (main.ts:28) or SIGTERM during a fatal drain (main.ts:48).
