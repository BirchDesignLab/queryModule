---
date: 09-26-26
status: accepted
track: all
phase: m0-p0
supersedes: ["spec 9.1"]
---

# 0007 Tiered sensitive review

## Context

Spec 9.1 gives every path in `.github/sensitive-paths` one rule: the PR needs `docs/reviews/pr-<n>.md` from an Opus 5.5 review, and since PR #38 the check demands effort xhigh or max. That one rule prices an issue form, a Dependabot patch bump and the audit contract the same. After PR #38 made `package.json` sensitive (so the gate cannot be weakened through its scripts), every npm Dependabot PR would need an xhigh review, and PR #76 (a board script, templates and one workflow) needed two xhigh reviewer runs. The spend was out of proportion to the risk on most of those paths, while audit, credential and dispatch code does warrant the full review.

## Options

1. Keep one tier and keep cosmetic work out of sensitive paths: cheapest to decide; Dependabot still needs an xhigh review per PR.
2. Exempt non-executable files only: fixes templates; Dependabot and workflow edits stay at xhigh.
3. Tiers by risk, with automated checks standing in for review where they can: one more concept in the check; review effort matches what can go wrong.

## Decision

Option 3. `.github/sensitive-paths` gains sections; `scripts/ci/sensitive-review.ts` enforces them.

| Tier | Paths | Needs |
|---|---|---|
| `[critical]` | credentials, audit, dispatch, adapters, planner, delegation, terminal parser, write-back, delete-from-view, migrations, the audit, WS, primitives and identity contracts, and the sensitive-review gate itself (`.github/sensitive-paths`, `scripts/ci/sensitive-review.ts`, `scripts/ci/check-sensitive-review.ts`) | artifact from Opus 5.5 at effort xhigh or max |
| `[gate]` | `.github/**`, `scripts/ci/**`, `scripts/ops/**`, `**/biome.json`, `.gitignore`, `**/vitest.config.ts`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `**/tsconfig.json` | artifact from Opus 5.5 at effort high or above |
| `[deps]` | `pnpm-lock.yaml`, `.github/dependabot.yml`; a `package.json` change to dependency fields only; a workflow change to `uses:` lines only | no artifact; the `ci` job's licence check, `pnpm audit --prod`, dependency review, actionlint and zizmor |
| `[exempt]` | `.github/ISSUE_TEMPLATE/**`, `.github/pull_request_template.md` | nothing |

- Lines before any section header are `[critical]`, so an old untiered file is read at the strictest tier.
- Precedence within one file: critical, then exempt, then deps, then gate. `[exempt]` never lowers `[critical]`.
- A changed file takes the highest tier from the base and the head copy of the file, so a PR cannot lower the tier that judges it.
- The PR's highest tier sets the effort the artifact needs. Files changed after `reviewedSha` fail the check only when they are gate or critical.
- `wave-review` runs with its reviewer and re-reviewer at effort high for a gate-only PR (role overrides; the artifact front matter follows the role) and at xhigh when any critical path is touched.
- The `ci` job adds `pnpm audit --prod`, `actions/dependency-review-action` (fail on moderate), actionlint and zizmor (`.github/zizmor.yml`, tag pins accepted per spec 9.4).

## Consequences

- Dependabot PRs that only bump versions need no agent review; the automated checks gate them.
- Workflow, CI-script and config changes cost an Opus high review instead of xhigh.
- The ruleset still requires `ci` and `sensitive-review`; no new required check.
- A writer can still change the checker in their own PR (spec 14, `docs/project-board.md` automation notes); tiers do not change that.
- Spec 9.1 gets the line "Amended by ADR-0007 (tiered review; the one-tier artifact rule)."
- CLAUDE.md's sensitive section and roles table, and `.claude/workflows/README.md` (`wave-review`), name the tiers.
