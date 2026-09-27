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
| `[critical]` | credentials, audit, dispatch, adapters, planner, delegation, terminal parser, write-back, delete-from-view, migrations, the audit, WS, primitives and identity contracts, and the sensitive-review gate itself (`.github/sensitive-paths`, `scripts/ci/sensitive-review.ts`, `scripts/ci/check-sensitive-review.ts`, and the reserved `scripts/ci/check-audit-migrations.ts`) | artifact from Opus 5.5 at effort high or above (xhigh or max until #92) |
| `[gate]` | `.github/**`, `scripts/ci/**`, `scripts/ops/**`, `**/biome.json`, `.gitignore`, `**/vitest.config.ts`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `**/tsconfig.json` | artifact from Opus 5.5 at effort medium or above (high or above until #92) |
| `[deps]` | `pnpm-lock.yaml`; a version-only change of an existing action or package (`package.json` dependency fields: the same package names, every changed value old and new a plain semver version; workflow `uses:` refs: per diff hunk the same number of removed and added lines, paired in order, each pair byte-identical up to and including `@`, the new ref a tag or sha) | no artifact; the `ci` job's licence check, `pnpm audit --prod`, dependency review, the registry-only lockfile check, actionlint and zizmor |
| `[exempt]` | `.github/ISSUE_TEMPLATE/**`, `.github/pull_request_template.md` | nothing |

- Lines before any section header are `[critical]`, so an old untiered file is read at the strictest tier.
- Precedence within one file: critical, then exempt, then deps, then gate. `[exempt]` never lowers `[critical]`.
- A changed file takes the highest tier from the base and the head copy of the file, so a PR cannot lower the tier that judges it.
- The PR's highest tier sets the effort the artifact needs. Files changed after `reviewedSha` fail the check only when they are gate or critical.
- `wave-review` runs with its reviewer and re-reviewer at effort medium for a gate-only PR and at high when any critical path is touched (amended by #92; the artifact front matter follows the role).
- The `ci` job adds `pnpm audit --prod`, `actions/dependency-review-action` (fail on moderate), a check that every `pnpm-lock.yaml` resolution is a registry entry (integrity only; no tarball URL, git repo or directory), actionlint and zizmor (`.github/zizmor.yml`, tag pins accepted per spec 9.4). actionlint and zizmor are pinned by image digest and wheel hash.
- `.github/dependabot.yml` stays `[gate]`: no automated check reads it.
- Known gap: the checks catch known advisories and non-registry sources, not a malicious new version of an existing package. `.npmrc` (registry settings) is outside the tier file today.

## Consequences

- Dependabot PRs that only bump versions need no agent review; the automated checks gate them.
- Workflow, CI-script and config changes cost an Opus high review instead of xhigh.
- The ruleset still requires `ci` and `sensitive-review`; no new required check.
- A writer can still change the checker in their own PR (spec 14, `docs/project-board.md` automation notes); tiers do not change that.
- Spec 9.1 gets the line "Amended by ADR-0007 (tiered review; the one-tier artifact rule)."
- CLAUDE.md's sensitive section and roles table, and `.claude/workflows/README.md` (`wave-review`), name the tiers.

## Amendment 09-26-26 (#92): review caps, branch-keyed artifact, slices, fast path

Context: review spend on a demo-scale prototype on mock data was out of proportion (PR #91: a 20-line fix paid a full Opus high review; PR #76: two xhigh reviewers). Developer decision: no xhigh or max review anywhere.

- **Effort.** `[critical]` needs an artifact from Opus 5.5 at effort high or above; `[gate]` at medium or above. `scripts/ci/sensitive-review.ts` enforces both; a critical path under a medium artifact fails. The `wave-review` and `sdd-task` defaults use no xhigh or max role; an override to either is logged.
- **Branch-keyed artifact.** The check reads `docs/reviews/<branch>.md` (the PR head ref from `HEAD_REF`, every "/" to "-") first, then `docs/reviews/pr-<n>.md`. A head ref that is not a plain branch name exits 2. The review can run and land before the PR exists.
- **Tier slices.** `wave-review` takes `criticalFiles` and `gateFiles` and reviews each slice at its own tier in one run (gate slice first, critical slice last); ordinary files are not reviewed. The last slice writes the artifact only when every slice approved.
- **Fast path.** When critical and gate files change at most 50 lines (added plus deleted), one reviewer at the highest tier reviews them; on approve with no critical or important finding it writes the artifact with `mode: "fast"` and nothing else runs. The check counts the lines itself with `git diff --numstat` (binary files never fit) and fails a `mode: "fast"` artifact above the limit, so a mislabelled PR fails closed.
- **Context diet and cross-cutting budget.** Reviewers get a controller excerpt (`contextPath`) of the rulings and spec lines that touch the changed files, and at most 3 cross-cutting checks outside the diff, each for a named risk.
- **Board data.** Issue numbers, titles, bodies and follow-ups live in `docs/board/board-data.json` (ordinary, schema-checked); the script that writes to GitHub stays in `scripts/ops/` (gate).
- Consequence: an Opus high review may miss what xhigh would have caught on critical code. Accepted for the prototype; revisit before real CJIS data or a production pilot.
