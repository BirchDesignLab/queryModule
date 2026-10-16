# Documentation index

Every document in this repository, grouped by who reads it. Start with the [README](../README.md).

This runs on mock data only and is not connected to real state or national systems. It is still
built to the standard a real connection and use would demand: encryption in transit and at rest, a
complete audit trail, and security controls rooted directly in CJIS rules. Encrypted storage for
state-system credentials comes in M3.

## Start here

| Document | What it covers |
|---|---|
| [Overview](overview.md) | What the module is and what exists today, by milestone |
| [Roadmap](roadmap.md) | What is planned and not built |
| [Architecture](architecture.md) | Packages, apps, data flow and the repository map |
| [Getting started](getting-started.md) | Machine setup, running locally, root scripts, tests |

## Using and configuring the module

| Document | What it covers |
|---|---|
| [Site configuration](site-config.md) | The site config document: query types, fields, rules, commands, sources, result cards, themes, mock files, the admin builder |
| [API reference](api.md) | The HTTP and WebSocket contract under `/api/v1`; [`openapi.json`](../packages/api/openapi.json) is the source of truth |
| [Demo guide](demo.md) | Demo accounts, demo stories, the demo seed and runbook |
| [Demo: M1 runbook](demo/) | The M1 demo runbook, kept as the M1 record |
| [Deploying](deploy.md) | The single-node Docker host, secrets, release and rollback, backups, runbooks |

## Working on the code

| Document | What it covers |
|---|---|
| [Contributing](../CONTRIBUTING.md) | How work is planned, built, reviewed and merged; quality gates; conventions |
| [Security](../SECURITY.md) | The security model, built and planned, and how to report a problem |
| [Project board](project-board.md) | The GitHub Project: hierarchy, fields, labels, automation and manual steps |
| [Workflows](../.claude/workflows/README.md) | The saved workflow scripts that run plan tasks and reviews |
| [Agent instructions](../CLAUDE.md) | The instructions every AI agent in this repository follows, including the review tiers and sensitive paths |

## Records

Records are kept as written. They are history, not current documentation: where a record and the
code disagree, the code and the newest decision record win.

| Folder or file | What it holds |
|---|---|
| [Requirements definition](../Requirements%20Definition%20-%20Query%20Module%20Usability%20Enhancements.md) | The product requirements and their IDs (BR, FR, UX, SEC, NFR, PLT) |
| [superpowers/specs](superpowers/specs/) | The design spec (v2 is binding; v1, the review and its decisions are history) |
| [superpowers/plans](superpowers/plans/) | The implementation master plan, one plan per phase and track, and [STATUS.md](superpowers/plans/STATUS.md), the live phase grid |
| [decisions](decisions/) | Architecture decision records (ADRs); each changes the spec or settles a choice it left open |
| [releases](releases/) | One release note per milestone exit and per promoted phase |
| [reviews](reviews/) | Review artifacts for pull requests that touch sensitive paths |
| [design](design/) | The visual system and design notes |
| [briefs](briefs/) | The design brief (HTML source, PDF, screenshots) |
| [retros](retros/) | Retrospectives on the process |
| [board](board/) | `board-data.json`, the project board's data (read by `scripts/ops/gh-setup-project.mjs`) |
| [testing](testing/) | `stories.json`, the map from story IDs to their tests (read by CI) |

The folder name `superpowers` comes from the planning tool that wrote the first specs and plans.
Scripts read files in it, so it keeps its name.
