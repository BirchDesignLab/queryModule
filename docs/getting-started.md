# Getting started

How to set up a machine, run the app locally, and run the checks. The app runs on mock data only;
nothing here connects to a real state or national system.

## Prerequisites

- Node 24, version 24.15 or newer within 24.x (`engines` in the root `package.json`; `.nvmrc` says
  `24` so CI takes the newest 24 release; ADR-0001).
- pnpm 12.6 through corepack (`packageManager` in `package.json`).
- Git. On Windows, put Git's `bin` folder first on `PATH` so the shell scripts the tests call run
  under Git Bash.
- Docker, only for `pnpm image:smoke` and the deploy files.

Full machine setup, step by step, is section 9 of the
[implementation master plan](superpowers/plans/2026-09-25-implementation-master-plan.md)
(9.1 Linux, 9.2 Windows 11).

## Install

```bash
corepack enable
pnpm install --frozen-lockfile
```

pnpm 12 notes:

- `engineStrict: true` and `allowBuilds` live in `pnpm-workspace.yaml`, because pnpm 12 does not
  read `engine-strict` from `.npmrc` (`.npmrc` keeps it anyway).
- Install scripts are denied for esbuild and msw (`allowBuilds`); neither is needed.
- An install may resolve one patch behind the newest publish, because of pnpm's release-age
  cooldown.

## Run it locally

```bash
pnpm dev
```

`pnpm dev` (`scripts/dev/dev.ts`) creates local secrets in `.dev/secrets` on first run, starts the
API on port 3000 with the mock sources allowed, and starts the Vite dev server on
http://localhost:5173, which proxies `/api` to the API. On the first run it seeds the demo accounts
(`scripts/ops/seed.ts`) and prints each account's password once in the terminal; keep them. The
accounts and the demo stories are in the [demo guide](demo.md).

`pnpm dev:api` starts the API alone; `pnpm dev:web` starts the Vite dev server alone.

## Root scripts

| Script | Does |
|---|---|
| `typecheck` | `tsc -b` over the workspace |
| `lint` | `biome ci --error-on-warnings .` |
| `test` | `vitest run` (every package, app and the scripts project) |
| `coverage` | `vitest run --coverage`, with the thresholds in `vitest.config.ts` |
| `verify` | `lint`, `typecheck`, `coverage`, `config:validate`, `gen:check`, `sdd:harness`, in that order |
| `contracts:gen` | Regenerates `packages/api/openapi.json` and the WebSocket and site config JSON Schemas from the contracts in `packages/core` |
| `client:gen` | Regenerates the OpenAPI types (`openapi-types.ts`) in `packages/client` |
| `tokens:gen` | Regenerates the design-token CSS in `packages/tokens` |
| `gen:check` | Runs the generators, then fails if any generated file differs from the committed copy |
| `config:validate` | Validates the site config files (see [site configuration](site-config.md)) |
| `config:migrate` | Migrates a site config file to the current schema version |
| `sdd:harness` | Tests the saved workflow scripts in `.claude/workflows` against mocked agents |
| `dev` | API and web dev servers together, with a first-run seed |
| `dev:api` | API dev server only |
| `dev:web` | Vite dev server only |
| `e2e` | Playwright end-to-end tests with axe accessibility checks, against a production build |
| `image:smoke` | Builds the Docker image, boots it on a fresh volume, runs the ops checks, then stops it |

`pnpm verify` is the gate every change must pass before review. On Windows, run it with Git's
`bin` first on `PATH`. If a laptop runs short of memory during the tests, set Vitest's own
`VITEST_MAX_WORKERS` variable (for example `VITEST_MAX_WORKERS=3`).

## End-to-end tests

`pnpm e2e` (`scripts/dev/e2e.ts`) builds the app, serves the production build on port 3000 and runs
Playwright. Set `E2E_PORT` (an integer from 1 to 65535, for example `E2E_PORT=3100 pnpm e2e`) to run
it beside another server on 3000.

It signs in as the seeded smoke user. When `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` are both unset,
it derives them from `.dev/secrets/SEED_PASSWORD_SECRET`, the way CI does, without printing them. Set
both to override; setting only one is an error.

`node scripts/dev/smoke-local.ts` runs the deploy smoke test (`scripts/ops/smoke.sh`) against a
local production build.

## Toolchain

Node 24, pnpm 12.6, TypeScript 7 (`packages/client` still pins 6.0.3), Vitest 5, Biome 2.5, zod 4.
Exact versions are in the `package.json` files and `pnpm-lock.yaml`. Dependencies follow the newest
stable release, and a known advisory is never left standing.

## Next

- [Architecture](architecture.md): how the packages fit together.
- [Contributing](../CONTRIBUTING.md): how a change is planned, built, reviewed and merged.
