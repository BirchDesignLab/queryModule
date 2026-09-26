# Query Module 2.0 Design

Date: 09-25-26
Status: approved in brainstorming, pending adversarial review
Source: `Requirements Definition - Query Module Usability Enhancements.md` (the spec). Requirement IDs (BR, FR, UX, SEC, NFR, PLT) refer to its Project Specifications table.

## 1. Purpose

Build the Query Module as a standalone add-on: a configuration-driven query front end for CAD Dispatch, CAD Mobile Unit and CAD Mobile, with its own API, so a host CAD suite of unknown stack can integrate over HTTP and a JSON config format. The code is intended to become the foundation of the real Query Module 2.0 and doubles as a portfolio piece handed to a real company.

The prototype uses mock data sources with canned responses. It never connects to real state or national systems and never holds real CJIS data. Fixtures must not resemble real person, vehicle or property records.

## 2. Constraints

- Three form factors from the first working version: desktop browser (dispatch), vehicle laptop browser (mobile unit), smartphone native (mobile).
- Mobile unit hardware is Toughbook class: low resolution (1024x768 and 1366x768 first, 800x600 must still work with scrolling), touch with gloves, sunlight, intermittent connectivity.
- Dispatch is keyboard-first. Every Phase 1 flow must be completable without a mouse.
- Site-specific developers (imaginary, non-core) must be able to set up, extend and customize through JSON config and documented extension points, not by editing core code (BR-001).
- TypeScript everywhere. TDD. Trunk-based development. Dependabot. Simple CI.
- Deployed to one shareable URL, `querymodule.birchdesignlab.com`, through a Cloudflare Tunnel to a Docker host on a home Linux laptop. In-app login gates it; the URL itself is open.
- Solo developer plus agents. Subagent tiering per `CLAUDE.md`.

Non-goals for this design: real source adapters, Shared Platform integration (PLT-001 to PLT-008; stubbed behind interfaces), response aggregation spike (FR-045), voice (FR-075), OCR and barcode (FR-072 to FR-074, Phase 3, designed later), MFA beyond TOTP, key rotation for credential encryption, offline queueing of submits (NFR-003 is partially met; see 6.6).

## 3. Architecture

pnpm workspace monorepo, TypeScript strict, Node 22 LTS.

| Path | Role | Runtime deps |
|---|---|---|
| `packages/core` | Domain logic. Config schema, rules engine, terminal parser and formatter, response mapper, keyword highlighter, query planner. Pure functions, no IO. | `zod` only |
| `packages/api` | HTTP and WebSocket server. Persistence, auth, credentials, mock sources, audit, config loading. Serves the web build. | `hono`, `drizzle-orm`, `@libsql/client`, `better-auth`, `ws` |
| `packages/config` | Site config JSON (default site plus one example override site), mock-data scenarios, locale files, generated JSON Schema. | none |
| `apps/app` | Expo universal app: web (dispatch, mobile unit) and native (mobile). | Expo, expo-router, react-native-web, NativeWind, TanStack Query, Zustand |
| `deploy/` | Dockerfile, compose file, cloudflared and Watchtower config, `.env.example`. | |
| `scripts/` | Committed one-off and ops scripts. | |
| `docs/` | Site-developer docs, API reference, specs and plans. | |

Data flow for one query: app builds field values from the form or terminal, calls core to validate, POSTs to the API. The API re-validates with core (never trust the client), writes the request and a `submitted` audit row, returns 202 with a correlation ID and ack timestamp, then dispatches to each selected source with its own timeout. Each source outcome writes a result row and an audit row and pushes a WebSocket event. The app renders results through core's mapper and highlighter.

Core is shared by app and API, so the same rules engine that drives the form also guards the API.

## 4. Core package

### 4.1 Site config schema

Zod schemas for the Appendix B entities. Top level:

```
SiteConfig {
  version: 1
  site: { id, name, locale: "en" }
  defaults: { [fieldKey]: value }            // site-wide defaults, e.g. state: "TX"
  picklists: Picklist[]
  sources: Source[]
  queryTypes: QueryType[]
  commands: CommandDef[]
  keywords: KeywordStyle[]
  responseMappings: ResponseMapping[]
  quickAccess: queryTypeCode[]                // FR-007, FR-070
  shortcuts?: ShortcutMap                     // dispatch keyboard map, see 6.4
}
QueryType { code, name, subtypes?: Subtype[], allowPlateOnly?: boolean,
            fields: FieldDef[], rules: FieldRule[],
            sources: { sourceId, selectedByDefault, plateOnly?: boolean }[],
            alsoRun?: NestedQuery[] }
FieldDef  { key, labelKey, dataType: "string"|"number"|"year"|"date"|"boolean"|"picklist",
            picklist?, defaultValue?, visible: boolean = true, required: boolean = false,
            section: "base"|"expanded" = "base", custom?: boolean }
FieldRule { field, when: Condition, effect: "show"|"hide"|"require"|"setDefault", value? }
NestedQuery { queryType, fieldMap: { [targetField]: sourceField } }
Source    { id, name, scope: "state"|"national"|"local", timeoutMs = 10000,
            requiresCredentials: boolean, kind: string = "mock", mock?: MockSpec }
CommandDef { code, queryType, subtype?, delimiter = ".", positions: fieldKey[] }
KeywordStyle { keyword, severity: "critical"|"warning"|"info", style?: { color?, background?, bold? } }
ResponseMapping { queryType, sourceId?, persona: "default"|"dispatch"|"mobileUnit"|"mobile",
                  elements: { path, labelKey, view: "summary"|"detail"|"both", format?: string }[] }
```

`FieldDef.defaultValue` overrides `defaults[fieldKey]`. Custom fields (FR-008) are ordinary `FieldDef`s with `custom: true`, which only affects documentation and admin display.

A JSON Schema is generated from the Zod schema into `packages/config/schema/site-config.schema.json` so editors autocomplete config files. `pnpm config:validate` validates every file under `packages/config/sites/`.

### 4.2 Condition language

Structured JSON, no expression strings, no eval. This closes the spec's first open question.

```
Condition =
  | { field, op: "eq"|"neq"|"in"|"notIn", value: Literal | { "$default": fieldKey } }
  | { field, op: "empty"|"notEmpty" }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
```

`{ "$default": "state" }` resolves to the effective default of that field, so "State is not the site default" is `{ "field": "state", "op": "neq", "value": { "$default": "state" } }`. Comparisons are string-normalized (trimmed, case-insensitive for picklist codes).

### 4.3 Rules engine

`evaluateForm(queryType, siteConfig, values) -> FormState`

```
FormState { fields: { key, visible, required, effectiveValue, section }[],
            missingRequired: fieldKey[], invalid: { field, reason }[] }
```

Algorithm: start from `FieldDef` visibility and required flags and defaults. Apply rules in config order; each rule whose condition holds against current effective values applies its effect; `setDefault` updates the effective value used by later rules, so order matters and is documented. Hidden fields are never required and their values are dropped from the submitted payload. Year fields normalize two digits to 2000 plus and reject anything that is not two or four digits. Plate-only (FR-012): when `allowPlateOnly` and only `plate` is non-empty, required checks are skipped and the planner selects only sources flagged for plate-only.

Covers FR-001 to FR-005, FR-010 to FR-012, FR-031, FR-032, UX-004.

### 4.4 Terminal parser and formatter

`parseCommand(siteConfig, input) -> ParsedCommand | ParseError`

Input is `CODE<delim>v1<delim>v2...`. Code match is case-insensitive. Trailing positions may be omitted; empty interior positions take the field's effective default; more positions than defined is an error. Values are trimmed. The result is passed through `evaluateForm`, so required-field errors come from the same engine as the form.

```
ParseError = { kind: "unknownCommand", code }
           | { kind: "tooManyPositions", expected, got }
           | { kind: "missingRequired", fields[] }
           | { kind: "invalidValue", field, reason }
```

`formatCommand(siteConfig, commandCode, values) -> string` is the inverse, used when toggling from form to terminal. Trailing empties are dropped, interior empties kept. Values carry over both ways when toggling (closes the spec's second open question, FR-056). Toggling to terminal uses the first command whose `queryType` matches the selected query type; if none exists the terminal starts empty. Toggling to form parses the current command and selects its query type.

Source selection stays in the panel UI in Phase 1; the command string does not name sources.

Covers FR-050 to FR-056.

### 4.5 Response mapper and highlighter

`mapResponse(siteConfig, queryType, sourceId, persona, payload) -> RenderElement[]` selects the most specific `ResponseMapping` (queryType plus sourceId plus persona, falling back to `default` persona, then to no sourceId) and resolves each `path` (dot path, `[n]` array index, `[*]` joins array values with `", "`) into `{ labelKey, value, view, format }`. Unknown formats fall back to `text`; formats are a registry so sites can add one (see 7).

`highlight(text, keywords) -> Segment[]` returns `{ text, severity? }` segments, whole-word, case-insensitive, longest keyword first. Applied by the app to every rendered text value.

Covers FR-060, UX-010, UX-011, UX-015, UX-016.

### 4.6 Query planner

`planRequest(siteConfig, queryType, values, selectedSourceIds) -> Plan`

```
Plan { primary: { queryType, values, sourceIds },
       nested: { queryType, values, sourceIds }[] }
```

Nested sub-requests come from `QueryType.alsoRun` with `fieldMap` copying values. Selected sources must be a subset of the query type's configured sources or the plan is rejected. All parts of a plan share one correlation ID at the API.

Covers FR-040 to FR-042.

## 5. API package

### 5.1 Routes

All routes under `/api`. Every body and query string is validated with Zod; OpenAPI is generated from the same schemas and served at `/api/openapi.json` with a viewer at `/api/docs` (BR-007).

| Route | Purpose |
|---|---|
| `POST/GET /api/auth/*` | Better Auth handlers |
| `GET /api/config` | Site config for clients, with `mock` specs and secrets stripped |
| `POST /api/queries` | Submit. Returns 202 `{ correlationId, acknowledgedAt }` |
| `GET /api/queries` | Caller's requests, paged, with per-source status, hidden results excluded |
| `GET /api/queries/:correlationId` | One request with results |
| `POST /api/queries/:correlationId/results/:sourceId/hide` | Delete from view |
| `WS /api/ws` | Result feed, see 5.3 |
| `GET/PUT /api/me/preferences` | Layout orientation, default view, persona override |
| `GET/PUT/DELETE /api/me/credentials/:sourceId` | State-system credentials |
| `POST /api/delegations`, `DELETE /api/delegations/:id` | Delegated credentials |
| `GET /api/audit` | Admin only, filter by user, correlation ID, type, time range |
| `GET /api/health` | Liveness for Docker healthcheck |

Static web build is served at `/` from the same process.

### 5.2 Query lifecycle

1. Authenticate session. Resolve site config.
2. `evaluateForm` and `planRequest` from core. Reject 400 with the core error shape on failure.
3. Insert `query_request` (correlation ID is a UUIDv7), insert `audit_event(submitted)`, set `acknowledged_at`, insert `audit_event(acknowledged)`. Return 202. Server-side target for this step is 200ms (NFR-004 decision).
4. Enqueue dispatch on an in-process queue. For each source in the plan, resolve credentials (own or delegated), call the adapter with an `AbortSignal` that fires at `timeoutMs`. Outcome writes `source_result` with status `returned`, `failed` or `timedOut`, plus `audit_event(sourceResponded)`, and pushes a WebSocket event. Nested sub-requests run the same way under the same correlation ID.
5. Client receives `ack`, then one `sourceStatus` per outcome.

Covers FR-043, FR-044, FR-064, FR-065, SEC-010, SEC-012, SEC-014, NFR-002.

### 5.3 Result feed

WebSocket at `/api/ws`, authenticated by session cookie or bearer token on upgrade. Events: `ack`, `sourceStatus`, `sourceResult`, each carrying a monotonically increasing per-user event id. On reconnect the client sends its last seen id and the server replays from the database. This gives at-least-once delivery over intermittent links without an external broker. WebSocket is used rather than SSE because React Native supports it without a polyfill.

### 5.4 Sources

```
interface SourceAdapter {
  query(req: SourceRequest, creds: Credentials | null, signal: AbortSignal): Promise<SourcePayload>
}
```

`MockSourceAdapter` is the only implementation. Behaviour comes from `Source.mock` in config:

```
MockSpec { latencyMs: [min, max], default: SourcePayload,
           scenarios: { when: { [field]: value }, respond?: SourcePayload, behavior?: "timeout"|"error"|"badCredentials" }[] }
```

Scenarios match on submitted values, first match wins. Examples seeded for the default site: plate `ABC123` returns a STOLEN hit, plate `TIMEOUT` never responds, plate `FAIL1` errors, a person with last name `WANTED` returns a WANTED hit. If `requiresCredentials` and none are attached, the adapter returns `badCredentials`; a stored password equal to `expired` does the same, to exercise SEC-002.

Adapters are registered in `packages/api/src/sources/registry.ts` by a `kind` string; a real adapter is a new file plus a registry line.

### 5.5 Persistence

SQLite through libsql and Drizzle. Migrations generated by drizzle-kit, applied at process start. Tables:

- Better Auth tables: `user`, `session`, `account`, `verification`, plus `two_factor` in Phase 2.
- `query_request` (correlation_id PK, user_id, credential_user_id nullable, query_type, subtype, values JSON, source_ids JSON, submitted_at, acknowledged_at, parent_correlation_id nullable for nested parts).
- `source_result` (correlation_id, source_id, status, received_at, payload JSON, error).
- `result_visibility` (correlation_id, source_id, user_id, hidden_at). Delete from view inserts here; rows in `source_result` are never deleted (FR-062, FR-063).
- `audit_event` (id, correlation_id nullable, type, actor_user_id, credential_user_id nullable, at, details JSON). Append-only: no UPDATE or DELETE statements exist in code, and SQLite triggers `RAISE(ABORT)` on both (SEC-013 and the audit rows generally).
- `state_credential` (user_id, source_id, username, secret_ciphertext, iv, updated_at).
- `credential_delegation` (id, session_user_id, credential_user_id, source_id, created_at, expires_at, revoked_at).
- `user_preference` (user_id, layout_orientation, default_view, persona_override).

`AuditService`, `IdentityService`, `EntityStore` and `EventBus` are interfaces per Appendix B with local implementations, so Shared Platform services can replace them (PLT-001 to PLT-005 deferred, PLT-008 respected by not depending on any legacy layer).

Drizzle keeps a Postgres move cheap if volume ever demands it.

### 5.6 Authentication

Better Auth with email plus password. Web uses httpOnly, secure, SameSite=Lax session cookies; native uses the Better Auth Expo plugin with bearer tokens in secure storage. Roles: `user`, `trainingOfficer`, `admin`, stored on the user row and checked by route middleware. Password hashing is Better Auth's default (scrypt). Rate limiting on auth routes. Seeded demo users live in `packages/api/src/seed/users.ts` and are documented in `docs/demo.md`; they are demo accounts on mock data.

TOTP MFA through the Better Auth two-factor plugin is Phase 2 (SEC-005), opt-in per user.

### 5.7 State-system credentials and delegation

Credentials per user per source (SEC-001, SEC-002). Secret encrypted with AES-256-GCM, random 12-byte IV per record, key from `CREDENTIAL_KEY` (32 bytes, base64) in the environment, never logged (SEC-006). Change replaces the record and writes `audit_event(credentialsChanged)`; the old ciphertext is gone.

Delegation (SEC-003, SEC-004, SEC-011): inside the trainee's session the app opens a "training officer sign-in" dialog. The officer's email and password are POSTed to `/api/delegations`, verified through Better Auth's server API with no session cookie or token issued, and a `credential_delegation` row is created with a default expiry of 8 hours. While active, dispatch resolves credentials from the officer for that source, and `query_request.credential_user_id` and every audit row record both identities. Either user can revoke. Expired delegations are ignored.

This area, audit, and the query pipeline are the sensitive code named in `CLAUDE.md` and are implemented and reviewed on Opus seats.

### 5.8 Config loading

Site config is read from the file named by `SITE_CONFIG` (default `packages/config/sites/default.json`) at startup and validated by core. Invalid config fails startup with the Zod error path. No admin editing UI in scope; edit the file and restart. Locale strings load from `packages/config/locales/<locale>.json` (NFR-001, `en` only for now).

### 5.9 Security baseline

Security headers (CSP, frame-ancestors none, nosniff, referrer policy), CORS locked to the deployed origin and localhost, request body limits, structured logs without secrets or credential values, secrets only from environment. TLS terminates at Cloudflare; the container listens on plain HTTP on the private compose network (SEC-007 at the prototype's boundary).

## 6. App

### 6.1 Personas

Persona is resolved at startup and re-evaluated on resize: native platform means `mobile`; web with width 1024 or more and a fine pointer means `dispatch`; otherwise `mobileUnit`. Users can override in preferences (UX-001, UX-012, UX-014). Persona selects layout components and the response mapping persona; it never changes what data is fetched.

### 6.2 Screens (Phase 1)

Login. Query panel with query-type selector, form or terminal toggle, source checkboxes, quick-access bar for frequent types (FR-007). Results list with per-source status, summary and detail toggle, keyword highlighting, delete from view. Acknowledgment toast and result notifications. Credentials settings. Admin audit viewer. Later: delegation dialog (M3), mobile home with quick queries (M4).

Forms render entirely from core's `FormState`; there is no per-query-type UI code (BR-001).

### 6.3 Mobile unit (Toughbook) layout

Designed at 1024x768 first, verified at 1366x768 and 800x600. Single column, no side panels. Minimum touch target 48x48 CSS px, minimum body text 16px, high-contrast theme with no reliance on hover, focus or colour alone. Query panel and results are stacked with the results collapsible. Condensed result cards showing summary elements only, with detail behind one tap. Orientation preference switches horizontal versus vertical value layout (UX-002, UX-012, UX-013). Rendering is tested in Playwright at those three viewports.

### 6.4 Dispatch keyboard model

Every interactive element is in the tab order with a visible focus ring. Default shortcut map, overridable by `siteConfig.shortcuts`:

| Key | Action |
|---|---|
| `/` | Focus terminal input |
| Ctrl+Backtick | Toggle form and terminal |
| `Alt+1` to `Alt+9` | Select query type by position |
| `Enter` in a form field | Submit (FR-006) |
| `Ctrl+Enter` anywhere in the panel | Submit |
| `Up`/`Down` in results | Move selection |
| `Enter` on a result | Expand or collapse detail |
| `Delete` on a result | Delete from view, with confirm |
| `Esc` | Close dialog or clear selection |
| `?` | Show shortcut sheet |

The shortcut map is one JSON object, so a site changes keys without code. Playwright tests drive the full plate query and terminal query with keyboard only.

### 6.5 State and data

TanStack Query for server state with the WebSocket feed invalidating and patching the query cache. Zustand for panel state (mode, selected query type, draft values, selected sources). The draft survives toggling because `formatCommand` and `parseCommand` translate it in both directions.

### 6.6 Connectivity

A connection indicator reflects WebSocket state. When offline the submit button is disabled with a reason; there is no offline queue in scope. Reconnect replays missed events (5.3). This is the Phase 1 answer to NFR-003; queued submits are a later milestone.

### 6.7 Native specifics

Expo Go for development on a phone. EAS builds only when Phase 3 needs camera, background execution and push. Expo push notifications are the intended mechanism for FR-065 in the background; not built in Phase 1.

## 7. Site-developer experience

The imaginary site-specific developer gets:

- `pnpm install`, `pnpm dev`: API and web running with seeded users and the default site.
- `docs/site-config.md`: walkthrough of every config section with the vehicle plate example from Appendix B, the condition language, command definitions, keyword styles and response mappings.
- `packages/config/sites/example-ok.json`: a second site showing overrides (different default state, narrowed property picklist, extra custom field, different delimiter).
- JSON Schema autocomplete in editors; `pnpm config:validate` in CI.
- Documented extension points, each one file plus one registry line: source adapters (5.4), response formats (4.5), shortcut map (6.4), locales (5.8).
- `docs/api.md` generated from OpenAPI.

Nothing a site needs for BR-001 requires touching `packages/core` or `apps/app`.

## 8. Deployment

One image built by a multi-stage Dockerfile: install with pnpm, build core and API, export the Expo web bundle, copy into a `node:22-alpine` runtime running as a non-root user with a healthcheck on `/api/health`. SQLite lives on a mounted volume at `/data`.

The laptop runs `deploy/compose.yml` with three services:

- `app`: `ghcr.io/birchdesignlab/querymodule:latest`, env from `.env` (session secret, `CREDENTIAL_KEY`, `SITE_CONFIG`, public URL), volume `/data`.
- `cloudflared`: tunnel with a token from the Cloudflare dashboard, routing `querymodule.birchdesignlab.com` to `app:3000`. DNS is on Cloudflare, so the route creates the CNAME.
- `watchtower`: polls GHCR every five minutes, label-scoped to `app`, using a read-packages token because the image is private.

`.env.example` is committed; `.env` is not. Rolling back is `docker compose pull` of a sha tag.

## 9. CI and repository process

`.github/workflows/ci.yml`, on pull requests and pushes to `main`, concurrency cancelled per ref, `ubuntu-latest`, permissions `contents: read` plus `packages: write` on `main` only:

1. Checkout, pnpm with store cache, `pnpm install --frozen-lockfile`.
2. `biome ci`, `tsc -b`, `pnpm config:validate`.
3. `vitest run --coverage` with thresholds (core 95% lines and branches, API 85%).
4. Expo web export.
5. Playwright e2e against the export plus a test API (from M2).
6. Docker build. On `main`, log in to GHCR and push `latest` and the commit sha.

`.github/dependabot.yml`: npm weekly, grouped minor and patch, majors separate; github-actions weekly; docker weekly. Newest stable, no known advisories (per `CLAUDE.md`).

Trunk-based: short-lived `feat/`, `fix/`, `docs/` branches, one PR each, squash merge when CI is green, self-merged. No rulesets by decision. `main` is always deployable because every merge ships.

## 10. Testing strategy

- Core: colocated `*.test.ts`, table-driven, one describe per requirement ID where it maps (`FR-054 fills skipped positions with defaults`). Property-style tests for the parser and formatter round trip.
- API: Hono `app.request` against an in-memory libsql database, seeded per test. Contract tests assert the OpenAPI document matches route behaviour. Audit immutability has a test that attempts UPDATE and DELETE and expects the trigger abort.
- App: React Native Testing Library for components rendering `FormState` and results. Playwright on the web export for login, plate query with conditional fields, terminal query, keyboard-only completion, highlighting, delete from view, and the three Toughbook viewports.
- TDD: tests are written before implementation for every task, per the superpowers workflow.

## 11. Decisions on spec TBDs

| Open question | Decision |
|---|---|
| Rule condition language | Structured JSON conditions (4.2) |
| Values carry over on form and terminal toggle | Yes, both directions (4.4) |
| Two-digit year | 2000 plus (4.3) |
| Per-source timeout default | 10s, per source in config |
| Acknowledgment target | 200ms server-side |
| Retention of responses deleted from view | Indefinite; a site config knob later |
| Minimum touch target | 48x48 CSS px on mobile unit and mobile |
| Scan auto-submit | Stays TBD, Phase 3; default will be confirm first |
| Background lookup launch | Stays TBD, Phase 3; Expo push notification action is the leading option |
| EU Cyber Resilience Act | Stays TBD; not a prototype concern |

## 12. Milestones

Each milestone ends live on the URL.

- M0 Skeleton: monorepo, CI green, image on GHCR, tunnel up, login with seeded users, health page.
- M1 Forms and terminal: A1 to A5. Plate form with defaults, conditional and required fields, validation, terminal parser, toggle with carry-over. Keyboard-only path works.
- M2 Results and audit: A6 to A9. Ack, WebSocket feed, keyword highlighting, response mapping with summary and detail, audit log and admin viewer. Playwright suite online.
- M3 Workflow and compliance: B1 to B5. Multi-source status with timeouts, nested queries, delegated credentials, change credentials, delete from view. TOTP MFA.
- M4 Mobile: C1, C2. Mobile unit and mobile layouts, Expo Go on a phone, orientation preference, home-screen quick queries.
- Later: B6 supplemental write-back, B7 property picklist, C3 to C6.

## 13. Traceability

| IDs | Where |
|---|---|
| BR-001, BR-007 | 4.1, 7, 5.1 |
| BR-002, PLT-006 | 2, 3 (standalone add-on) |
| FR-001 to FR-012, FR-031, FR-032 | 4.3 |
| FR-020, FR-030 | default site config |
| FR-040 to FR-044 | 4.6, 5.2 |
| FR-050 to FR-056 | 4.4 |
| FR-060, UX-010, UX-011, UX-015, UX-016 | 4.5 |
| FR-061, PLT-003 | later milestone, `EntityStore` interface in 5.5 |
| FR-062, FR-063, SEC-013 | 5.5 |
| FR-064, FR-065, SEC-012, SEC-014 | 5.2, 5.3 |
| FR-070 | M4 |
| UX-001, UX-002, UX-012 to UX-014 | 6.1, 6.3 |
| UX-004 | 4.3, 6.2 |
| SEC-001 to SEC-004, SEC-011 | 5.7 |
| SEC-005 | 5.6, M3 |
| SEC-006, SEC-007 | 5.7, 5.9 |
| SEC-010 | 5.2, 5.5 |
| NFR-001 | 5.8 |
| NFR-002 | 5.2 |
| NFR-003 | 5.3, 6.6 (partial) |
| NFR-004 | 5.2 |
| PLT-001, PLT-002, PLT-004, PLT-005, PLT-008 | 5.5 interfaces; deferred |

## 14. Risks

- Expo web on a dense dispatch console may feel worse than a plain React app. Mitigation: dispatch layout built and keyboard-tested first on web; core and API are UI-agnostic, so a swap to a Vite web app costs only `apps/app`.
- React Native Web, NativeWind and Expo versions move fast; Dependabot majors are reviewed, not auto-merged.
- Better Auth's Expo plugin is younger than its web path; native auth is exercised at M4, with a fallback to a plain bearer session if it misbehaves.
- WebSocket through Cloudflare Tunnel is supported but must be verified at M0 with the health page.
- SQLite is single-writer; fine for a prototype, and Drizzle keeps Postgres available.
- Home laptop uptime. Watchtower and compose `restart: unless-stopped` cover reboots; there is no failover.
