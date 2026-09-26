---
date: 09-26-26
status: proposed
track: a
phase: m0-p0
supersedes: ["spec 9.1", "spec 9.3"]
---

# 0008 CI pipeline design: one aggregate check, path-scoped jobs, break glass

## Context

Spec 9.3 lists CI as one ordered sequence of steps, and spec 9.1 makes `ci` and `sensitive-review` required with an empty bypass list. W6 adds the web build and expo export (Task 26) and turns the ruleset on (Task 28); Track A P1 adds the image, boot smoke and Playwright. As one long job, every new step lengthens every PR, a flaky or external step blocks every merge, and a broken CI with no bypass cannot merge its own fix. The review workflows became a merge blocker on PR #76 the same way (issue #81).

## Options

1. Keep one `ci` job and append steps: simplest; every PR pays for every step, and one failure blocks all merges.
2. One job per step, each a required check: failures are isolated, but every new job edits the ruleset.
3. Separate jobs behind one aggregate `ci` check, path-scoped, with a written break-glass rule: the ruleset stays fixed and PRs run only what their paths need.

## Decision

Option 3.

- **One required check.** Heavy work runs in separate jobs. A final job named `ci` needs all of them, runs `if: always()`, and fails when any needed job failed or was cancelled; a job skipped by its path filter counts as passed. The ruleset requires only `ci` and `sensitive-review`, so adding a job never changes the ruleset.
- **Path-scoped jobs.** The web build, expo export, image build, boot smoke and Playwright run only when their paths change, decided by `scripts/ci/changed-paths.mjs` (the docs-only fast path, extended). If path detection fails or cannot tell, every job runs (fail closed). Pushes to `main` run everything.
- **Fast fail.** Lint and typecheck run first; the heavy jobs need them. Every job sets `timeout-minutes`. The target for a PR run is under 10 minutes.
- **Flakes.** Playwright retries a failed test once in CI and keeps the trace. A test that flakes gets the `quarantine` label and an issue; nothing retries silently in a loop.
- **External services.** Tools and images stay pinned by digest or hash (ADR-0007) and cached where the runner allows. A step that depends on an outside service says so in its failure message, so an outage never reads as a code failure.
- **Break glass.** The bypass list stays empty. When CI itself is broken and blocks its own fix, only the repository admin (BirchDesignLab) may switch the ruleset off, for the fix PR only; the admin opens an issue labelled `break-glass` naming the PR and the reason before doing it, switches the ruleset back on the same day, and the fix PR still gets its review artifact if it touches a gate or critical path.
- **Merge style.** Squash merge with linear history, as spec 9.1 says, for every PR including wave PRs from W6 on (W1 to W5 merged with merge commits under ADR-0006). The per-task commits of a wave stay reachable through a tag `p0-wave-<k>` on the wave branch head, pushed before the merge; the SDD ledger keeps the task commit ranges.
- **Metrics.** CI wall-clock time per PR is recorded next to the agent metrics in the ledger and the wave PR body.

## Consequences

- W6 Task 26 restructures `ci.yml` into these jobs before it adds steps 8 and 9, and Task 28's ruleset requires only `ci` and `sensitive-review`.
- `changed-paths.mjs` gains per-area outputs and tests; its fail-closed default covers them.
- Spec 9.1 and 9.3 get the line "Amended by ADR-0008 (aggregate ci check, path-scoped jobs, break glass, squash from W6)."
- A path filter bug can skip a job that should have run; the fail-closed default and full runs on `main` catch it after merge at the latest.
- Break glass relies on the admin following the rule; the `break-glass` issue is the audit trail.
