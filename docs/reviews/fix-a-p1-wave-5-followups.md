---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "08e88dac1ef7ed06173840bac977619215264b80"
verdict: "approve"
---

# Review: fix/a-p1-wave-5-followups

Date: 09-28-26. Gate tier only, no critical slice. Fast-path re-review of the new head after the first review approved e58fd93.

## Scope

Branch fix/a-p1-wave-5-followups. Range dcf5203029e06717452088365771e5d5f669f9a0..08e88dac1ef7ed06173840bac977619215264b80. Wave 5 follow-ups #230 and #231:

- The `image` job waits for `checks` (G-M1 of the wave 5 review).
- A test guards that every push to main builds the image (#230).
- promote.yml restores no dependency cache, and setup-node sets `package-manager-cache: false`.
- boot-smoke `down` fails if a seeded demo password appears in the service log, and fails closed on grep errors (spec 8.5).
- gh-setup-project.mjs skips the parent link for a follow-up with no parent (board cap).
- ci.yml concurrency: PR branches still cancel per ref; main runs queue (developer ruling 09-28-26, a deliberate deviation from spec 9.3 recorded in the PR body).

Commits since e58fd93: 1c70438, e2a667f, 08e88da (ci.yml, promote.yml, ci-workflow.test.ts, promote-workflow.test.ts; 19 changed lines).

## Findings summary

Critical 0, important 0, minor 1 (new). Earlier minors: Minor 1 (setup-node cache) fixed by e2a667f; Minor 2 (test title overclaim) resolved by the developer ruling and 1c70438, except the case in the remaining minor; Minor 3 (board-cap test source-shape only, G-M3) stands by controller ruling, no issue. Rulings kept as stands: the #230 premise correction, G-M1, G-M2, G-M3, the board-cap carry. Controller ruling: main ci runs must not cancel each other (spec 9.3 deviation).

## Cross-cutting checks

- Publish ordering: with main runs queued, could publish push :latest out of order? No. Concurrency is workflow-level, so a queued run starts only after the earlier run's publish job ends, and GitHub keeps the newest pending run. :latest never moves backwards.
- promote.yml: does it depend on cancelled main runs? No. It requires a successful ci run for the sha (promote.yml:57) and fails closed otherwise.
- Test parsing: both tests parse the workflows with `yaml.parse`, so `false` is a boolean and the concurrency expression is compared as the literal string.

## Answers to the controller's questions

1. Both changes are correct. ci.yml:14 evaluates true for pull_request events (ref refs/pull/N/merge), so PR branches still cancel, and false for a push to refs/heads/main, so main runs queue in group ci-refs/heads/main (ci.yml:11). promote.yml:66 turns off setup-node's automatic cache. ci-workflow.test.ts:161-172 and promote-workflow.test.ts:210-214 pin both.
2. Nothing else relies on main runs being cancelled. Publish runs inside the same workflow run, so queued runs publish in push order. promote.yml fails closed on any sha whose ci did not succeed.

## Remaining Minors

1. ci.yml:12-14 and ci-workflow.test.ts:161-164: GitHub keeps at most one pending run per concurrency group, so if three main pushes land within one ci run, the pending middle run is cancelled. That sha gets no sha- image, and promote refuses it until someone re-runs its ci by hand. Add one comment line (and a PR body note) naming this limit and the re-run step. A per-sha group on main would remove the limit, but publish could then push :latest out of order, so it is not recommended.
