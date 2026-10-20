---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "1cde3ad1136bdc1c89f716ec8b9f363d5ab5cfc4"
verdict: "approve"
---

# Review: ci/m2-p3-shard-image

Date: 10-20-26.

## Scope

Branch ci/m2-p3-shard-image, range bb6639f10804fb707c999208c7c159dc280cf92a..1cde3ad1136bdc1c89f716ec8b9f363d5ab5cfc4 (gate tier: `.github/workflows/ci.yml`, `scripts/ci/ci-workflow.test.ts`). The wave delivers #748: the `image` job now builds and uploads the runtime image once; a new `e2e` matrix job runs the Playwright smoke suite in three shards, each loading that image, booting its own container and running `--shard=k/3`. The `ci` aggregate needs `e2e`; publish still pushes the uploaded artifact.

## Findings summary

Critical 0, important 0, minor 1. Rulings D-M2P3-6 and the #748 hard rules (required check names kept, failing shard fails ci, each shard boots its own copy, publish uses the tested image, 35-minute timeout per job) stand and are met. ADR-0008, Task 29 C1/C2, #315 G-m2, #617 and #627 stand. No controller rulings were needed.

## Cross-cutting checks

1. apps/web/playwright.config.ts (empty or partial shard passing; setup project under sharding): no passWithNoTests, forbidOnly on CI, 59 specs so no shard is empty; the setup dependency project runs in every shard.
2. scripts/ci/boot-smoke.sh (`up` relying on build-job state or rebuilding): it rebuilds only with `--build`, never passed; it writes its env to the shard's own GITHUB_ENV.
3. scripts/ci/ci-workflow.test.ts at head: 72 of 72 passed.

## Answers to the controller's questions

1. No path lets a shard pass without its share: no pass-with-no-tests anywhere, fail-fast off, matrix failure fails `ci` through the allowlist. Residual risk is the minor below.
2. Yes: one build in `image`; shards and publish download this run's `querymodule-image` by name (no run-id), neither rebuilds; publish requires `needs.ci.result == 'success'` on push to main.
3. Yes: `image` and `e2e` carry the docs-only and board-only `if`, and `ci` counts skipped as passed; pinned by tests.

## Remaining Minors

- m1 ci.yml:330, 368: the shard total `3` in `--shard="$SHARD/3"` is not tied to the matrix length; shrinking the matrix alone would silently drop a shard. Pass `strategy.job-total` through env, or assert the denominator equals the matrix length in ci-workflow.test.ts.
