# Query Module 2.0

Configuration-driven query front end and API for a CAD suite. Design: `docs/superpowers/specs/2026-09-25-query-module-2-design-v2.md`. Process: `docs/superpowers/plans/2026-09-25-implementation-master-plan.md`. Current work: `docs/superpowers/plans/STATUS.md`.

The prototype uses mock data sources with canned, fictitious responses. It never connects to real state or national systems and holds no CJIS data.

## Workspace

| Path | Role |
|---|---|
| `packages/core` | Pure domain logic and contracts (Zod) |
| `packages/client` | Framework-neutral client logic |
| `packages/tokens` | Design tokens, day, night and red-shift modes |
| `packages/web-ui` | React DOM primitives |
| `packages/config` | Shipped sites, locales, mocks, generated JSON Schema |
| `packages/api` | HTTP and WebSocket API (from M0 P1) |
| `apps/web` | Vite + React web app |
| `apps/host-simulator` | Embedded-mode test host (from M4) |
| `apps/mobile` | Expo app (placeholder until M4) |
| `deploy/` | Docker, compose, tunnel (from M0 P1) |
| `scripts/` | Committed CI, ops and mock-data scripts |

## Root scripts

Node 24 (`.nvmrc`), pnpm through corepack.

- `pnpm install --frozen-lockfile`
- `pnpm verify`: biome, `tsc -b`, Vitest with coverage, `config:validate`, generated-file drift check
- `pnpm contracts:gen`, `pnpm tokens:gen`: regenerate derived files
- `pnpm config:validate [file...] [--resolved]`, `pnpm config:migrate <file>`
- `pnpm dev:web`

## Provenance

Most code in this repository is written by AI agents (Claude Code) under a solo developer's direction, with Opus review on sensitive areas. An independent human security review is required before handoff (spec 14).
