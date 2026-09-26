---
date: 09-26-26
status: accepted
track: all
phase: m0-p0
supersedes: ["spec 10.1"]
---

# 0006 Run plans through Workflow scripts; superpowers skills recommended

## Context

The plans run to four milestones. P0 alone has 28 tasks.

Hand-dispatched subagent-driven development put a developer "go" before every task and a controller turn around every agent. W1 (6 tasks) took about 27 agent runs and about 82 minutes of agent time, but most of a day of wall clock.

The Agent tool has no effort setting, which is why `.claude/agents/<model>-<effort>.md` definitions were written.

The superpowers plugin injects a rule that a skill must be invoked before any response. Its subagent-driven-development defaults clashed with this project's rules: no pause between tasks, versus the developer approving each task; a single combined reviewer, versus the plan's separate spec and quality reviewers.

## Options

1. Keep hand-dispatched subagent-driven development.
2. One workflow for a whole phase, written up front.
3. A saved per-task workflow (`sdd-task`) plus a per-wave sensitive review workflow (`wave-review`), with the developer's gates at the PR.

## Decision

Option 3.

- One PR per wave; the developer approves pushes and merges.
- Workflow `agent()` calls set `model` and `effort` per role. Defaults follow the `CLAUDE.md` tiering, and the controller may choose any model and effort suited to the role and task.
- The superpowers skills (brainstorming, writing specs and plans, subagent-driven development, executing plans) are recommended, not required.
- TDD stays mandatory.
- "Role" replaces "seat" in process docs.

## Consequences

- The plan headers recommend `sdd-task`.
- Spec 10.1's "TDD for every task, per the superpowers workflow" now means TDD for every task, whichever way the task runs.
- `CLAUDE.md` is updated.
- The `.claude/agents` definitions stay usable through `agentType` and for the Agent tool.
- The P0 SDD ledger continues as the P0 decision record.
- Pilot on W2 (Tasks 7 to 11) and compare wall clock, usage and escalations with W1; revisit after the pilot.
