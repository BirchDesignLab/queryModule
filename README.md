# Query Module 2.0

Configuration-driven query front end and API for a Computer-Aided Dispatch (CAD) suite. Users query external state and national systems from CAD Dispatch, CAD Mobile Unit, CAD Mobile and other host products; a host embeds the module or calls its versioned HTTP API directly.

The prototype uses mock data sources with canned, fictitious responses. It never connects to real state or national systems and holds no CJIS data.

## Status

Milestone M0, phase P0 (contracts), in progress.

- Wave 1 merged (PR #31): the workspace root and the first `packages/core` contracts.
- Workflow execution adopted (ADR-0006); W2 is next.

See `docs/superpowers/plans/STATUS.md` for the live grid; it is not duplicated here.

## Repository map

| Path | Role | State |
|---|---|---|
| `packages/core` | Pure domain logic and contracts (Zod) | Present: version, `ApiError`, `ValidationError`, identity, source status, the audit catalogue, WebSocket messages and primitives; config for features and shortcuts |
| `packages/client` | Framework-neutral client logic | Planned, Task 24 |
| `packages/tokens` | Design tokens, day, night and red-shift modes | Planned, Task 23 |
| `packages/web-ui` | React DOM primitives | Planned, Task 24 |
| `packages/config` | Shipped sites, locales, mocks, generated JSON Schema | Planned, Task 16 |
| `packages/api` | HTTP and WebSocket API | Planned, Track A M0 P1 |
| `apps/web` | Vite + React web app | Planned, Task 25 |
| `apps/host-simulator` | Embedded-mode test host | Placeholder until M4 |
| `apps/mobile` | Expo app | Planned, Task 26 (placeholder shell); Track D owns it from M4 |
| `deploy/` | Docker, compose, tunnel | Present: README only; Track A M0 P1 |
| `scripts/ops` | Committed ops scripts (`gh-create-p0-issues.sh`, `gh-setup-labels.sh`) | Present |
| `scripts/mock-data` | Fixture-policy mock generator | README present; `generate.ts` lands Track A M1 P3 |
| `scripts/sdd` | `task-brief.sh` for the SDD workflows | Present |
| `scripts/ci` | Contract generators, config validation, licence and story gates | Planned, Tasks 17 to 22 |
| `docs/` | Specs, plans, decisions, reviews | Present |
| `.claude/agents` | Model and effort role definitions for subagent dispatch | Present |
| `.claude/workflows` | `sdd-task.js`, `wave-review.js` | Present |

## Getting started

Full machine setup: `docs/superpowers/plans/2026-09-25-implementation-master-plan.md` section 9 (9.1 Linux, 9.2 Windows).

Minimal steps:

```
# Node 24 per .nvmrc (ADR-0001)
corepack enable
pnpm install --frozen-lockfile
```

pnpm 12 notes:

- `engineStrict: true` and `allowBuilds` live in `pnpm-workspace.yaml`, because pnpm 12 does not read `engine-strict` from `.npmrc` (`.npmrc` is kept anyway).
- esbuild's install script is denied (`allowBuilds: { esbuild: false }`); tsx does not need it.
- Installs may resolve one patch behind the newest publish, because of pnpm's release-age cooldown.

## Root scripts

| Script | Does | Available |
|---|---|---|
| `typecheck` | `tsc -b` | Now |
| `lint` | `biome ci --error-on-warnings .` | Now |
| `test` | `vitest run` | Now |
| `coverage` | `vitest run --coverage` | Now |
| `verify` | lint, typecheck, coverage, `config:validate`, `gen:check` | Now, but stops at `config:validate` until Task 18 lands that script's target |
| `contracts:gen`, `gen:check` | generate and check derived contract files | Task 17 |
| `config:validate`, `config:migrate` | validate and migrate `SiteConfig` files | Task 18 |
| `tokens:gen` | regenerate design tokens | Task 23 |
| `dev:web` | Vite dev server | Task 25 |
| `dev`, `dev:api`, `e2e`, `image:smoke` | full dev loop, API only, Playwright/axe, image smoke test | Track A M0 P1 |

Toolchain: Node 24, pnpm 12.6 through corepack, TypeScript 7, Vitest 5, Biome 2.5, zod 4 (`package.json`).

## How the work is organised

Docs map:

- Requirements: `Requirements Definition - Query Module Usability Enhancements.md`.
- Design spec v2: `docs/superpowers/specs/2026-09-25-query-module-2-design-v2.md`, the binding authority.
- Master plan: `docs/superpowers/plans/2026-09-25-implementation-master-plan.md` (tracks, phases, session protocol, definition of done).
- `docs/superpowers/plans/STATUS.md`: the live grid.
- Phase plans: `docs/superpowers/plans/`.
- ADRs: `docs/decisions/` (README there explains process). 0001 Node 24 LTS as the runtime. 0002 Replace Watchtower with a systemd pull timer. 0003 Audit partId in envelope and details. 0004 WebSocket close codes. 0005 Field key, type code and id formats. 0006 Run plans through Workflow scripts; superpowers skills recommended.
- Sensitive-review artifacts: `docs/reviews/pr-<n>.md` (currently `pr-31.md`).

Tracks (master plan section 2):

| Track | Machine | Owns |
|---|---|---|
| A platform | Linux laptop, also the deploy host | `packages/api`, `deploy/`, `.github/`, `scripts/ops`, `scripts/mock-data`, `scripts/ci`, `scripts/migrations` |
| B web | Windows 11, PowerShell | `apps/web`, `apps/host-simulator`, `packages/web-ui`, `packages/tokens`, `packages/client` |
| Core | either machine | `packages/core`, `packages/config/*`, contract files, `docs/testing/stories.json` |
| D mobile | Windows, from M4 | `apps/mobile`, `packages/rn-ui`, Maestro flows |

Process:

- One GitHub issue per task, with labels and milestones (master plan 5.2).
- One PR per wave; the developer reviews and merges.
- Contract-first after each P0 gate (master plan 8): a Zod schema, route, WS event, audit type or config schema change lands in its own `contract` PR before any consumer.

## Project management framework

Hierarchy, top down:

```
Milestone (M0 to M4, plus Later)
  > Phase (P0 to P3 inside a milestone grid)
    > Track cell (one phase plan file)
      > Wave (one PR, a run of consecutive tasks)
        > Task (one GitHub issue, one sdd-task workflow run)
          > Roles (the agents inside a run)
```

**Milestones.** M0 to M4, plus a Later bucket with no phase or milestone of its own (master plan 3.1, section 4). Each milestone is a GitHub milestone (names in 5.2) and is closed by a release tag `m<k>` through `promote.yml` after its exit gate; exit ownership is split in 4.6.

**Phases.** P0 to P3 inside each milestone grid; M0 and M1 share one grid (3.1). P0 is contracts, run by one owner session across all its cells (3.3). Tracks run concurrently, but a track's own phases run in order (3.2). Each phase row carries a Gate cell verified on `main`; phase plans are frozen at the gate with a `Frozen: MM-DD-YY` line (5.4).

**Tracks.** A platform (Linux laptop, also the deploy host), B web (Windows), Core (either machine), D mobile (Windows, from M4). Section 2 lists what each owns and never edits; 3.4 caps Track A at half a milestone ahead of Track B (the backend lead).

**Waves.** A wave is a run of consecutive tasks from one phase plan that lands as one PR. The developer reviews and merges every wave PR; the session only pushes (developer direction 09-26-26, ADR-0006). A wave touching sensitive paths gets one `wave-review` run and its artifact at `docs/reviews/pr-<n>.md`. The current P0 wave map is the `## Waves` section of `docs/superpowers/plans/2026-09-25-p0-contracts.md`; it is not copied here.

**Tasks.** One plan section with checkbox steps; one GitHub issue; TDD; run through `sdd-task`. The checkbox is ticked in the wave PR, and the issue closes through `Closes #n` in that PR (10.1 definition of done).

**Issues.** Labels `track-a`, `track-b`, `core`, `mobile`, `p0` to `p3`, `sensitive`, `contract`, `api-breaking`, created by `scripts/ops/gh-setup-labels.sh`. Every issue carries exactly one track label, one phase label and one milestone. Title format `<what> (<IDs>)`; body format, claim and close rules are in 5.2.

**Status and decisions.**

- `docs/superpowers/plans/STATUS.md`: the grid, Active sessions and Handoff notes (5.1).
- ADRs in `docs/decisions/` for any change to spec v2 or a choice it left open (5.3).
- Balloon guard: no new tracking file without retiring one (5.4).

**Sessions.** Start, claim, build, ship and close-out protocol (master plan section 6); pause and resume with the seven-line handoff note (section 7). One session per track at a time.

**Workflows.** `sdd-task` runs one task; `wave-review` runs the whole-branch review for a sensitive wave. See "Running tasks with workflows" below.

**Project board.** The developer maintains a GitHub Projects board for the repository. <!-- BOARD-DETAILS: URL, views, fields and automation to be filled in --> Issues and PRs are the source of truth; the board is a view over them.

## Running tasks with workflows (ADR-0006)

- `.claude/workflows/sdd-task.js` runs one plan task: implementer, spec and quality reviewers (plus an Opus critic on sensitive or UI tasks), a ruler, a capped fix loop with escalation, and an independent gate role (`pnpm lint`, `pnpm typecheck`, `pnpm test`, head and clean tree) before a task counts as complete. A red gate sends its problems back through the fix loop.
- Rulings bind the rest of the run: reviewers, fixers and re-reviewers see every ruling in force, a finding that contradicts one goes back to the ruler, and fixers never reverse one.
- On sensitive tasks, and always in `wave-review`, the ruler must escalate any ruling that would weaken a security, audit, credential, delegation or dispatch invariant, change a shape frozen at a phase gate or listed as a contract file (master plan 8.2), or keep a Critical finding with stands.
- A stopped run is answered, not redone: re-run with the same args (`carries` unchanged), `resumeFromRunId`, and `answers: { at: <the returned stopped value>, text }`. Earlier agent calls replay from cache; after an implementer stop, a continue implementer finishes on top of the existing commits.
- `.claude/workflows/wave-review.js` runs the Opus xhigh whole-branch review for a wave PR that touches sensitive paths, one ruled fix pass and one re-review, and writes `docs/reviews/pr-<n>.md` on approve.
- `bash scripts/sdd/task-brief.sh PLAN N OUT` extracts one task's brief from a plan; `node scripts/sdd/workflow-harness.mjs` tests both scripts against mocked agents.
- Every agent call sets model and effort explicitly, per the `CLAUDE.md` tiering; any model and effort suited to a role may be chosen.
- The superpowers skills (brainstorming, specs, plans, subagent-driven development) are recommended, not required.
- TDD is required for every task.
- Arguments, roles and defaults, return shapes and the controller procedure: `.claude/workflows/README.md`.

## Quality gates

- TDD: a failing test first, seen failing.
- Coverage thresholds (spec 10.5, `vitest.config.ts`): `packages/core` 95% lines and branches; `packages/client` 85% lines and branches; `packages/api` 100% branches on `audit`, `credentials`, `delegation` and `dispatch`; `packages/api` 85% lines on the rest.
- Lint fails on warnings (`biome ci --error-on-warnings`).
- Sensitive areas (the list in `CLAUDE.md`) need an Opus 5.5 xhigh whole-branch review, recorded in `docs/reviews/pr-<n>.md`. The CI check `sensitive-review` lands in Tasks 21 and 22.
- Fixture policy (spec 5.4): plates `ZZ-####`, VINs failing the ISO 3779 check digit, DOBs in 1901, synthetic names, addresses on Example Ave.
- No query data in logs (spec 5.9).

## Conventions

- Dates MM-DD-YY in docs, ISO in code and data.
- No em dashes in docs.
- Scripts live in the repo under `scripts/` and are committed.
- Newest stable dependencies, with no sitting on known advisories.
- Contracts are additive-only after the gate.

## Provenance

Most code in this repository is written by AI agents (Claude Code) under a solo developer's direction, with Opus review on sensitive areas. An independent human security review is required before handoff (spec 14).
