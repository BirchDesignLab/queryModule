# queryModule

Query Module 2.0: usability and architecture enhancements to the Query Module
of a Computer-Aided Dispatch (CAD) suite. Users query external state and
national systems (crime information, records, databases) from CAD Dispatch,
CAD Mobile Unit and the CAD Mobile app. Full spec:
`Requirements Definition - Query Module Usability Enhancements.md`
(Appendix A is the phased prototype backlog; Appendix B the generic data model).

**The prototype uses a mock data source with canned responses.** It never
connects to real state or national systems and never holds real CJIS data.
Do not add fixtures that look like real person, vehicle or property records.

# Subagents and workflows: set model and effort on every dispatch

Every subagent dispatch (the Agent tool, Workflow `agent()` calls, the
implementer and reviewer roles in subagent-driven development) sets `model`
**and** `effort` on purpose. Never leave either unset: an unset agent inherits
the session's model at the session's effort, and an untiered fleet of those
has burned a month of usage in about ten minutes.

## The models

| Model | Relative cost | Effort levels | Capable of |
|---|---|---|---|
| Haiku 4.5 | 1x | None. The API rejects `effort` on Haiku; set `model` only and write `effort: n/a` in the plan so the choice reads as deliberate. | Fast, literal work: listing files, grep sweeps, pulling fields out of JSON or docs, summarizing one file, reformatting. **Not** for judging correctness, multi-file reasoning, or anything touching the sensitive code below. 200K context. |
| Sonnet 5 | 2x | `low` `medium` `high` `xhigh` `max` | Strong coder. Implements from a precise spec, writes tests, runs routine finders, verifies or refutes a claim against the code. |
| Opus 5.5 | 4x | `low` `medium` `high` `xhigh` `max`. Always thinks; effort is its only cost control. | Hardest reasoning: the sensitive code below, design, synthesis across many reports, whole-branch review. |

Relative cost is per token (API list prices: Haiku $1/$5, Sonnet 5 $2/$10,
Opus 5.5 $4/$20 per million in/out). Effort multiplies on top of it: higher
effort means more thinking and more tool calls per task.

**Fable is never a subagent model.** It costs more than twice Opus.

**Sensitive code in this repo** (the roles below name it). No code exists yet;
update the paths here as each area lands, and treat the area as sensitive from
its first commit:

- Credential handling: entry, storage, change and rotation of state-system
  credentials; delegated credentials (training officer acting for a trainee);
  anything that touches encryption at rest or in transit (SEC-001 to SEC-003,
  SEC-011).
- Audit logging: the query audit record (user, timestamp, query type, sources,
  ack and response times), audit of response deletion and of delegated-credential
  use. Audit rows are never deleted or rewritten (SEC-010 to SEC-013).
- Query dispatch: the request pipeline to external sources, source adapters
  (mock now, real later), per-source timeouts and nested queries, the
  acknowledgment and correlation ID (FR-040 to FR-044, FR-064, FR-065).
- Terminal command parser: command-string to query-type mapping, positional
  defaults, unrecognized-command handling (FR-050 to FR-055).
- Write-back: "Add to supplemental" and any other path that writes query
  results into a CAD or Records record (FR-061).
- Delete-from-view: soft delete only; the row stays in the database and the
  deletion is audited (FR-062, FR-063, SEC-013).
- The verify gate (lint, typecheck, tests) and the merge-to-`main` path.

Paths landed so far, by review tier (ADR-0007; kept in step with
`.github/sensitive-paths`, which also lists the globs reserved for areas that
have no code yet):

- Critical (Opus 5.5 `xhigh` artifact): audit logging
  `packages/core/src/contracts/audit.ts`, `primitives.ts`, `identity.ts`; query
  dispatch `packages/core/src/contracts/source-status.ts`, `ws.ts`; the
  sensitive-review gate itself `.github/sensitive-paths`,
  `scripts/ci/sensitive-review.ts`, `scripts/ci/check-sensitive-review.ts`;
  reserved: the audit-migration guard `scripts/ci/check-audit-migrations.ts`.
- Gate (Opus 5.5 `high` artifact): the verify gate and merge path
  `.github/**`, `scripts/ci/**`, `scripts/ops/**`, `**/biome.json`,
  `.gitignore`, `**/vitest.config.ts`, `package.json`, `pnpm-workspace.yaml`,
  `tsconfig.base.json`, `**/tsconfig.json`.
- Deps (automated checks only, no artifact): `pnpm-lock.yaml`, and a
  version-only change of an existing package (`package.json`) or action (the
  ref of an existing workflow `uses:` line). `.github/dependabot.yml` is gate.
- Exempt: `.github/ISSUE_TEMPLATE/**`, `.github/pull_request_template.md`.

This is CJIS and GDPR territory. There is no money path, but a mistake in
credential handling or audit logging is a compliance failure, not a bug.

## The effort levels (Sonnet 5 and Opus 5.5)

- `low`: little thinking, fewest and most consolidated tool calls, terse
  output. For work fully specified in the prompt that has one right answer.
- `medium`: normal thoroughness. For a routine task with a clear plan.
- `high`: thorough; weighs alternatives and edge cases. For work that needs
  judgment or unfamiliar code.
- `xhigh`: deep and long-running; Anthropic's recommended setting for long
  agentic coding, and Claude Code's own default. That is what an unset agent
  usually inherits, which is why "unset" is expensive.
- `max`: no ceiling on thinking. Only when correctness matters more than cost
  **and** `xhigh` measurably fell short. Never in a fleet.

## Every role, from Opus down

| Model | Effort | Use it for |
|---|---|---|
| Opus 5.5 | `max` | Only when the developer asks, or `xhigh` fell short on a correctness-critical question. One agent, never a fleet. |
| Opus 5.5 | `xhigh` | Whole-branch review of a PR that touches a critical-tier path (ADR-0007). Deep debugging across the query pipeline (field rules, source adapters, response mapping), the terminal parser and the audit trail. |
| Opus 5.5 | `high` | Hard finders, design and judge panels, whole-branch review of an ordinary PR or of a gate-tier PR (ADR-0007: CI, scripts, workflows, config; no critical path). Design questions from the spec's open-questions list (rule condition language, form/terminal value carry-over, scan auto-submit). |
| Opus 5.5 | `medium` | Implementing a critical-tier task from a plan (ruler and re-reviewer on it too). The critic role on a gate-tier or critical-tier task and on a UI-building workflow. Synthesizing several agents' reports into one answer. |
| Opus 5.5 | `low` | A narrow judgment call that needs Opus-grade reasoning but no exploration ("is this credential-storage change CJIS-safe, given these three lines"). |
| Sonnet 5 | `max` | Not used. Work that hard goes to Opus. |
| Sonnet 5 | `xhigh` | Rarely. A long unsupervised implementation that touches no sensitive code. If it is hard, use Opus instead. |
| Sonnet 5 | `high` | Implementation that needs judgment across several files; finders in unfamiliar code; code-quality review of one task; the combined spec and quality reviewer on an ordinary or gate-tier task (and the re-reviewer on a gate-tier task). |
| Sonnet 5 | `medium` | Implementing one ordinary or gate-tier plan task with its tests (TDD) in one to three files; routine finders over a bounded area; spec-compliance review of one critical-tier task against its FR/UX/SEC IDs. |
| Sonnet 5 | `low` | Verify or refute one claim against named files; a fully specified mechanical edit (a rename, one function to a given spec); run the suite and report. |
| Haiku 4.5 | n/a | Enumeration and extraction: list, grep, pull fields, summarize one file, pull requirement IDs out of the spec. |

## Rules

- Start at the cheapest model and effort that can do the job. On a failure, step up one
  notch at a time (the next row up the table), never straight to `max`.
- Volume is fine; tiering is the mandate. Do not shrink a fleet to save cost,
  tier it.
- Before launching a workflow, state the per-stage model and effort plan and
  the agent count.
- Keep an Opus critic on every workflow that builds UI or touches sensitive
  code. In a previous repo, Sonnet builders and verifiers passed regressions
  that only the Opus critic caught, twice in a row on the same component.
- Spec-compliance reviewers cite requirement IDs (FR-, UX-, SEC-) from the
  requirements doc, not paraphrases.
- Parallel subagents share one session scratchpad. Every agent in a fan-out
  gets its own scratch path in its prompt (`<scratchpad>/<runId>/<label>/`)
  and writes scratch only there. An agent that produces one file writes it
  straight to its final path. Agents that edit repo files in parallel get
  `isolation: 'worktree'` or explicitly disjoint file ownership; worktrees
  are cheap for git but cost a dependency install each, so reserve them for
  big parallel edits.

## Execution: workflows first, skills recommended

Plans run task by task through the saved workflow `.claude/workflows/sdd-task.js`, or a whole wave at once through `.claude/workflows/sdd-wave.js` (it nests `sdd-task` per task, carries flow forward, and it stops at the first task that does not complete), and each wave PR that touches sensitive paths through `.claude/workflows/wave-review.js` (ADR-0006). One PR per wave; the developer approves pushes and merges. Workflow `agent()` calls take `model` and `effort` directly, so every call sets both (Haiku: model only). The `.claude/agents/<model>-<effort>.md` definitions stay available through `agentType` and for the Agent tool.

Each task runs at the review tier of the highest `.github/sensitive-paths` tier it touches (`sdd-task` `tier`; README "Review tiers"):

| Task tier | Implementer | Review | Critic | Ruler |
|---|---|---|---|---|
| Ordinary (no sensitive path) | Sonnet `medium` | one combined spec and quality reviewer, Sonnet `high` | only for UI or `critic: true` | Opus `low` |
| Gate | Sonnet `medium` | one combined spec and quality reviewer, Sonnet `high` | Opus `medium` | Opus `low`, sensitive ruler rule |
| Critical | Opus `medium` | spec reviewer Sonnet `medium` and quality reviewer Sonnet `high` | Opus `medium` | Opus `medium`, sensitive ruler rule |

Controller rules for every workflow run:

- Freeze a PR's scope before its review starts. Nothing joins the PR after its review begins; later work goes in the next PR (PR #76 paid one more xhigh review for scope that grew mid-review).
- Never write to the repository tree while a workflow run is active: no edits, commits, checkouts or stashes until it returns (a mid-run edit on PR #76 cost one extra xhigh reviewer).

The superpowers skills (brainstorming, writing specs and plans, subagent-driven development, executing plans) are recommended, not required. The plugin's rule that a skill must be invoked before any response does not apply in this repo. TDD is required for every task with behaviour, whichever way the task runs.

## Scripts stay in the repo, not in temp

Founder direction 08-13-26, carried over from earlier repos.

**No scratchpad, no temp directories.** Anything worth running is worth keeping:
one-off scripts, migrations, backfills, mock-data generators, ops probes. They
go in `scripts/`, in a subfolder when there is a natural grouping
(`scripts/migrations/`, `scripts/mock-data/`, `scripts/ops/`), and they get
committed.

The reason is insurance. If a run goes wrong, or the same job comes back in six
months, the script and the reasoning behind it still exist. A script that lived
in `%TEMP%` is gone the moment it would have been useful.

**Scope: scripts.** Genuinely disposable working files are fine in a scratch
directory. Commit-message drafts, diff dumps, notes to self. The rule is about
executable work that could ever be run twice, not about every byte written.

## Git workflow

Branch and open a PR for review. Do not commit directly to `main`.

## Dependencies: newest stable and secure

Founder direction 08-04-26. The standing pattern is **newest stable, and no
sitting on known advisories**. Not bleeding edge, not frozen.
