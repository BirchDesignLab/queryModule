## 1 Purpose

Build the Query Module as a standalone add-on: a configuration-driven query front end with its own API, deployable into CAD Dispatch, CAD Mobile Unit, CAD Mobile, CAD Records (including Records-only customers) and Mobile Field Reporting. A host CAD product of unknown stack integrates in one of two ways: it embeds the module (web iframe plus a versioned postMessage protocol, or the React Native library for native hosts) and hands it the host's logged-in user, or it calls the versioned HTTP API directly. A standalone demo app with its own login shows the module without a host. The code is intended to become the foundation of the real Query Module 2.0 and doubles as a portfolio piece handed to a real company.

The prototype uses mock data sources with canned responses. It never connects to real state or national systems and never holds real CJIS data. Fixtures follow the fixture policy in 5.4 and must not resemble real person, vehicle or property records.

Covers BR-002, PLT-006.

## 2 Constraints

- Form factors, phased: web form factors (dispatch on a desktop browser, mobile unit on a vehicle laptop browser, records on a desktop browser) from M1; native (mobile, smartphone) by M4. Each milestone ends live on the URL with the form factors it has reached (see 12).
- Mobile unit hardware is Toughbook class: low resolution (1024x768 and 1366x768 first, 800x600 must still work with scrolling), touch with gloves, sunlight, intermittent connectivity (see 6.3, 6.8).
- Dispatch is keyboard-first. Every Phase 1 flow is completable without a mouse, through single-key, modifier and chord shortcuts scoped by context (see 6.4). The keyboard model applies to every web persona.
- Configuration-driven (BR-001): a site-specific developer (imaginary, non-core) sets up, extends and customises through JSON config, locales and mock files supplied by volume, declarative formats, and the adapter plugin directory. One image serves every site; no site edits core code or rebuilds the image (see 4.1, 7).
- UI fully tokenized (colour, spacing, type, radius, motion) in `packages/tokens`, with day, night and red-shift modes. Every mode meets the contrast targets below (see 6.5).
- Accessibility target: WCAG 2.2 AA for every web persona; platform accessibility guidelines (Apple and Android) for native. Mobile-unit body text contrast is 7:1 in every mode; WCAG AA contrast elsewhere. Automated axe checks run in CI from M1; screen-reader passes are milestone exits (see 10, 12).
- Compliance posture: aimed at the CJIS Security Policy control areas, GDPR and the EU Cyber Resilience Act, without certification. The prototype holds no CJIS data; certification belongs to the company that adopts the code. Dispositions for SEC-020, SEC-021 and SEC-022 are in 11.
- TypeScript everywhere, strict. TDD. Trunk-based: short-lived branches, one PR each, a ruleset on `main` requiring a PR and the `sensitive-review` status check (see 9). Unfinished capabilities merge dark behind `SiteConfig.features` (see 4.1). Dependabot, newest stable, no sitting on known advisories.
- Deployed to one shareable URL, `querymodule.birchdesignlab.com`, through a Cloudflare Tunnel (sole ingress; the app port is not published) to a Docker host on a home Linux laptop. In standalone mode an in-app login gates it; the URL itself is open (see 8).
- Single node is a hard limit: one process, one SQLite file, in-process dispatch and event bus. No replica or database swap is designed for (see 5.5, 14).
- Solo developer plus agents, subagent tiering per `CLAUDE.md`. Two build machines: API work on Linux, web work on Windows (the tracks in 12).

Business requirement dispositions:

| ID | Disposition |
|---|---|
| BR-003 | No new licensing model. The module ships under the host product's existing licence: no licence keys, metering or per-seat checks in code. |
| BR-004 | Each milestone release tag gets `docs/releases/<tag>.md`, generated from `pnpm config:validate --diff` (config changes a site must make) plus upgrade notes, written before the tag is promoted (see 7, 9). |
| BR-005 | Product docs (`docs/`) are reviewed and refreshed at every milestone exit; the exit checklist in 12 includes it. |
| BR-006 | CI runs a licence check against an allowlist (MIT, BSD, Apache-2.0, ISC); any other licence fails the build until reviewed and added with a recorded reason (see 9). Applies to later OCR, barcode and voice libraries too. |

Non-goals for this design: real source adapters (the plugin API in 5.4 is in scope; real implementations are not); Shared Platform integration and service principals for Shared Platform consumers (PLT-001 to PLT-005 stubbed behind the seam interfaces in 5.5); horizontal scale-out; response aggregation spike (FR-045); voice (FR-075); OCR and barcode (FR-072 to FR-074, Phase 3, designed later); MFA beyond TOTP; credential key rotation (a `key_version` column is recorded, no rotation procedure is built); an audit hash chain (deferred, see 11); offline queueing of submits (NFR-003 is partially met, see 6.8); formal CJIS, GDPR or EU CRA certification.

Covers BR-001, BR-003, BR-004, BR-005, BR-006, UX-001.

## 3 Architecture

pnpm workspace monorepo, TypeScript strict, Node 22 LTS.

| Path | Role | Runtime deps |
|---|---|---|
| `packages/core` | Domain logic, pure functions, no IO. Config schema and `validateSiteConfig`, condition language, rules engine, terminal tokenizer, parser and formatter, response mapper, `assessResult`, keyword highlighter, query planner, and the shared contracts (audit event types, WebSocket event schemas, API error shape, version constants). Used by every client and by the API. | `zod` |
| `packages/client` | Framework-neutral client logic shared by web and native: API client generated from OpenAPI, WebSocket client with replay cursor and seq high-water mark, Zustand stores (draft as user values, panel state), TanStack Query hooks, selectors, reset on logout, 401 or user change. No persistent storage of query data. Tests live here. | `core`, `zustand`, `@tanstack/react-query`, `openapi-fetch` [open]; peer `react` |
| `packages/tokens` | Design tokens (colour, spacing, type, radius, motion) per mode (day, night, red-shift). Builds CSS variables for web and a theme object for React Native. Site overrides come from `SiteConfig.theme`. Contrast pairs checked per mode. | none |
| `packages/web-ui` | React DOM primitives on native HTML elements (field renderer, listbox, table with headers, disclosure buttons, announcer, shortcut engine binding). Consumed by `apps/web`. | `core`, `client`, `tokens`; peer `react`, `react-dom` |
| `packages/rn-ui` (M4) | React Native component library: the embeddable module for a native host such as CAD Mobile, with role and state props set on every control. `apps/mobile` is its demo shell. | `core`, `client`, `tokens`; peer `react`, `react-native` |
| `packages/config` | Default site and the `example-ok.json` overlay site, mock files `mock/<siteId>.json`, locale files, generated JSON Schema. Fixture-free site configs. In deployment the same layout is supplied by volume (see 5.8). | none |
| `packages/api` | HTTP and WebSocket server under `/api/v1`. Persistence, auth (standalone and embedded), credentials and delegation, dispatch, built-in mock adapter plus adapters loaded from `ADAPTER_DIR`, audit, config loading, event log. Serves the web build. | `core`, `hono`, `@hono/node-server`, `drizzle-orm`, `@libsql/client`, `better-auth`, `ws`, `jose` [open] |
| `apps/web` | Vite + React DOM app for dispatch, mobile unit and records personas, in both modes. Includes the host-simulator page. | `client`, `web-ui`, `tokens`, `core`, `react`, `react-dom`, `react-router` [open] |
| `apps/mobile` (M4) | Expo app for the mobile persona: demo shell around `rn-ui`, standalone mode only. Expo Go for development. | Expo, `expo-router`, `expo-secure-store`, `react-native`, `rn-ui`, `client`, `tokens` |
| `deploy/` | Dockerfile, compose file, cloudflared and Watchtower config, `.env.example`, secret file templates. | |
| `scripts/` | Committed one-off and ops scripts: `scripts/ops/` (backup, smoke, purge, grant-role, lost-key), `scripts/mock-data/` (fixture generator), `scripts/migrations/`. | |
| `docs/` | Site-developer docs, API reference, embedding guide, threat model, release notes (`docs/releases/`), specs and plans. | |

Core is shared by every client and the API, so the same rules engine that drives the form also guards the API. Clients read `GET /api/v1/meta` and refuse to run below `minClientVersion` (see 5.1).

### 3.1 Modes

Mode is set per deployment in deploy config.

- **Standalone.** The demo app. Better Auth email and password login (see 5.6). Web at `/`, native through `apps/mobile`. Persona from the device heuristic and user override (see 6.1).
- **Embedded.** A host page frames the web module in an iframe and talks to it over postMessage protocol v1 (host to module: identity token, persona, context such as incident id; module to host: ready, resize, resultSelected, writeBackRequest reserved for FR-061). The API's `IdentityService` validates the host JWT (issuer, audience, JWKS URL from deploy config) and maps its subject to a local principal with no password; roles come from a claims map in site config. `frame-ancestors` and CORS allowlists come from deploy config. Audit rows carry `identity_source` and the host subject. Persona comes from host context first. A native host embeds `packages/rn-ui` instead of the iframe. The host-simulator page in `apps/web` issues test JWTs and frames the module; Playwright and the demo both use it (see 6.9).

Both modes share one API, one database schema and one audit trail.

### 3.2 Data flow for one query

1. The client holds the draft as user values in the `packages/client` store; the terminal is a derived view of it. Core `evaluateForm` recomputes `FormState` on every change.
2. Submit sends `POST /api/v1/queries` with an `Idempotency-Key`, the `X-Requested-With` header, the client's `configHash`, query type, user values and selected source ids. Submit stays disabled until the 202 settles; a retry reuses the key.
3. The API authenticates, applies the query policy function, rejects a stale `configHash` with 409 and a repeated key with the original 202. Core canonicalises values, runs `evaluateForm` (recomputing mode; a mismatch is 400) and `planRequest`. The plan has parts: `part_id` 0 is the primary, 1..n are nested children (one level only). A nested part whose own evaluation fails becomes `skipped` with a reason. Persisted and dispatched values are built only from visible effective values; unknown keys are 400.
4. One transaction: insert `query_request` once (correlation ID is a UUIDv7; values encrypted under a per-request key), insert one `pending` `source_result` per (part, source) with a `result_id` and the credential snapshot (`credential_user_id`, `delegation_id`) resolved now, audit `submitted` per part, `partSkipped` per skipped part and `acknowledged`. Commit, then return 202 `{ correlationId, acknowledgedAt }`. The ack toast comes from the 202 alone.
5. The dispatcher runs the sources of each part in parallel within per-source and global caps. It owns each deadline (clock from `acknowledged_at`, `timeoutMs` per source), audits `sourceDispatched`, and never retries. Each outcome writes the `source_result` status once from `pending` (plus payload and `adapter_kind`), audit `sourceResponded` and an `event_log` row in one transaction; after commit the `EventBus` pushes a `sourceStatus` event.
6. Events are reference-only (correlation ID, part id, source id, status, user seq). The client dedups by seq high-water mark, fetches the payload with an authorized `GET`, and renders it through core `mapResponse`, `assessResult` and `highlight`. On reconnect it replays missed events from its cursor or, past the replay cap, receives `resync` and refetches (see 5.3, 6.8).
7. On restart, a startup sweep marks every remaining `pending` row `interrupted`, audits and pushes it; nothing is re-dispatched. On SIGTERM the API stops accepting submits and drains in-flight sources.

Correlation ID and part id together key every result, hide and event, so a nested part that hits the same source as its parent stays distinct (see 5.2, 5.5).

Covers FR-040, FR-041, FR-042, FR-043, FR-044, FR-064, NFR-002, NFR-003.

## Writer notes (remove at assembly)

(a) [open] tags
- `packages/client` uses `openapi-fetch` for the generated API client; simplest typed client over the committed `openapi.json`.
- `packages/api` uses `jose` for host JWT and JWKS validation in embedded mode.
- `apps/web` uses `react-router` for routing (login, panel, credentials, admin audit, host simulator); Expo keeps `expo-router`.

(b) Assumptions about other sections
- 5.1: routes `/api/v1/queries` (POST with `Idempotency-Key`), `GET /api/v1/queries/:correlationId`, `GET /api/v1/meta` with `minClientVersion`.
- 5.2: `planRequest` part model with `part_id` 0 primary, `skipped` parts audited as `partSkipped`; statuses `pending`, `returned`, `failed`, `timedOut`, `credentialsMissing`, `credentialsRejected`, `interrupted`.
- 5.5: table names `query_request`, `source_result` (`result_id`, `part_id`, `credential_user_id`, `delegation_id`, `adapter_kind`), `event_log`, `request_key`; seam interfaces `IdentityService`, `EventBus`, `AuditService`, `EntityStore`. The NFR-002 volume ceiling number is stated in 5.5 (I cite single node as a hard limit but give no number).
- 5.4: fixture policy lives there; `ADAPTER_DIR` plugin loading.
- 6.9: embedded-mode detail and the host-simulator route path.
- 8: mode selection lives in deploy config (env var or deploy file), name not fixed here.
- 11: SEC-020/021/022 rows and the audit hash-chain deferral.
- 12: milestone exit checklist includes the BR-005 docs refresh and records which form factors each milestone reaches; tracks named Linux (API) and Windows (web).
- The `records` persona is web-only and ships from M1 alongside dispatch and mobile unit; 6.1 and 12 should agree.

(c) Decision lines not placed here
- c116 "NFR-002 ceiling stated": no number in the decisions log; left to 5.5 and referenced.
- c125 risks belong to 14; 2 only states the solo-developer constraint.
- c115 details (no-store, reset rules, SecureStore, no service worker) are named in the `packages/client` row and left to 5.9 and 6.7.
