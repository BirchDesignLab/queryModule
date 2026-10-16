# Query Module 2.0

A configuration-driven query front end and API for a Computer-Aided Dispatch (CAD) suite.
Dispatchers, records staff and mobile units build a query from a form or a command terminal, and
see each source's answer as a result card inside the request. A site changes its forms, rules,
commands and result cards from an admin console, without a code change or a rebuild.

> This runs on mock data only and is not connected to real state or national systems. It is still
> built to the standard a real connection and use would demand: encrypted credentials, a complete
> audit trail, and security controls rooted directly in CJIS rules.

[![ci](https://img.shields.io/github/actions/workflow/status/BirchDesignLab/queryModule/ci.yml?branch=main&label=ci)](https://github.com/BirchDesignLab/queryModule/actions/workflows/ci.yml)
[![Project board](https://img.shields.io/badge/board-Query_Module_2.0-3E4B9E?logo=github)](https://github.com/users/BirchDesignLab/projects/1)
[![Open PRs](https://img.shields.io/github/issues-pr/BirchDesignLab/queryModule?label=open%20PRs)](https://github.com/BirchDesignLab/queryModule/pulls)

## Where it stands (10-16-26)

| | |
|---|---|
| Built | M0 skeleton; M1 forms, terminal and admin console; M2 P0.5 dispatch to the mock sources with live per-source status; M2 P1 result cards, keyword severity and replay |
| Next | M2 P0 last contract wave, M2 P2 audit viewer, M2 P3 hardening |
| Planned | M3 credentials, MFA, multi-source and delegation; M4 mobile layouts, native app and host-page embedding |

What each milestone delivered: [overview](docs/overview.md). What is planned and not built:
[roadmap](docs/roadmap.md). A live demo runs the latest promoted build with demo accounts
([demo guide](docs/demo.md)).

## Quick start

Needs Node 24 (24.15 or newer) and corepack.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Setup on Windows and Linux, the root scripts and the end-to-end tests:
[getting started](docs/getting-started.md).

## Documentation

| Read this | For |
|---|---|
| [Documentation index](docs/README.md) | Every document, by reader |
| [Overview](docs/overview.md) and [roadmap](docs/roadmap.md) | What exists today and what is planned |
| [Getting started](docs/getting-started.md) | Setup, local run, root scripts, tests |
| [Architecture](docs/architecture.md) | Packages, apps, data flow, repository map |
| [Demo guide](docs/demo.md) | Demo accounts and demo stories |
| [Site configuration](docs/site-config.md) | Changing a site's forms, rules, commands and cards |
| [API reference](docs/api.md) | The HTTP and WebSocket contract |
| [Deploying](docs/deploy.md) | The single-node Docker host |
| [Contributing](CONTRIBUTING.md) | How the work is planned, built and reviewed |
| [Security](SECURITY.md) | The security model and how to report a problem |

## License and provenance

Copyright Birch Design Lab. All rights reserved; see [LICENSE](LICENSE). Third-party components
are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Most code here is written by AI agents (Claude Code) under one developer's direction, with Opus
review on the sensitive areas. An independent human security review is required before any use
beyond this demo (spec 14).
