---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "64bb9b9626c172f25c83521629cbe89d976db5ba"
verdict: "approve"
mode: "fast"
---

# Review: fix/ci-publish-skipped

Date: 10-16-26

## Scope
Branch fix/ci-publish-skipped, range 3e1f5bb3bf15acae64752f53d7f9dc1fe2994ff3..64bb9b9626c172f25c83521629cbe89d976db5ba (1 commit, 13 lines, gate tier). The `publish` job in `.github/workflows/ci.yml` now checks `!cancelled() && needs.ci.result == 'success'` alongside the push-to-main guard, so the implicit `success()` no longer skips it when the `board` job is skipped. `scripts/ci/ci-workflow.test.ts` pins the new condition.

## Findings summary
Critical 0, important 0, minor 0. No ledger rulings or controller rulings apply.

## Cross-cutting checks
- `scripts/ci/changed-paths.mjs`: risk that `ci` succeeds on push with `image` skipped. Any push returns docs_only=false and board_only=false, so `image` always runs and uploads the smoke-tested artifact. No issue.
- `ci` aggregate job: risk that a failed `image` still lets publish run. The allowlist accepts only success or skipped, so a failure fails `ci` and publish does not run. No issue.

## Answers to the controller's questions
None asked.

## Remaining Minors
None.
