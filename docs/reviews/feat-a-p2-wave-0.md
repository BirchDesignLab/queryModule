---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "b9235365bbb64b544f49769b625b36aed0b64e07"
verdict: "approve"
---

# Review: feat/a-p2-wave-0 (gate tier)

Date: 09-28-26.

## Scope

Branch feat/a-p2-wave-0, range cd5a9e4..b9235365bbb64b544f49769b625b36aed0b64e07. Gate files: packages/api/src/auth/routes.ts (Task 27, #246: sign-out fails closed when the session row survives) and scripts/ops/gh-setup-project.mjs, gh-setup-project.test.ts, board-config.mjs, board-model.mjs, board-model.test.ts, progress-svg.mjs and progress-svg.test.ts (deleted), scripts/ci/project-sync.test.ts (Task 26, #244: remove the README SVG dashboard and the unused Ready Status option). Task 1 (#222) is ordinary and outside this slice.

## Findings summary

Critical 0, important 0, minor 3. No ledger rulings touch these files. Controller deviation from plan Step 26.1 (source assertions plus a spawned `--dashboard` exit-2 check instead of an `--apply` run against a mocked gh) judged adequate.

## Cross-cutting checks

1. Importers of the deleted progress-svg.mjs, render-fixture-dashboard.mjs, or callers of waveSpan and `--dashboard`: none tracked (only negative test assertions and issue text in board-data.json; scripts/dist is gitignored build output).
2. Consumers of the removed Ready Status in scripts, .github and docs/project-board.md: none.
3. Workflows invoking the dashboard mode or committing the SVGs: none.

## Answers to the controller's questions

1. For an ok Better Auth response, signOut re-reads the session row and returns a fresh 500 internal (not the Better Auth response) when it survives, before the logout audit and eventBus.endSession (routes.ts:142-149). A throw in the re-read or audit also drops the Better Auth response. A non-ok Better Auth response passes through unchanged per plan (minor m1). The log line carries only the session id (routes.ts:147), and the test asserts the token never appears.
2. Nothing still imports or calls the removed files or waveSpan. ensureSelect keeps existing option ids (gh-setup-project.mjs:394-398), so other Status values survive; only items set to Ready would lose it, and none hold Ready.

## Remaining Minors

- m1 routes.ts:138: a non-ok Better Auth response is forwarded with any Set-Cookie it carries; consider stripping it or answering 500 when the row survives.
- m2 sign-out.test.ts:59-63: assert the cookie is kept in the RAISE(ABORT) case.
- m3 gh-setup-project.test.ts:159-165: pin the fs import to readFileSync only, so any fs write API is caught, not just writeFileSync.
