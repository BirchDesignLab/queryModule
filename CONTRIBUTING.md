# Contributing

This repository is built by one developer working with AI agents (Claude Code). **It does not accept
outside contributions**: pull requests from outside the project are closed without review. To report
a security problem, see [SECURITY.md](SECURITY.md).

The rest of this page describes how the work is planned, built, reviewed and merged, for anyone
reading the history or reviewing the code. The agents' own working rules, including model and
effort for every agent, are in [CLAUDE.md](CLAUDE.md).

## How the work is organized

```
Milestone (M0 to M4, plus Later)
  > Phase (P0 to P3 inside a milestone)
    > Track (A platform, B web, Core, D mobile from M4): one phase plan per track
      > Wave (one pull request: a run of consecutive tasks from one plan)
        > Task (one GitHub issue, built with tests first)
```

- **Milestones** M0 to M4 are GitHub milestones, each closed by a release tag (`m0`, `m1`) promoted
  through `promote.yml` after its exit gate. Later holds unscheduled items.
- **Phases.** P0 is contracts: schema, route, event and audit shapes land first and are frozen at the
  P0 gate. After the gate a contract changes only through the contract procedure (master plan 8), one
  change per pull request; audit details are additive only. Each phase ends at a gate verified on `main`;
  a phase can be promoted to the live demo without a milestone tag (M2 P0.5 and P1 were).
- **Tracks** split ownership: A owns `packages/api`, `deploy/` and the ops, CI and mock-data scripts;
  B owns `apps/web`, `packages/web-ui`, `packages/tokens` and `packages/client`; Core owns
  `packages/core`, the sites, locales and schema in `packages/config`, and `docs/testing/stories.json`; D will own the mobile app and
  `packages/rn-ui` from M4. Master plan section 2 has the full list.
- **Plans.** The [master plan](docs/superpowers/plans/2026-09-25-implementation-master-plan.md)
  sets the tracks, the session protocol and the definition of done. Each phase and track has its own
  plan in [docs/superpowers/plans](docs/superpowers/plans/). [STATUS.md](docs/superpowers/plans/STATUS.md)
  is the live grid. A plan is frozen at its phase gate.
- **Decisions.** Any change to the design spec, or a choice the spec left open, gets an
  [architecture decision record](docs/decisions/README.md). No new tracking file is added without
  retiring one.

## Issues and the project board

- One issue per task. Each carries one track label (`platform`, `web`, `core`, `mobile`), one phase
  label (`p0`, `p0-5`, `p1`, `p2`, `p3`) and one milestone; `sensitive`, `contract` and
  `api-breaking` mark the risk. `scripts/ops/gh-setup-labels.sh` creates these labels.
- Each phase has a parent issue (label `epic`) with its tasks as sub-issues, so the parent shows a
  progress bar. Items found in review become `follow-up` issues, or `decision` issues when the
  developer must choose.
- The [project board](https://github.com/users/BirchDesignLab/projects/1) is a view over the issues
  and pull requests, which stay the source of truth. `scripts/ops/gh-setup-project.mjs` keeps
  labels, milestones, parents and fields in shape from `docs/board/board-data.json`;
  [docs/project-board.md](docs/project-board.md) describes the board and its manual steps.

## Branches and pull requests

- Every change is on a short-lived branch with a pull request; nothing is committed to `main`
  directly. One pull request per wave.
- The developer approves every push and merges every pull request.
- A pull request closes each issue it finishes with its own `Closes #n` line.

## Running tasks with workflows (ADR-0006)

Plan tasks run through saved workflow scripts in `.claude/workflows/`
([README](.claude/workflows/README.md)):

- `sdd-task.js` runs one task at its review tier: an implementer writes the test first and the code,
  one Opus reviewer checks it with spec, quality and critic lenses (#391), a ruler rules on each
  finding, a capped fix loop applies the rulings, and an independent gate role runs lint, typecheck
  and tests on a clean tree before the task counts as complete.
- `sdd-wave.js` runs a wave's tasks through `sdd-task` in order and stops at the first one that does
  not complete.
- `wave-review.js` runs the whole-branch review of a pull request that touches sensitive paths, one
  ruled fix pass and one re-review, and writes the review artifact.
- A small change whose design is already settled (about 150 changed lines or fewer, no open design
  question) is made directly, still with tests first, `pnpm verify` and `pnpm audit --prod`.
- Every agent's model and effort are set on purpose, from the table in [CLAUDE.md](CLAUDE.md).

## Review tiers (ADR-0007)

[`.github/sensitive-paths`](.github/sensitive-paths) sorts every path into a tier, and the required
CI check `sensitive-review` holds a pull request to the review its highest tier needs:

| Tier | Covers | Review |
|---|---|---|
| Critical | Credential handling, encryption and keys, audit logging and migrations, query dispatch and adapters, the terminal parser, config loading, the live config store, the review gate itself | Whole-branch Opus review at `high` effort, recorded as an artifact |
| Gate | CI and the merge path, auth and sessions, WebSocket, log redaction, HTTP security guards, the admin console, ops scripts, the fixture policy | Whole-branch Opus review at `medium` effort, recorded as an artifact |
| Deps | The lockfile and version-only dependency bumps | Automated checks only |
| Ordinary | Everything else, including these docs | CI only |

The artifact is `docs/reviews/<branch>.md` (each `/` becomes `-`); `docs/reviews/pr-<n>.md` is also
accepted. A pull request whose critical and gate files change 50 lines or fewer may use the fast
path with one reviewer; the check counts the lines itself.

## Quality gates

- **Tests first.** Every task with behavior starts with a failing test, seen failing.
- **`pnpm verify`** must be green: lint (warnings fail), typecheck, tests with coverage, config
  validation, generated-file check, and the workflow harness. `pnpm audit --prod` must show no new
  advisory.
- **Coverage** (spec 10.5, `vitest.config.ts`): `packages/core` 95% lines and branches;
  `packages/client` 85% lines and branches; `packages/api` 100% branches in `audit`,
  `credentials`, `dispatch` and `queries` (and `delegation` once it has code), 85% lines elsewhere.
- **Accessibility.** Every end-to-end scenario runs axe; serious or critical findings fail it. The
  key dispatcher flows (stories A1 and A4) are also tested keyboard-only.
- **Fixture policy** (spec 5.4, `packages/core/src/config/fixture-policy.ts`): mock data never looks
  like a real record. Plates are `ZZ-####`, VINs fail the ISO 3779 check digit, dates of birth are in
  1901, names are synthetic, addresses are on Example Ave.
- **No query data in logs** (spec 5.9): no secret, key, password, token or query value reaches a log
  line; tests capture the logs to prove it.
- **Story tags.** Each acceptance story in `docs/testing/stories.json` must have a tagged test.

## Phase gate docs refresh

Every phase gate refreshes the reader-facing docs, alongside its release note in
[docs/releases](docs/releases/):

1. Add the new release note to the table in [docs/overview.md](docs/overview.md) and describe what
   the phase built there; move those items off [docs/roadmap.md](docs/roadmap.md).
2. Update the dated "Where it stands" line in the [README](README.md) and the "Last refreshed" dates.
3. Check the changed claims against the code on `main`, and update
   [docs/architecture.md](docs/architecture.md), [docs/getting-started.md](docs/getting-started.md)
   and the reference docs where the phase changed them.
4. Run `pnpm verify`. `packages/api/test/docs-structure.test.ts` fails when a release note is not
   linked from the overview, a link or anchor is broken, a doc or docs folder is missing from the
   index, a package, app, scripts folder or root script is missing from the docs, or the mock-data
   statement is missing from the README, the overview or SECURITY.md; `packages/api/test/docs-reference.test.ts` does the same for the
   API and config references.

Milestone exits also refresh the product docs as a whole (spec 12.7, BR-005).

## Conventions

- American English in docs, UI copy, comments, commits, issues and pull requests. Code identifiers
  keep their current spelling until a change renames them on purpose.
- Dates in docs are MM-DD-YY; code and data use ISO dates. No em dashes in docs.
- Scripts that could ever run twice live in `scripts/` and are committed.
- Dependencies stay on the newest stable release, and a known advisory is never left standing.
- Mock data only. No fixture may look like a real person, vehicle or property record.
