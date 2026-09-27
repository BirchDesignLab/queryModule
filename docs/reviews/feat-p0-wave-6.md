---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "f0173088892270e324c8424d9e789903ffa1ea13"
verdict: "approve"
---

# Review: feat/p0-wave-6

Date: 09-27-26

## Scope

- Branch: `feat/p0-wave-6`.
- Range: dbb911f4384d293c81274b18fc6dd5dab460fe27..f0173088892270e324c8424d9e789903ffa1ea13.
- Review shape: tier slices (ADR-0007 amendment, #92). The gate slice ran first and the critical slice last. Ordinary files were not reviewed.
- Critical slice: `.github/sensitive-paths`, `scripts/ci/sensitive-review.ts`.

What W6 delivers:
- #92: review effort caps (critical high+, gate medium+), a branch-keyed artifact and the counted fast path in sensitive-review.
- ADR-0008: ci.yml restructure (changes, checks, test, web, mobile, aggregate `ci`).
- Task 26: apps/mobile placeholder, web and mobile CI jobs.
- Task 27: `@libsql/client` runtime dependency and a Node 24 check.
- Task 28: `gh-setup-repo.sh` ruleset script (dry run by default).
- Board data moved to `docs/board/board-data.json`, with fail-closed validation.
- #69: zod input-side request schemas.
- #85: core-purity scan via global objects, config typecheck, TokenStore globs at [critical].
- #84: P1 plan alignment.

## Findings summary

- Critical: 0. Important: 0.
- Minor: 8 in total, all open for a follow-up.
  - Gate slice: G-M1 to G-M6.
  - Critical slice: C-M1, C-M2.
- No fix pass was needed, since no finding was critical or important.

Rulings kept as they stand:
- Controller 09-26-26: no xhigh or max role.
- Task 602 spec:S1 and critic:C5.
- Task 604 IC1 and critic:C1 (fixed by docs).
- Task 605 spec:S1, spec:CV1 to CV3 and critic:CV1.
- Licence per-package exceptions (developer, 09-27-26).
- TokenStore tier: the interface in platform.ts stays ordinary; implementations go in `*token-store*` files.

## Cross-cutting checks

Gate slice:
1. sensitive-review.ts fail-closed paths: they hold.
2. TokenStore file names in plans, packages and apps: no implementation exists yet, and the P1 plan names `*token-store*` files.
3. dependabot.yml against the `@types/node` ^24 pin: there is no ignore rule (G-M6).

Critical slice:
1. ci.yml and check-sensitive-review.ts for HEAD_REF injection and read root. HEAD_REF is passed through env only (ci.yml:280). The script gets `process.env`. `readFile` resolves under the repo root and gets only the validated `docs/reviews/<name>.md`.
2. changed-paths.mjs for a fail-open path filter. It falls back to all-true on push, an empty or zero base, or a git error. There is one quoting gap (C-M2).
3. git ls-files, platform.ts and CLAUDE.md for TokenStore coverage and mirror drift. No implementation exists yet. The interface in platform.ts stays ordinary, and CLAUDE.md:62,68 is in step with the tier file.

## Answers to the controller's questions

1. Yes, sensitive-review.ts fails closed in every case asked.
   - A critical path under a medium artifact fails (sensitive-review.ts:209,242).
   - A `mode: "fast"` artifact above 50 lines fails with code 1 (:252-256). A binary file counts as Infinity (:294). An unparseable numstat or a git failure exits 2 (:292,301-307,474-476). An unknown or empty mode fails (:249-251).
   - HEAD_REF is confined to a single file name under docs/reviews, and an invalid ref exits 2 (:178-190,419-424).
   - A stale branch-keyed reviewedSha fails. The ancestry check runs on the artifact actually read (:430-447,258-261).
2. Yes, the aggregate `ci` fails on every non-pass result.
   - It passes only when every needed job is success or skipped (ci.yml:233-256).
   - A failed `changes` or `checks` job is itself `failure`, so `ci` fails even though its dependents show skipped.
   - changed-paths.mjs falls back to all-true on push, an empty or zero base, or a git error (:95-113).
   - Caveats, all minor: G-M1 (board-data-only PRs skip tests), G-M2 (the `== 'true'` form), C-M2 (quoted paths).
3. No, for labels, fields, repo and project.
   - These come only from gate-tier board-config (gh-setup-project.mjs:282-304, board-config.mjs:154-156).
   - Issue numbers are unique, and a missing one throws (board-model.mjs:84).
   - Bounded gaps, both minor: G-M4 (a follow-up can be repointed at an unrelated live issue) and G-M3 (a bad `parent` throws mid-apply). This answer rests on the gate slice evidence.
4. Yes, on both counts.
   - Dry run is the default and makes only reads (gh-setup-repo.sh:62-123, gh-setup-repo.test.ts:51).
   - `--apply` produces the spec 9.1 ruleset exactly: squash only, `ci` and `sensitive-review` required, linear history, deletion and non_fast_forward rules, no bypass actors (gh-setup-repo.sh:79-110, gh-setup-repo.test.ts:69). This answer rests on the gate slice evidence.
5. Yes, for kebab-case names, and no tier is lowered.
   - `**/*token-store*` and `**/*token-store*/**` are under [critical] (sensitive-paths:46-47).
   - The change adds lines only. Critical wins in `classifyOne` and `tierOf` (sensitive-review.ts:39,47-54).
   - camelCase and PascalCase names are not covered (C-M1).

## Remaining Minors

- G-M1 `scripts/ci/changed-paths.mjs:9-16`: treat `docs/board/` as a gate input, not docs-only.
- G-M2 `.github/workflows/ci.yml:181,205`: use `!= 'false'` for the web and mobile conditions.
- G-M3 `scripts/ops/board-data-schema.mjs:94`: make follow-up `parent` required and check it against phase or wave numbers.
- G-M4 `scripts/ops/gh-setup-project.mjs:402-453`: refuse to rewrite a live issue that shares no spec label.
- G-M5 `scripts/ci/core-purity.ts:30-35`: catch destructuring, chained and aliased global objects.
- G-M6 `package.json:27`: add a Dependabot ignore for `@types/node` major updates.
- C-M1 `.github/sensitive-paths:46-47`: add case-insensitive TokenStore globs (`**/*[Tt]oken[Ss]tore*`, plus the `/**` form).
- C-M2 `scripts/ci/changed-paths.mjs:32-35`: list paths with `-z` so quoted names never skip web or mobile.
