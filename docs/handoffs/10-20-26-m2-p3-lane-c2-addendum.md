# Handoff addendum: M2 P3 Lane C2, #748 image job shards, 10-20-26

Adds to [10-20-26-m2-p3-lane-c2.md](10-20-26-m2-p3-lane-c2.md). After BW4, M2 Manager 10 gave Lane C2 one more job from the developer: #748.

- **Branch:** `ci/m2-p3-shard-image`, cut from `main` `bb6639f10804fb707c999208c7c159dc280cf92a`.
  - Work commits: `b4535022ccdc1fe565ab2f6a1f00f10031f2db4b` (the shards) and `1cde3ad1136bdc1c89f716ec8b9f363d5ab5cfc4` (the manager's pins).
  - The review artifact and this addendum sit on top. The PR body names the pushed head.
- **Done:**
  - `image` now builds the image once and uploads it on every run.
  - The new `e2e` matrix job runs three Playwright shards. Each shard loads that one image, boots its own copy and runs a third of the suite. `fail-fast` is off, and each shard has a 35-minute timeout.
  - `ci` needs `e2e`, so one failing shard fails `ci` and blocks publish. Publish still pushes the same artifact the shards tested.
  - The required checks `ci` and `sensitive-review` keep their names.
  - `ci-workflow.test.ts` pins the shape and the three manager checks.
- **Checks:**
  - `pnpm verify` is green.
  - actionlint (pinned digest) and zizmor 1.30.1 (pinned hashes, run in a Linux container) are clean.
  - `wave-review` (gate tier, Opus 5.5 `medium`) approves. Artifact: [ci-m2-p3-shard-image.md](../reviews/ci-m2-p3-shard-image.md).
- **Residual minor G-m1:** the shard total `3` in `--shard="$SHARD/3"` is not tied to the matrix list. Shrinking the matrix alone would skip part of the suite. Today separate test assertions pin both values. A fix is to pass `strategy.job-total` through env, or to add a test that ties the two. It is left for the manager to rule on, since a change now would need another review.
- **Rulings:** M2 Manager 10, 10-20-26 (GO and the three pins); D-M2P3-6 in the Track A plan. Both are recorded in the PR body.
- **Next step:**
  1. The PR's own CI run gives the shard timings, which go in a PR comment.
  2. If any shard runs over about 10 minutes, report it to the manager before adding the screenshot split.
  3. The developer merges. Lane C2 then stops.
