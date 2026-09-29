# Query Module 2.0 Design (v2)

Date: 09-25-26
Status: v2, ready for implementation planning
Open decisions: 0
Supersedes: `docs/superpowers/specs/2026-09-25-query-module-2-design.md` (v1)
Review: `docs/superpowers/specs/2026-09-25-query-module-2-design-review.md`
Decisions: `docs/superpowers/specs/2026-09-25-review-decisions.md`
Source: `Requirements Definition - Query Module Usability Enhancements.md` (the spec). Requirement IDs (BR, FR, UX, SEC, NFR, PLT) refer to its Project Specifications table; story IDs (A1 to A9, B1 to B7, C1 to C6) to its Appendix A.

## 1 Purpose

Build the Query Module as a standalone add-on: a configuration-driven query front end with its own API, deployable into CAD Dispatch, CAD Mobile Unit, CAD Mobile, CAD Records (including Records-only customers) and Mobile Field Reporting. A host CAD product of unknown stack integrates in one of two ways: it embeds the module (web iframe plus a versioned postMessage protocol, or the React Native library for native hosts) and hands it the host's logged-in user, or it calls the versioned HTTP API directly. A standalone demo app with its own login shows the module without a host. The code is intended to become the foundation of the real Query Module 2.0 and doubles as a portfolio piece handed to a real company.

The prototype uses mock data sources with canned responses. It never connects to real state or national systems and never holds real CJIS data. Fixtures follow the fixture policy in 5.4 and must not resemble real person, vehicle or property records.

Covers BR-002, PLT-006.

## 2 Constraints

- Form factors, phased: web personas from M1 (dispatch and records on a desktop browser; mobile unit reachable in the browser on the shared responsive layout, with the Toughbook layout, the 7:1 theme and C1 landing in M4); native (mobile, smartphone) by M4. Each milestone ends live on the URL with the form factors it has reached (see 12).
- Mobile unit hardware is Toughbook class: low resolution (1024x768 and 1366x768 first, 800x600 must still work with scrolling), touch with gloves, sunlight, intermittent connectivity (see 6.3, 6.8).
- Dispatch is keyboard-first. Every Phase 1 flow is completable without a mouse, through single-key, modifier and chord shortcuts scoped by context (see 6.4). The keyboard model applies to every web persona.
- Configuration-driven (BR-001): a site-specific developer (imaginary, non-core) sets up, extends and customises through JSON config, locales and mock files supplied by volume, declarative formats, and the adapter plugin directory. One image serves every site; no site edits core code or rebuilds the image (see 4.1, 7).
- UI fully tokenized (colour, spacing, type, radius, motion) in `packages/tokens`, with day, night and red-shift modes. Every mode meets the contrast targets below (see 6.5).
- Accessibility target: WCAG 2.2 AA for every web persona; platform accessibility guidelines (Apple and Android) for native. Mobile-unit body text contrast is 7:1 in every mode; WCAG AA contrast elsewhere. Automated axe checks run in CI from M1; screen-reader passes are milestone exits (see 10, 12).
- Compliance posture: aimed at the CJIS Security Policy control areas, GDPR and the EU Cyber Resilience Act, without certification. The prototype holds no CJIS data; certification belongs to the company that adopts the code. Dispositions for SEC-020, SEC-021 and SEC-022 are in 11.
- TypeScript everywhere, strict. TDD. Trunk-based: short-lived branches, one PR each, a ruleset on `main` requiring a PR and the `sensitive-review` status check (see 9). Unfinished capabilities merge dark behind `SiteConfig.features` (see 5.8). Dependabot, newest stable, no sitting on known advisories.
- Deployed to one shareable URL, `querymodule.birchdesignlab.com`, through a Cloudflare Tunnel (sole ingress; the app port is not published) to a Docker host on a home Linux laptop. In standalone mode an in-app login gates it; the URL itself is open (see 8).
- Single node is a hard limit: one process, one SQLite file, in-process dispatch and event bus. No replica or database swap is designed for (see 5.5, 14).
- Solo developer plus agents, subagent tiering per `CLAUDE.md`. Two build machines: API work on Linux, web work on Windows (the tracks in 12).

Business requirement dispositions:

| ID | Disposition |
|---|---|
| BR-003 | No new licensing model. The module ships under the host product's existing licence: no licence keys, metering or per-seat checks in code. |
| BR-004 | Each milestone release tag gets `docs/releases/<tag>.md` (see 9.5). |
| BR-005 | Product docs (`docs/`) are reviewed and refreshed at every milestone exit; the exit checklist in 12 includes it. |
| BR-006 | CI runs a licence check against an allowlist (MIT, BSD, Apache-2.0, ISC); any other licence fails the build until reviewed and added with a recorded reason (see 9). Applies to later OCR, barcode and voice libraries too. |

Non-goals for this design: real source adapters (the plugin API in 5.4 is in scope; real implementations are not); Shared Platform integration and service principals for Shared Platform consumers (PLT-001 to PLT-005 stubbed behind the seam interfaces in 5.5); horizontal scale-out; response aggregation spike (FR-045); voice (FR-075); OCR and barcode (FR-072 to FR-074, Phase 3, designed later); MFA beyond TOTP; credential key rotation (a `key_version` column is recorded, no rotation procedure is built); field constraints that vary with a rule condition (conditional constraints are deferred; constraints are static per field, 4.1); an audit hash chain (deferred, see 12.6); offline queueing of submits (NFR-003 is partially met, see 6.8); formal CJIS, GDPR or EU CRA certification.

Covers BR-001, BR-003, BR-004, BR-005, BR-006, UX-001.

## 3 Architecture

pnpm workspace monorepo, TypeScript strict, Node 24 LTS (ADR-0001).

| Path | Role | Runtime deps |
|---|---|---|
| `packages/core` | Domain logic, pure functions, no IO. Config schema and `validateSiteConfig`, condition language, rules engine, terminal tokenizer, parser and formatter, response mapper, `assessResult`, keyword highlighter, query planner, and the shared contracts (audit event types, WebSocket event schemas, postMessage schemas, API error shape, version constants). Used by every client and by the API. | `zod` |
| `packages/client` | Framework-neutral client logic shared by web and native: API client generated from OpenAPI, WebSocket client with replay cursor and seq high-water mark, Zustand stores (draft as user values, panel state), TanStack Query hooks, selectors, reset on logout, 401 or user change. No persistent storage of query data. It takes an injected `ClientPlatform` { auth transport (cookie \| bearer), token store, online signal, visibility signal } and imports nothing from React Native or the DOM. Tests live here, run in the Vitest node environment with fakes, and test hooks with `renderHook`. | `core`, `zustand`, `@tanstack/react-query`, `openapi-fetch`; peer `react` |
| `packages/tokens` | Design tokens (colour, spacing, type, radius, motion) per mode (day, night, red-shift). Builds CSS variables for web and a theme object for React Native. Site overrides come from `SiteConfig.theme`. Contrast pairs checked per mode. | none |
| `packages/web-ui` | React DOM primitives on native HTML elements (field renderer, listbox, table with headers, disclosure buttons, announcer, shortcut engine binding). Consumed by `apps/web`. | `core`, `client`, `tokens`; peer `react`, `react-dom` |
| `packages/rn-ui` (M4) | React Native component library: the embeddable module for a native host such as CAD Mobile, with role and state props set on every control. `apps/mobile` is its demo shell. | `core`, `client`, `tokens`; peer `react`, `react-native` |
| `packages/config` | Default site and the `example-ok.json` overlay site, mock files `mock/<siteId>.json`, locale files, generated JSON Schema. Fixture-free site configs. In deployment the same layout is supplied by volume (see 5.8). | none |
| `packages/api` | HTTP and WebSocket server under `/api/v1`. Persistence, auth (standalone and embedded), credentials and delegation, dispatch, built-in mock adapter plus adapters loaded from `ADAPTER_DIR`, audit, config loading, event log. Serves the web build. | `core`, `hono`, `@hono/node-server`, `drizzle-orm`, `@libsql/client`, `better-auth`, `ws`, `jose` |
| `apps/web` | Vite + React DOM app for dispatch, mobile unit and records personas, in both modes. | `client`, `web-ui`, `tokens`, `core`, `react`, `react-dom`, `react-router` (Expo keeps `expo-router`; no routing is shared) |
| `apps/host-simulator` | Static page, its own port and origin, never bundled into the production image (6.9). Issues test JWTs and frames `/embed` over postMessage v1 for embedded-mode testing. | `client`, `tokens` |
| `apps/mobile` (M4) | Expo app for the mobile persona: demo shell around `rn-ui`, standalone mode only. Expo Go for development. | Expo, `expo-router`, `expo-secure-store`, `react-native`, `rn-ui`, `client`, `tokens` |
| `deploy/` | Dockerfile, compose file, cloudflared config, `deploy-pull` systemd unit and timer, `.env.example`, secret file templates. | |
| `scripts/` | Committed one-off and ops scripts: `scripts/ops/` (seed, backup, restore-test, smoke, purge, grant-role, disable-user, lost-key, lost-data-key), `scripts/mock-data/` (fixture generator), `scripts/ci/`, `scripts/migrations/`. | |
| `docs/` | Site-developer docs, API reference, embedding guide, threat model, release notes (`docs/releases/`), specs and plans. | |

Core is shared by every client and the API, so the same rules engine that drives the form also guards the API. Clients read `GET /api/v1/meta` and refuse to run below `minClientVersion` (see 5.1).

### 3.1 Modes

Deploy config `IDENTITY_MODES` enables `standalone`, `embedded` or both (default `standalone`; 8.2).

- **Standalone.** The demo app: Better Auth email and password login (5.6), web at `/` and native through `apps/mobile`.
- **Embedded.** A web host frames `/embed` in an iframe and hands the module its logged-in user as a host JWT over postMessage protocol v1; a native host embeds `packages/rn-ui` instead. Identity mapping, session rules and the protocol are in 5.6 and 6.9.

Both modes share one API, one database schema and one audit trail.

### 3.2 Data flow for one query

1. The client holds the draft as user values (6.7); core `evaluateForm` derives `FormState` from it (4.3).
2. Submit sends `POST /api/v1/queries` with `Idempotency-Key`, `configHash`, query type, user values, `mode` and selected sources (6.7).
3. The API validates and plans parts (4.6: part 0 is the primary; a nested part's id is its `alsoRun` index plus 1). In one transaction it inserts one `query_request` row per part, one `pending` `source_result` per (part, source) with its credential snapshot, and the `submitted`, `partSkipped`, `sourceDispatched` and `acknowledged` audit rows, then returns 202 `{ correlationId, acknowledgedAt, parts[] }` (5.2).
4. The dispatcher runs sources in parallel within caps and deadlines; each outcome writes its status once, audits `sourceResponded` and appends an `event_log` row (5.2).
5. Reference-only `sourceStatus` events tell the client what to fetch; a reconnect replays from its cursor or resyncs (5.3, 6.7, 6.8).
6. On restart, rows still `pending` become `interrupted`; nothing is re-dispatched (5.2).

Correlation ID and part id together key every result, hide and event, so a nested part that hits the same source as its parent stays distinct (see 5.2, 5.5).

Covers FR-040, FR-041, FR-042, FR-043, FR-044, FR-064, NFR-002, NFR-003.

## 4 Core domain

### 4.1 Site config schema

Zod schemas for the Appendix B entities, exported by `packages/core`. One resolved `SiteConfig` per deployment, read from the config volume (see 5.8). Vocabulary used throughout 4.1 to 4.6: **configured default** (from config, fixed), **user value** (what the user entered), **effective value** (user value, else rule default, else configured default).

```
SiteConfig {
  schemaVersion: 1                                  // CONFIG_SCHEMA_VERSION; migrateConfig in 5.8
  extends?: siteId                                  // overlay on a base site, see "Overlays"
  site: { id, labelKey }
  locales: localeCode[] = ["en"]                    // locales[0] is the default; per-user choice in user_preference
  features: { [FeatureKey]: boolean }               // unlisted keys default false; catalogue in 5.8
  personas: PersonaDef[]                            // open list, see 6.1
  auth: AuthConfig
  delegation: DelegationConfig
  retention: { payloadDays: int | null, valuesDays: int | null }   // null = keep; prototype ships null
  terminal: { delimiter: char = "." }
  defaults: { [fieldKey]: Literal }                 // site-wide configured defaults, e.g. state: "TX"
  picklists: Picklist[]
  sources: Source[]
  queryTypes: QueryType[]
  commands: CommandDef[]
  keywords: KeywordStyle[]
  keywordSeverityStyles: { critical: SeverityStyle, warning: SeverityStyle, info: SeverityStyle }
  responseMappings: ResponseMapping[]
  quickAccess: queryTypeCode[]                      // FR-007, FR-070
  shortcuts?: ShortcutMap                           // merged over the default map in 6.4
  theme?: ThemeConfig                               // see 6.5
}
Literal = string | number | boolean
```

**Features.** Catalogue, behaviour and dark merges: 5.8.

**Personas, auth, delegation, retention.**

```
PersonaDef { key, labelKey, layout: "dispatch" | "mobileUnit" | "mobile" }
           // shipped: dispatch, mobileUnit, mobile, records
AuthConfig {
  mfaRequired: boolean | { roles: Role[] } = false       // SEC-005; middleware in 5.6
  session: { absoluteMinutes: int = 720, idleMinutes: int = 30 }   // web cookie and native bearer alike
  embedded?: { roleClaims: { claim: string, map: { [claimValue]: Role } } }  // embedded mode, 6.9
}
Role = "user" | "trainingOfficer" | "admin"
DelegationConfig {
  maxDurationMinutes: int = 480
  purposes: { key, labelKey, delegatorRoles: Role[], maxDurationMinutes?: int }[]
            // default [{ key: "training", labelKey: "delegation.training", delegatorRoles: ["trainingOfficer"] }]
}
```

The shipped `records` persona uses the `dispatch` layout. A purpose's `maxDurationMinutes` may not exceed the site value. Retention mechanism: 5.5.

**Query types and fields.**

```
QueryType {
  code, labelKey, allowPlateOnly: boolean = false
  sections: SectionDef[]                            // must contain key "base"
  defaults?: { [fieldKey]: Literal }                // query-type configured defaults
  fields: FieldDef[]                                // array order is display order
  rules: FieldRule[]
  sources: QueryTypeSource[]
  alsoRun?: NestedQuery[]                           // at most 4; one nesting level
}
SectionDef { key, labelKey, when?: Condition }      // absent when = always visible
QueryTypeSource { sourceId, selectedByDefault: boolean, plateOnly: boolean = false, when?: Condition }
NestedQuery { queryType: queryTypeCode, fieldMap: { [targetField]: sourceField }, when?: Condition }

FieldDef {
  key, labelKey
  dataType: "string" | "number" | "year" | "date" | "boolean" | "picklist"
  role?: "type"                                     // a type level; picklist only
  picklist?: picklistId                             // required iff dataType = picklist
  picklistFilter?: { byField: fieldKey }            // options = values whose parent == that field's effective value
  defaultValue?: Literal
  visible: boolean = true
  required: boolean = false
  section: sectionKey = "base"
  custom: boolean = false                           // FR-008; documentation and admin display only
  // string constraints
  minLength?: int, maxLength: int = 64              // maxLength <= 4096 (API per-value cap)
  pattern?: string                                  // anchored by core as ^(?:pattern)$
  charset: "printableAscii" | "printable" = "printableAscii"
  transform: "upper" | "none" = "none"
  // number
  numberKind: "integer" | "decimal" = "integer"
  // year and date
  century: "2000" | "past" = "2000"                 // two-digit year rule; "past" for DOB
  inputFormats: DateFormat[] = ["MMDDYYYY", "MM/DD/YYYY", "MM-DD-YYYY", "YYYY-MM-DD"]
  outputFormat: DateFormat = "MMDDYYYY"             // terminal serialisation, see 4.4
}
DateFormat = string of tokens MM, DD, YY, YYYY and literal separators

FieldRule { field: fieldKey, when: Condition,
            effect: "show" | "hide" | "require" | "setDefault", value?: Literal }  // value iff setDefault
```

`charset: "printable"` admits any Unicode except `\p{Cc}` and `\p{Cf}` (control and format characters). Constraints are static per field; constraints that vary with a rule condition are deferred (2). Date values are stored as ISO `YYYY-MM-DD`; display uses MM-DD-YY through the locale formatter (see 6.2).

**Type fields.** There is no subtype entity. Each level of a query-type hierarchy (property type, then category, then kind, to any depth) is an ordinary picklist `FieldDef` with `role: "type"`; a lower level declares `picklistFilter: { byField }` naming the level above, and its picklist values carry `parent` codes. Visibility, required flags and sections for a type combination are ordinary conditions on those fields (see 4.2). The submitted audit row records the query type code and every `role: "type"` field value (see 4.7).

**Picklists, sources, commands.**

```
Picklist { id, values: { code, labelKey, enabled: boolean = true, parent?: code }[] }

Source {
  id, labelKey, scope: "state" | "national" | "local"
  kind: string                                      // required, no default; validated against the adapter registry (5.4)
  timeoutMs: int = 10000
  maxConcurrent: int = 4                            // per-source in-flight cap (5.2)
  requiresCredentials: boolean
  server?: { [k]: unknown }                         // adapter settings, validated by the adapter's schema; never sent to clients
}

CommandDef {
  code, queryType: queryTypeCode
  presets?: { [fieldKey]: Literal }                 // e.g. type-field values fixed by this command
  positions: (fieldKey | { field: fieldKey, rest: true })[]   // rest: last position only, string fields only
}
```

Sites narrow a picklist (FR-031) by setting `enabled: false`; disabled codes never reach `FormState` options and fail canonicalisation. Mock responses are not in site config; they live in `packages/config/mock/<siteId>.json` (see 5.4). There is no per-command delimiter; `terminal.delimiter` applies to every command.

**Keywords and response mappings.**

```
KeywordStyle { keyword, severity: "critical" | "warning" | "info", except?: string[] }
              // except: phrases containing the keyword that do not count as a hit, e.g. "NOT STOLEN"
              // styling is per severity; there is no per-keyword override
SeverityStyle { color: tokenName, background: tokenName, bold: boolean, icon: iconName,
                marker: string, audibleCue: boolean = false }
              // marker is text rendered with every hit, so severity never relies on colour

ResponseMapping {
  id, queryType: queryTypeCode, sourceId?, persona?: personaKey, when?: Condition
  elements: MappingElement[]
}
MappingElement =
  | { kind: "value", path, labelKey, view: "summary" | "detail" | "both",
      format?: Format, highlight: boolean = true }
  | { kind: "table", path, labelKey, view: "summary" | "detail" | "both", highlight: boolean = true,
      columns: { path, labelKey, format?: Format, highlight?: boolean }[] }   // column paths relative to each row
Format = { type: "text" } | { type: "upper" } | { type: "phone" }
       | { type: "date", pattern: string } | { type: "template", template: string }
```

`color` and `background` name tokens from `packages/tokens`, resolved per theme mode. `highlight: false` is for elements that echo user input. Absent `sourceId`, `persona` or `when` means "any". Path syntax, `[*].x` projection, selection score and the generic dump fallback are in 4.5. `Format` is a fixed set; an unknown `type` is a validation error.

**Shortcuts and theme.**

```
ShortcutMap { [actionKey]: ShortcutBinding | ShortcutBinding[] }
ShortcutBinding { keys: string, context: "global" | "panel" | "results" | "terminal" }
  // keys: space-separated strokes; stroke = [Ctrl+][Alt+][Shift+]<KeyboardEvent.code>
  // "Slash" (single key), "Ctrl+Enter" (combo), "KeyG KeyR" (chord)
ThemeConfig {
  defaultMode: "day" | "night" | "redShift" = "day"
  auto: "off" | "os" | "time" = "off"
  tokens?: { all?: TokenOverrides, day?: TokenOverrides, night?: TokenOverrides, redShift?: TokenOverrides }
}
TokenOverrides { [tokenName]: string }              // token names from packages/tokens
```

Action keys come from the shortcut engine's catalogue (6.4). The user's mode choice lives in `user_preference` and overrides `defaultMode`.

**Defaults precedence.** A field's configured default is `FieldDef.defaultValue` ?? `QueryType.defaults[key]` ?? `SiteConfig.defaults[key]`, else none. It is fixed for the lifetime of the loaded config.

**Overlays.** A site file with `extends` is merged onto the named base site before validation. Objects deep-merge by key. Arrays of entities merge by identity key: `picklists`, `sources` by `id`; `queryTypes`, `commands` by `code`; `fields`, `sections`, `personas`, `delegation.purposes` by `key`; picklist `values` by `code`; `keywords` by `keyword`; `responseMappings` by `id`; `QueryType.sources` by `sourceId`; `alsoRun` by `queryType`. Other arrays (`rules`, `positions`, `elements`, `columns`, `quickAccess`, `locales`, `inputFormats`) replace the base array whole. `{ "$remove": true }` in place of a keyed entry or an object key deletes it. Overlays are one level deep: the base may not itself use `extends`. `packages/config/sites/example-ok.json` is an overlay on `default` (different default state, narrowed property picklist, extra custom field, different delimiter). `config:validate --resolved` prints the merged config and its diff from the base (see 7).

**Client view.** `GET /api/v1/config` returns `ClientSiteConfig`, a separate allowlist schema, never the server object with fields stripped:

```
ClientSiteConfig = {
  schemaVersion, configHash, site, locales, features, personas,
  delegation: { purposes: { key, labelKey, maxDurationMinutes? }[], maxDurationMinutes },
  terminal, defaults, picklists, queryTypes, commands, keywords, keywordSeverityStyles,
  responseMappings, quickAccess, shortcuts, theme,
  sources: { id, labelKey, scope, timeoutMs, requiresCredentials }[]
}
```

Excluded: `extends`, `auth`, `retention`, `Source.kind`, `Source.server`, `Source.maxConcurrent`. The server parses config strictly (unknown keys are errors); the client parses `ClientSiteConfig` forward-tolerantly (unknown keys stripped, `z.catch` on optional enums).

**Validation.** `packages/config/schema/site-config.schema.json` is generated from the Zod schema for editor autocomplete and is documented as shape-only. `validateSiteConfig(config, locales) -> { errors: Diagnostic[], warnings: Diagnostic[] }` runs the referential pass on the resolved config at API startup (fail closed, see 5.8), in `pnpm config:validate` (also on external files) and in CI per shipped site.

```
Diagnostic { level: "error" | "warning", path: jsonPointer, key: messageKey, params }
  // e.g. { level: "error", path: "/queryTypes/0/rules/1/when/field", key: "config.unknownField", params: { field: "sate" } }
```

Errors:
- Duplicate ids, codes or keys in any keyed array; command and query type codes compared case-folded.
- Unresolved references: picklist ids, field keys (rules, conditions, `$default`, sections, positions, presets, `picklistFilter`, `fieldMap`, `QueryType.defaults`), source ids, query type codes (commands, `alsoRun`, `quickAccess`, mappings), persona keys, roles, feature keys, token names, action keys.
- A `labelKey` missing from any locale in `locales`.
- Literals (defaults, `setDefault` values, presets, condition values) that fail canonicalisation for the target field (4.3); `$default` naming a field with no configured default; ordering operators on a field that is not number, year or date (4.2).
- `role: "type"` or `picklistFilter` on a non-picklist field; `byField` not a picklist field; a `parent` code absent from the `byField` field's picklist; cycles among `picklistFilter` references.
- A section key referenced by a field but not declared; no `base` section.
- `require` or `setDefault` targeting an unreachable field (visible false and no `show` rule targets it); a cycle among `setDefault` dependencies (4.3); a rule reading a field whose `setDefault` appears later in `rules` (one pass then equals a fixed point); a `setDefault` rule targeting a field that another field's `picklistFilter` uses as its `byField` (config.setDefaultTargetsFilterParent, #180).
- `minLength` > `maxLength`, `maxLength` > 4096, a `pattern` that does not compile, a `defaultValue` that violates its own constraints.
- `allowPlateOnly` without a field keyed `plate` or without at least one source flagged `plateOnly`.
- A nested query type that declares `alsoRun` (one level only); more than 4 `alsoRun` entries; `fieldMap` target keys not in the nested type or source keys not in the parent.
- Command positions naming fields outside its query type; `rest` not last or on a non-string field; a field both preset and positioned; an unconditionally required field with no position, preset or configured default (a preset or configured default exempts it).
- `terminal.delimiter` not exactly one printable non-alphanumeric ASCII character, or equal to `=` or space; a delimiter that appears in any `inputFormats` entry or in a date `outputFormat`; a `decimal` number field in a command position when the delimiter is `.`; a delimiter produced by a single-key shortcut (resolved on a US layout, 6.4).
- Shortcut collisions: two bindings in the same context with the same stroke sequence or where one sequence is a prefix of the other; a `global` binding collides with every context.
- Unknown `Format.type`; two mappings with equal (`queryType`, `sourceId`, `persona`, presence of `when`) keys.
- `keywordSeverityStyles` colour pairs below 4.5:1 in any theme mode; theme token pairs below their target per mode (7:1 body text for the mobile unit layout, WCAG AA elsewhere; see 6.5); an `except` phrase that does not contain its keyword.
- A delegation purpose `maxDurationMinutes` above `delegation.maxDurationMinutes`; retention days not positive.

Warnings: a site default key used by no field of any query type; a conditionally required field with no command position; a picklist literal in a condition that names a disabled code; a query type whose worst-case (part, source) count exceeds the per-submit cap of 8 (5.2). `config:validate` additionally resolves mapping paths against each mock default and scenario payload and warns on unresolved paths (see 5.4, 7). `Source.kind` against the adapter registry is checked by the API at startup, not by core.

Covers BR-001, FR-004, FR-007, FR-008, FR-031, FR-051, FR-052, NFR-001, UX-011.

### 4.2 Condition language

Structured JSON, no expression strings, no eval.

```
Condition =
  | { field, op: "eq" | "neq",               value: Literal | DefaultRef }
  | { field, op: "in" | "notIn",             value: Literal[] }
  | { field, op: "gt" | "gte" | "lt" | "lte", value: Literal | DefaultRef }   // number, year, date fields only
  | { field, op: "empty" | "notEmpty" }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
DefaultRef = { "$default": fieldKey }
```

- `field` names a `FieldDef` of the query type the condition belongs to (for `ResponseMapping.when`, its `queryType`).
- `{ "$default": key }` is that field's configured default (4.1 precedence), frozen before evaluation and never changed by `setDefault`. "State is not the site default" is `{ "field": "state", "op": "neq", "value": { "$default": "state" } }`.
- Literals are canonicalised at load with the target field's `dataType` (4.3), so `"ok"` on a picklist field becomes `"OK"` and `26` on a year field becomes `2026`. Conditions compare canonical values with strict equality, so picklist comparison is case-insensitive by construction.
- Ordering: numeric for number and year, chronological (ISO string order) for date.
- An empty field (null) is `empty`; `eq`, `in` and every ordering operator are false; `neq` and `notIn` are true.
- Subtype-style conditions are ordinary conditions on `role: "type"` fields: `{ "field": "propertyType", "op": "eq", "value": "FIREARM" }`.

Where conditions are read:

| Location | Evaluated against |
|---|---|
| `FieldRule.when`, `SectionDef.when` | Effective values during evaluation, before pruning of hidden fields (4.3) |
| `QueryTypeSource.when`, `NestedQuery.when`, `ResponseMapping.when` | Submitted values: `FormState.values`, hidden fields absent |

Covers FR-002, FR-003, FR-011, FR-032.

### 4.3 Rules engine

`evaluateForm(siteConfig, queryTypeCode, input, { now }) -> FormState`

`input` is the draft's user values as entered (`{ [fieldKey]: string | number | boolean | null }`); `now` (epoch ms) feeds the `century: "past"` rule, keeping the function pure. `siteConfig` may be a `SiteConfig` or `ClientSiteConfig`. The same function runs on the client for the form and terminal, and on the server for every submit and every nested part (see 4.6, 5.2).

```
FormState {
  queryType: code
  mode: "normal" | "plateOnly"
  sections: { key, labelKey, visible }[]
  fields: FieldState[]                              // in FieldDef order
  sources: { sourceId, selectedByDefault, plateOnly }[]   // QueryType.sources whose when holds
  values: { [fieldKey]: CanonicalValue }            // submit payload: visible fields with non-null effective value
  missingRequired: fieldKey[]
  hiddenWithValue: fieldKey[]                       // hidden fields that have a user value (4.4 valueForHiddenField)
  errors: ValidationError[]                         // 4.7; the field is params.field
  valid: boolean                                    // no errors and no missingRequired
}
FieldState {
  key, labelKey, dataType, role?, order: int
  section: sectionKey, sectionLabelKey
  visible: boolean, required: boolean
  userValue: CanonicalValue | null                  // canonicalised input; null if empty or invalid
  effectiveValue: CanonicalValue | null
  isDefault: boolean                                // userValue null and effectiveValue from a default
  options?: { code, labelKey }[]                    // picklist: enabled, filtered by picklistFilter
}
CanonicalValue = string | number | boolean          // date = ISO YYYY-MM-DD string
```

**Algorithm.** One pass, deterministic:

1. **Unknown keys.** An `input` key that is not a field of the query type produces error `validation.unknownField` (the server answers 400, see 5.2).
2. **Canonicalise** each input per `dataType`, identically for form and terminal:
   - string: trim, collapse internal whitespace runs to one space, apply `transform`, then check `charset` (`validation.invalidCharacter`), `minLength` / `maxLength` (`validation.tooShort` / `validation.tooLong`, params `{ min }` / `{ max }`) and `pattern` (`validation.patternMismatch`).
   - picklist: trim, match case-insensitively against the field's enabled codes after `picklistFilter`; result is the configured code, else `validation.notInPicklist`. Picklist fields are processed in `picklistFilter` dependency order so a filter sees its parent's canonical value.
   - number: parse per `numberKind`, else `validation.invalidNumber`.
   - year: two or four digits, else `validation.invalidYear`. Two digits resolve by `century`: `"2000"` gives 2000 plus; `"past"` gives the latest year not after `now`.
   - date: try `inputFormats` in order, then `YYYY-MM-DD` always; first valid calendar date wins, stored ISO, else `validation.invalidDate`. `YY` resolves by `century` as for years.
   - boolean: `Y`, `N`, `1`, `0`, `true`, `false`, case-insensitive, else `validation.invalidBoolean`.

   Empty after trim is null. An invalid input yields `userValue` null plus its error. Canonicalisation is idempotent: `canon(canon(x)) = canon(x)` (property-tested, see 10).
3. **Effective values.** Start with `userValue` ?? configured default for every field. Apply `setDefault` rules in config order: when the condition holds and the target's `userValue` is null, set the target's effective value to `value` (canonicalised at load). Later matching `setDefault` rules on the same target win. `setDefault` never writes to the draft and never replaces a user value.
4. **Sections.** A section is visible when its `when` is absent or holds.
5. **Visibility and required**, as two independent channels, last match wins per channel:
   - visible = the last matching `show` / `hide` rule for the field, else `FieldDef.visible`; then AND the section's visibility.
   - required = `FieldDef.required` OR any matching `require` rule; then AND visible. A hidden field is never required.
   - A `require` rule never shows a field; a `show` rule never requires one.
6. **Plate-only mode.** `mode = "plateOnly"` when `allowPlateOnly` is true, the `plate` input is non-empty, and every other input is empty. Emptiness is judged on raw input after trim (an invalid entry counts as non-empty); configured and rule defaults are ignored. In plate-only mode only the `base` section is visible (FR-010 shows Plate, State, Year and VIN; FR-012's "without displaying other fields" is read as no expanded fields), no field is required, and defaulted values such as State are still submitted. Source narrowing is the planner's job (4.6). The client sends its computed `mode` with the submit; the server recomputes and answers 400 on a mismatch (see 5.2).
7. **Prune and check.** `values` holds each visible field whose effective value is non-null; hidden fields contribute nothing, and hidden fields with a user value are listed in `hiddenWithValue`. Unless `mode` is `plateOnly`, every required field with a null effective value and no canonicalisation error is added to `missingRequired` and gets error `validation.required`.
8. **Sources.** `sources` lists `QueryType.sources` entries whose `when` holds against `values`.

Conditions in steps 3 to 5 read effective values before pruning, so a hidden field's value can still satisfy a condition; sites that need otherwise add the field's visibility condition to the dependent rule. Type-field cascades need no such care: a child type value whose parent changed fails `notInPicklist` in step 2 and reads as empty.

**Rule-set guarantees**, enforced by `validateSiteConfig` (4.1), make the single pass order-safe: no cycle among `setDefault` dependencies (an edge runs from each field a condition reads to the rule's target; `$default` references add no edge), and no rule reads a field whose `setDefault` appears later in `rules`. No `setDefault` rule targets a picklist filter parent (#180), so a child picklist's input check never runs against a parent value that setDefault supplies later in the pass.

**Messages.** Every error is a `ValidationError` `{ key, params? }` (4.7) with no prose and the field in `params.field`; the renderer resolves `key` through the locale bundle (NFR-001) and passes the field's `labelKey` for display (see 6.2). The terminal reports the same keys (4.4).

**Required tests** (table-driven, see 10): A1 (default State TX, plate only entered: `mode` plateOnly, State TX in `values`); State changed to OK with plate only (normal mode, Plate Type visible and required); Year typed with plate (normal mode, no plate-only narrowing); A2 round trip TX to OK to TX; a typed value survives a matching `setDefault`; `$default` unaffected by `setDefault`; disabled picklist codes never appear in `options`; unknown key rejected; hidden field value absent from `values`; filtered child picklist after parent change.

Covers FR-001 to FR-005, FR-008, FR-010 to FR-012, FR-031, FR-032, UX-004.

### 4.4 Terminal

Three pure functions. The canonical draft is the user values of the selected query type, held in the client store (6.7). The terminal string is a derived view of that draft; the form is another view of the same draft.

```
tokenize(siteConfig, input) -> TokenizeResult
TokenizeResult { commandCode?, queryType?, userValues: { [fieldKey]: string },
                 positionedKeys: fieldKey[], errors: ValidationError[] }

parseCommand(siteConfig, input) -> ParseResult
ParseResult { queryType?, userValues, formState?: FormState, errors: ValidationError[] }

formatCommand(siteConfig, commandCode, userValues) -> FormatResult
FormatResult { text, errors: ValidationError[], unshownCount }
```

`ValidationError` is `{ key, params? }` with the field in `params.field` (see 4.7). Every function returns all errors it finds, never only the first.

Submit from the terminal uses a fourth pure function, `checkTerminalSubmit(siteConfig, input, drafts, { now })`: it tokenizes, merges into the command's own query type draft (`mergeDraft`), runs `evaluateForm` on the merged draft rather than on the command's values alone, and returns the merged draft, its `FormState` and the errors enriched as `parseCommand` enriches them. Enter submits only when it returns no errors and a valid `FormState` (#297, #377).

**Grammar.** `CommandDef` is defined in 4.1. The delimiter is site-level, `siteConfig.terminal.delimiter` (default `.`). There is no per-command delimiter. Input is split on the delimiter; the first token is the command code, matched case-insensitively. The remaining tokens fill `CommandDef.positions` in order. `validateSiteConfig` rejects command codes that collide after case folding. Source selection stays in the panel UI in Phase 1; the command string does not name sources.

- `presets` set user values before positions are read. This is how a command selects type-level fields (`role: "type"`, see 4.1); positions may also include type fields.
- Values are trimmed. Trailing empty tokens are ignored, so `VEH.ABC123...` equals `VEH.ABC123`.
- An empty interior position leaves the user value empty; the rules engine then fills the field's configured default as its effective value (FR-054, 4.3).
- A non-empty positional token past the last position is `terminal.tooManyPositions`. Its `got` counts every positional token read before the first named token, interior empties included; trailing empties are dropped and never counted, so `VEH..A.B.C.D` reports `{ expected: 4, got: 5 }` (#296).
- Only the last position may be `{ field, rest: true }`, and only for a free-text string field. It takes the remainder of the input verbatim, delimiters included; named tokens are not recognised once a rest position has been reached. A rest remainder that is blank after trimming is a trailing empty token (`PRO.S123.FIREARM. ` equals `PRO.S123.FIREARM`). A remainder made only of delimiters is a value, kept as typed, so the empty positions before it are interior: `PRO....` sets `description` to `.` (developer ruling 09-28-26, #296).
- There is no escape or quote syntax. A delimiter inside any other value cannot be typed; `formatCommand` reports `terminal.delimiterInValue` for such a value (see below).
- Trailing named tokens `fieldKey=value` set any field of the query type, for example `VEH.ABC123.OK.plateType=PC`. A token is named when the text before its first `=` matches a field key of the command's query type, case-insensitively; otherwise it is positional. A positional token after a named token is `terminal.positionalAfterNamed`. An empty (whitespace-only) token after a named token is skipped: it sets no value and raises no error. An unknown key is `terminal.unknownField`. A named token for a field that is also positioned or preset in the same command is `terminal.duplicateField` only when the command sets that field too (a non-empty position or a preset); a named token for a positioned field the command left unfilled is accepted, so `VEH.ABC123.year=26` sets `year` (#296). There is no silent precedence.

**Values by dataType.** The terminal produces raw strings; canonicalisation per dataType happens in core before rules on both the form and terminal paths (4.3). The terminal syntax per dataType:

| dataType | Accepted tokens | `formatCommand` emits |
|---|---|---|
| `string` | any text without the delimiter (rest position excepted); `transform` and whitespace collapse applied by canonicalisation | the user value |
| `picklist` | a code, case-insensitive against enabled codes; otherwise `validation.notInPicklist` | the canonical code |
| `date` | `FieldDef.inputFormats` (default `MMDDYYYY`, `MM/DD/YYYY`, `MM-DD-YYYY`, `YYYY-MM-DD`); stored as ISO `YYYY-MM-DD` | `FieldDef.outputFormat` (default `MMDDYYYY`) |
| `year` | two or four digits; two-digit years resolve by `FieldDef.century` (4.1, 11) | four digits |
| `boolean` | `Y`, `N`, `1`, `0`, `true`, `false`, case-insensitive | `Y` or `N` |
| `number` | `integer`: optional `-` then digits; `decimal`: integer part with optional `.` fraction | canonical number |

`validateSiteConfig` rejects a date `outputFormat` that contains `terminal.delimiter`, and a `decimal` number field in a command position when `terminal.delimiter` is `.` (4.1). Dates display as MM-DD-YY in the UI (6.2); the terminal format is independent of display.

**Errors.** `tokenize` always returns the values it could read, even when it returns errors. `parseCommand` runs `tokenize`, canonicalisation and `evaluateForm`, so required and constraint errors come from the same engine as the form. Error keys:

| Key | Params | When |
|---|---|---|
| `terminal.emptyInput` | | input is blank |
| `terminal.missingDelimiter` | `input` length only | no delimiter in the input and the input is not a command code |
| `terminal.unknownCommand` | `code` | code matches no `CommandDef` (FR-055) |
| `terminal.tooManyPositions` | `expected`, `got` | a non-empty positional token lands past the last position; `got` counts every positional token, interior empties included |
| `terminal.positionalAfterNamed` | `position` | positional token after a named token |
| `terminal.unknownField` | `name` | named token key is not a field of the query type |
| `terminal.duplicateField` | `field`, `labelKey` | field set by both position or preset and a named token |
| `terminal.valueForHiddenField` | `field`, `labelKey`, `position?` | a value lands in a field the rules hide; the value is kept in the draft, not dropped, and blocks submit; raised only when the key is typed (named or positioned), a preset-only key never raises it |
| `terminal.delimiterInValue` | `field`, `labelKey`, `position` | from `formatCommand`: a non-rest value contains the delimiter |
| `validation.required` | `field`, `labelKey`, `position?` | required field empty with no default (FR-055); `position` names where to type it, absent when only a named token can set it |
| `validation.*` keys from 4.3 | `field`, `labelKey`, constraint params | `validation.notInPicklist`, `validation.invalidDate`, `validation.tooShort`, `validation.tooLong`, `validation.patternMismatch`, and so on |

Error params never carry the typed value; they carry field keys, label keys, positions and lengths, so errors can be logged and audited (see 4.7). Two exceptions carry typed text: `terminal.unknownCommand.code` and `terminal.unknownField.name` (a name typed with no command code lands there). Their params are shown to the user only and are never logged or audited; a log line or audit row names the error key alone (#296).

**Command config checks** (in `validateSiteConfig`, 4.1): a field that is unconditionally required and has no position, preset or configured default is an error; a field that some rule can make required and has no position is a warning (a named token can still supply it). Tested with `VEH.ABC123.OK` against the Appendix B plate rules: with `plateType` required when State is not the default, the result is `validation.required` for `plateType` with no position, and `VEH.ABC123.OK.plateType=PC` succeeds.

**Draft merge.** Terminal edits never replace the draft. On each parse, the command's preset fields, positioned fields and named-token fields are written into the draft (an omitted or empty position writes an empty user value); every other user value is left unchanged. A code that selects a different query type switches the draft to that query type's user values; the store keeps one draft per query type in memory, cleared on logout (6.7), so nothing is lost.

**Toggle.** Form to terminal: pick the command whose `queryType` equals the selected query type and whose `presets` all equal the draft's current type-field values; most specific (most matching presets) wins, ties go to config order. No match starts the terminal with an empty string and the draft untouched. `formatCommand` serialises user values only, never effective defaults: presets imply the code, positions are emitted in order, interior empties kept, trailing empties dropped. `unshownCount` counts non-empty user values that are neither positioned nor preset, plus preset keys whose draft value is non-empty and not canonically equal to the preset (the merge would overwrite them); the terminal shows "n fields not shown" (6.2) and those values stay in the draft. Terminal to form uses `tokenize` and the draft merge, so a failing command loses nothing.

**Round-trip property.** For any draft `D` of query type `T` and command `C` for `T` whose presets match `D`, where every positioned user value is canonical, contains no delimiter outside a rest position, and does not read as a named token (a positioned value whose text before its first `=` matches a field key would parse back as `fieldKey=value`): `merge(D, tokenize(formatCommand(C, D)))` equals `D`. Positioned user values survive format then parse exactly; unpositioned user values survive because the merge never erases them. Canonicalisation is idempotent: `canon(canon(v)) = canon(v)`. Both are property tests (10), including delimiter-bearing values in rest positions and date, boolean and number fields (NAM table tests).

Covers FR-050 (component; layout placement in 6.2), FR-051 to FR-056.

### 4.5 Response mapper, assessResult, highlighter

**Mapping selection.**

```
mapResponse(siteConfig, ctx, payload) -> MappedResult
ctx { queryType, partValues: { [fieldKey]: value }, sourceId, persona }
MappedResult { mappingIndex: number | null, elements: RenderElement[], diagnostics: Diagnostic[] }
```

`ResponseMapping`, `MappingElement` and `Format` are defined in 4.1. A mapping is a candidate when its `queryType` equals the part's query type (required), its `when` holds against the part's effective values (4.2), its `sourceId` is absent or equal, and its `persona` is absent or equal. Score: `when` present and matching +4, `sourceId` match +2, `persona` match +1. Highest score wins. `validateSiteConfig` rejects two mappings with equal keys (`queryType`, `sourceId`, `persona`, presence of `when`); two different `when` conditions that both match at equal score go to the earlier mapping in config order. No candidate yields the generic dump.

**Path language.** Dot segments, `[n]` array index, `["key.with.dots"]` bracket-quoted keys, and `[*]` projection: `warrants[*].offense` yields one value per array element. A `value` element whose path yields an array joins the items with `", "`. A `table` element's `path` must yield an array of records; each column `path` is relative to one record and yields one cell, so offense and date stay paired per row. Table is the UX-016 grid; the summary format is the set of `view: "summary"|"both"` elements, toggled against detail per UX-015.

```
RenderElement =
  | { kind: "scalar", label: { key } | { text }, value: string, view, format, highlight }
  | { kind: "table", label: { key }, view, highlight,
      columns: { labelKey, format }[], rows: string[][] }
```

An element whose path does not resolve, or a table path that yields an empty array, is omitted and adds a `Diagnostic { path, reason }`; the UI shows diagnostics only in development builds. `config:validate` resolves every mapping path against each mock default and scenario payload for its (queryType, source) and warns on unresolved paths (5.4, 7).

**Generic dump.** With no candidate mapping, every string, number and boolean leaf becomes a `scalar` with `label: { text: <path> }` and `view: "both"`, in payload order, highlight on. An unmapped result is never blank.

**Result severity.**

```
assessResult(payload, keywords) -> Assessment
Assessment { severity: "critical"|"warning"|"info" | null,
             matches: { keyword, severity, path }[] }
```

`assessResult` scans every string leaf of the raw payload, independent of the mapping, the element `highlight` flags and the selected view, with the same matching rules as `highlight`. `severity` is the maximum found. Every result card, list row and notification renders a severity badge from it with icon, marker text and colour (6.2, 6.6), so a STOLEN flag mapped `view: "detail"` or not mapped at all still shows on a summary card.

**Highlighter.** `KeywordStyle` and `SeverityStyle` are defined in 4.1.

```
highlight(text, keywords) -> Segment[]
Segment { text, severity?, keyword? }
```

- Case-insensitive, longest keyword first, with payload text and keywords normalised to NFC.
- Word boundaries are Unicode-aware: a match must not be preceded or followed by a letter or digit, implemented as `(?<![\p{L}\p{N}])` and `(?![\p{L}\p{N}])` lookarounds with the `u` flag, never `\b`.
- `except` phrases suppress a match that lies inside an occurrence of the phrase, for example `STOLEN` with `except: ["NOT STOLEN", "RECOVERED STOLEN"]`, and `WANTED` with `except: ["NOT WANTED"]`. Applies to both `highlight` and `assessResult`.
- The renderer styles a segment from `keywordSeverityStyles[severity]`. The severity `marker` (text) and `icon` are always rendered next to highlighted text, so severity never relies on colour (6.3).
- An element with `highlight: false` (for echoed input, such as the plate the user typed) renders unsegmented; `assessResult` still scans it.
- `validateSiteConfig` checks that each severity style meets 4.5:1 contrast between colour and background, and each theme mode's token pairs per 6.5 (4.1).

Covers FR-060, UX-010, UX-011, UX-015, UX-016.

### 4.6 Query planner

`planRequest(siteConfig, queryType, userValues, selectedSourceIds) -> Plan | PlanError`

```
Plan { mode: "normal" | "plateOnly", droppedSourceIds: sourceId[], parts: PlanPart[] }
PlanPart { partId: number,                 // 0 = primary; nested = alsoRun index + 1 (gaps allowed)
           parentPartId: 0 | null, origin: "primary" | "alsoRun",
           queryType, typeValues: { [fieldKey]: code },   // role:"type" fields
           values: { [fieldKey]: value },  // visible effective values only
           fieldMapApplied?: { [targetField]: sourceField },
           sourceIds: sourceId[],
           status: "planned" | "skipped", skipReasons?: ValidationError[] }
PlanError { errors: ValidationError[] }
```

Pure and deterministic. Steps:

1. **Primary.** `evaluateForm` on the user values (4.3). Any error returns `PlanError`. `values` are built only from visible effective values; hidden and unknown keys never enter a plan (5.2 rejects unknown keys with 400 before this).
2. **Eligible sources.** The query type's `sources[]` whose `when` holds against the primary effective values. `selectedSourceIds` must be a subset of the eligible set, else `plan.sourceNotAllowed { sourceId }`.
3. **Plate-only.** When `FormState.mode` is `plateOnly` (4.3), intersect the selection with eligible sources flagged `plateOnly`. A non-empty intersection narrows the selection; removed sources go to `droppedSourceIds` and the API names them in the 202 response. An empty intersection returns `plan.noPlateOnlySource`, which the API sends as 400.
4. **Nested parts.** For each `alsoRun` entry whose `when` holds against the primary effective values, in config order: copy primary effective values into the nested type's user values through `fieldMap` (`{ [targetField]: sourceField }`), then run `evaluateForm` for the nested type. Nested sources are the nested type's `sources[]` with `selectedByDefault: true` whose `when` holds against the nested effective values; the parent's selection does not carry over. The plate-only narrowing of step 3 applies to a nested part in `plateOnly` mode; an empty intersection skips the part with `plan.noPlateOnlySource` instead of rejecting, so a child never fails its parent.
5. **Skipped parts.** A nested part whose evaluation fails, or that has no sources, gets `status: "skipped"` with `skipReasons` (`plan.nestedNoSources` for the latter). The primary and other parts proceed. The API audits each skipped part (`partSkipped`, 4.7) and writes no `source_result` rows for it.

Part ids are stable: a nested part's `partId` is its `alsoRun` index plus 1, so ids may have gaps. An `alsoRun` entry whose `when` does not hold produces no part; a skipped part keeps its id.

`PlanPart.queryType` is the canonical code from the site config, not the requested string: a case-folded request for `veh` plans and records `VEH` (09-29-26, #307).

**Limits.** One nesting level, `fieldMap` references both ways and the fixed cap of 4 `alsoRun` entries are validated in 4.1; the per-submit source cap and concurrency caps are in 5.2.

All parts share one correlation ID; each (part, source) pair gets its own pending `source_result` row, keyed (correlation_id, part_id, source_id), and FR-043 status is reported per part per source (5.2, 5.5).

Covers FR-012, FR-040 to FR-042.

### 4.7 Contracts exported by core

Overridden by ADR-0003.
Overridden by ADR-0004.

Everything the API, `packages/client` and the host-integration layer must agree on is a Zod schema in `packages/core/src/contracts/`, with the TypeScript type inferred from it. The API validates on write and on send; the client validates on receipt; each schema has tests (10).

**Version constants.**

| Constant | Value | Meaning |
|---|---|---|
| `API_VERSION` | `"v1"` | URL prefix `/api/v1` (5.1) |
| `CORE_VERSION` | package semver | reported by `GET /api/v1/meta` |
| `CONFIG_SCHEMA_VERSION` | `1` | `SiteConfig.schemaVersion`; `migrateConfig` steps key on it (5.8) |
| `WS_PROTOCOL_VERSION` | `1` | `v` on every WebSocket message |
| `EMBED_PROTOCOL_VERSION` | `1` | postMessage protocol (6.9) |
| `SOURCE_ADAPTER_API_VERSION` | `1` | adapters loaded from `ADAPTER_DIR` declare it (5.4) |

`minClientVersion` in `/meta` comes from deploy config `MIN_CLIENT_VERSION` (unset means no minimum), not a core constant. The postMessage v1 message schemas (6.9), including `identityRequest`, live here too.

**Validation error and API error shape.**

```
ValidationError { key: string, params?: { [name]: string | number | boolean } }

ApiError {
  error: {
    code: ApiErrorCode,            // also the locale key "error.<code>"
    params?: { [name]: string | number },
    errors?: ValidationError[],    // present on validationFailed
    correlationId?: string,        // when the request has one
    requestId: string
  }
}
```

| `code` | HTTP | Notes |
|---|---|---|
| `validationFailed` | 400 | `errors[]` from core: `validation.*`, `terminal.*` and `plan.*` keys (4.3, 4.4, 4.6), including `validation.unknownField`, `plan.sourceNotAllowed`, `plan.noPlateOnlySource`, `plan.tooManySources { max }` |
| `unauthenticated` | 401 | no session, expired session |
| `stepUpRequired` | 403 | credential PUT/DELETE and delegation approval without fresh auth (5.6, 5.7); 403 because a 401 resets client state (6.7) |
| `mfaEnrollmentRequired` | 403 | `auth.mfaRequired` applies and the user has not enrolled (5.6) |
| `forbidden` | 403 | authenticated but role missing (admin routes, delegator role); missing `X-Requested-With` (5.9) |
| `notFound` | 404 | unknown resource, non-owner access (policy function, 5.2), feature-flagged route (5.8), a wrong, expired or used delegation code (5.7) |
| `configHashMismatch` | 409 | submitted `configHash` differs; `params.currentConfigHash`; client refetches config |
| `delegationCredentialsMissing` | 409 | approval where the officer lacks a credential; `errors[]` holds one `{ key: "delegation.credentialsMissing", params: { field: sourceId } }` per source (5.7) |
| `payloadTooLarge` | 413 | body over 32 KB or a value over 4 KB (5.9) |
| `rateLimited` | 429 | `params.retryAfterSeconds`; also sets `Retry-After` |
| `internal` | 500 | an audit write failed and the transaction rolled back (fail closed, 5.2) |
| `unavailable` | 503 | submit during SIGTERM drain (5.2) |

Every API error, including auth, delegation and config errors, uses this shape. Params never contain submitted field values, credentials or payload text. A repeated `Idempotency-Key` is not an error: it returns the original 202 (5.2).

**Source status.**

```
SourceStatus = "pending" | "returned" | "failed" | "timedOut" | "interrupted"
             | "credentialsMissing" | "credentialsRejected"
```

`pending` is the only non-terminal status. A status is written once from `pending` and never changes after (5.2). Clients treat any terminal status as final and ignore a later `pending` for the same result.

**Audit events.** `AuditEventType` is a closed union. Each type has a Zod schema for `details`, validated on every write by `AuditService.record(tx, event)` (5.5). The envelope columns (5.5) carry id (integer ordering), `type`, `at` (epoch ms UTC), `correlation_id?`, `part_id?`, the actor snapshot `{ id, email, role }`, `credential_user_id?`, `identity_source` (`local`\|`host`\|`system`) and host subject for embedded mode (6.9). `details` repeat none of these. Rows written with no user (the startup sweep, the sweeper, `configLoaded`, `purge.ts`, `lost-key.ts`, `lost-data-key.ts`, `delegationExpired`) carry the actor snapshot `{ id: "system", email: null, role: "system" }` and `identity_source` `system`.

Rule for every `details` schema: identifiers, metadata and `role: "type"` field values only. Never other field values, payload text, credentials, secrets, error message text from adapters, or free text typed by a user. Durations come from a monotonic clock. Schemas are additive-only across versions: a field may be added as optional, never removed or retyped.

Query events:

| Type | Required `details` |
|---|---|
| `submitted` (one per part) | `partId`, `parentPartId` (null for primary), `origin` (`primary`\|`alsoRun`), `queryType`, `typeValues` (every `role: "type"` field value, any depth), `selectedSourceIds`, `dispatchedSourceIds`, `droppedSourceIds`, `plateOnly` (boolean), `configHash`; for `alsoRun` also `fieldMapApplied` (field keys only) |
| `acknowledged` | `acknowledgedAt` (epoch ms), `ackLatencyMs`, `partCount` |
| `sourceDispatched` | `partId`, `sourceId`, `resultId`, `credentialOwnerUserId` (null when the source needs none), `delegationId` (nullable), `adapterKind` |
| `sourceResponded` | `partId`, `sourceId`, `resultId`, `status` (terminal `SourceStatus` other than `interrupted`), `latencyMs`, `credentialOwnerUserId`, `delegationId`, `adapterKind`, `errorCode?` (enumerated adapter error code, never adapter text) |
| `interrupted` | `partId`, `sourceId`, `resultId`, `reason: "processRestart"` |
| `partSkipped` | `partId`, `parentPartId`, `queryType`, `typeValues`, `reasons` (`ValidationError[]`, params limited to field keys, label keys and positions) |
| `deletedFromView` (one per real `result_visibility` insert) | `resultId`, `partId`, `sourceId` |
| `adminViewed` | `correlationId`, `includeHidden` (boolean), `viewerBasis` (`admin`\|`credentialOwner`); the delegating officer's reads use `credentialOwner` (5.2) |

`credentialOwnerUserId` and `delegationId` are copied from the step-3 snapshot on the pending row (5.2), not resolved again.

Auth events (Better Auth hooks, the session service and the sweeper, 5.2, 5.6):

| Type | Required `details` |
|---|---|
| `loginSucceeded` | `method` (`password`\|`totp`\|`hostJwt`), `sessionId`, `clientIp` |
| `loginFailed` | `targetUserId` (nullable), `reason` (`badPassword`\|`unknownAccount`\|`mfaFailed`\|`lockedOut`\|`hostJwtInvalid`), `clientIp`, `lockoutUntil?` (set when this failure starts a lockout) |
| `logout` | `sessionId` |
| `sessionRevoked` | `sessionId`, `reason` (`userDisabled`\|`admin`\|`expired`); `expired` is written by the sweeper for idle or absolute expiry (5.2) |
| `mfaEnrolled` | `method: "totp"` |
| `mfaDisabled` | `method: "totp"`, `byUserId` |

Credential events (`credential_user_id` in the envelope is the owner):

| Type | Required `details` |
|---|---|
| `credentialsCreated` | `sourceId`, `keyVersion` |
| `credentialsChanged` | `sourceId`, `keyVersion` |
| `credentialsDeleted` | `sourceId`, `reason` (`user`\|`userDisabled`\|`keyLost`) |
| `credentialsInvalidated` | `sourceId`, `keyVersion`, `reason` (`decryptFailed`\|`keyLost`) |

Delegation events (5.7). The request and approval flow uses these events (there is no single delegation-creation event):

| Type | Required `details` |
|---|---|
| `delegationRequested` | `delegationId`, `purpose`, `traineeUserId`, `traineeSessionId`, `sourceIds`, `durationMinutes` |
| `delegationApproved` | `delegationId`, `purpose`, `traineeUserId`, `officerUserId`, `sourceIds` (as confirmed or narrowed), `durationMinutes`, `expiresAt`, `authMethod` (`freshPassword`\|`totp`) |
| `delegationVerifyFailed` | `officerUserId`, `reason` (`wrongCode`\|`expiredCode`\|`roleMissing`\|`missingCredentials`\|`stepUpFailed`\|`rateLimited`), `missingSourceIds?` |
| `delegationRequestExpired` | `delegationId` |
| `delegationRevoked` | `delegationId`, `revokedByUserId` (nullable for automatic), `reason` (`trainee`\|`officer`\|`admin`\|`sessionEnded`\|`superseded`\|`userDisabled`\|`keyLost`) |
| `delegationExpired` | `delegationId` |

Admin and ops events:

| Type | Required `details` |
|---|---|
| `roleChanged` | `targetUserId`, `role`, `change` (`granted`\|`revoked`), `via: "grant-role"` |
| `auditViewed` | `filters` (`userId?`, `correlationId?`, `type?`, `from`, `to`), `cursor?`, `rowCount` |
| `auditExported` | `filters`, `rowCount`, `format: "ndjson"` |
| `configLoaded` | `siteId`, `configHash`, `configSchemaVersion`, `coreVersion`, `extendsChain` (site ids) |
| `retentionPurged` | `scope` (`payload`\|`values`), `reason` (`retention`\|`keyLost`), `olderThan` (epoch ms, null for `keyLost`), `requestCount`, `keysDeleted` |
| `userDisabled` | `targetUserId`, `sessionsRevoked`, `delegationsRevoked`, `credentialsDeleted` (counts) |

**WebSocket messages.** Every message has `v: WS_PROTOCOL_VERSION` and `type`. Server events that change state carry `seq`, the per-user sequence from `event_log` (5.3). Events are reference-only: they never carry payloads or field values; the client fetches content through the policy-checked `GET /api/v1/queries/:correlationId`, which filters hidden results.

Client to server:

```
hello      { v, type: "hello", lastSeq: number | null }
ping       { v, type: "ping", nonce }                       // every 20 s
ackReceipt { v, type: "ackReceipt", correlationId, receivedAt }  // NFR-004 metric, not audit
```

Server to client:

```
welcome        { v, type: "welcome", latestSeq }
pong           { v, type: "pong", nonce, serverTime }
sourceStatus   { v, type: "sourceStatus", seq, at, correlationId, partId, sourceId,
                 resultId, status: SourceStatus }
resultHidden   { v, type: "resultHidden", seq, at, correlationId, resultIds: string[] }
delegationChanged { v, type: "delegationChanged", seq, at, delegationId,
                    status: "pending"|"active"|"revoked"|"expired"|"requestExpired",
                    viewerRole: "trainee"|"officer" }
resync         { v, type: "resync", reason: "tooOld"|"tooMany"|"unknownCursor", latestSeq }
```

- `sourceStatus` is the only result event; there is no `ack` event (the 202 drives the ack toast) and no separate result event. Status is forward-only as above. An event that arrives before the POST resolves creates a placeholder entry (6.7).
- Clients dedup by a `seq` high-water mark: an event with `seq` at or below the mark is ignored.
- After `hello`, the server sends events with `seq > lastSeq`, excluding hidden results, within the replay caps (24 h or 500 events, 5.3); beyond them it sends `resync` and the client refetches over HTTP and sets its mark to `latestSeq`. `lastSeq: null` replays nothing.
- The client marks the socket stale after 2 missed `pong`s (6.8).
- `delegationChanged` is the single event for every delegation transition. It goes to both parties' sockets; `viewerRole` says which side the receiver is. Clients refetch `GET /api/v1/delegations`.
- The server closes the socket with code 4001 when its session ends (logout, expiry, revocation) and 4003 on a rejected Origin.

Covers SEC-010 to SEC-014, FR-043, FR-062, FR-064, NFR-003, NFR-004 (contract side).

## 5 API

### 5.1 Routes

All routes live under `/api/v1`. Every body, query string and header the route reads is validated with Zod; OpenAPI is generated from the same schemas and served at `/api/v1/openapi.json` with a viewer at `/api/v1/docs` (BR-007). OpenAPI is generated from the route definitions, independent of flags and env: flagged routes carry `x-feature: <key>` and the dev route carries `x-requires: ALLOW_MOCK_SOURCES`. Cross-cutting rules: state-changing non-auth routes require `X-Requested-With` (5.9); every `/api` response carries `Cache-Control: no-store` (5.9); a route behind a disabled `features` flag returns 404 (5.8); read and hide access to query data goes through one policy function (5.2). "Session" means a principal resolved by `IdentityService.resolve` (5.5, 5.6).

| Route | Access | Purpose |
|---|---|---|
| `POST/GET /api/v1/auth/*` | public | Better Auth handlers (5.6); 404 unless `IDENTITY_MODES` lists `standalone` |
| `POST /api/v1/auth/embedded` | public, `X-Requested-With` | Host JWT to module session (5.6); not a Better Auth handler; 404 unless `IDENTITY_MODES` lists `embedded` |
| `GET /api/v1/meta` | public | `{ apiVersion, coreVersion, configSchemaVersion, configHash, minClientVersion }`; the version check precedes login; client refuses to run below `minClientVersion` |
| `GET /api/v1/config` | session | `ClientSiteConfig` (allowlist, 4.1); never `Source.server` or mock data |
| `GET /api/v1/locales/:locale` | public | Locale bundle, UI strings only (5.8) |
| `POST /api/v1/queries` | session | Submit. Header `Idempotency-Key` required. Body `{ queryType, values, sourceIds, mode, configHash }`. 202 `{ correlationId, acknowledgedAt, parts[] }`; errors per 4.7 (400, 409, 413, 429, 503) (5.2) |
| `GET /api/v1/queries` | session, own | Caller's requests, cursor-paged, parts nested with per-source status, hidden results excluded |
| `GET /api/v1/queries/:correlationId` | policy | One request, parts, per-source status and payloads, hidden results excluded; a shredded part or result returns `purged: true` with no values or payload (5.5) |
| `POST /api/v1/results/hide` | policy, owner only | Delete from view. Body `{ resultIds[] }` |
| `WS /api/v1/ws` | session, Origin checked | Result feed (5.3) |
| `GET/PUT /api/v1/me/preferences` | session | `user_preference` row (5.5) |
| `POST /api/v1/me/step-up` | session | Password re-entry; sets `stepUpAt` on the session (5.6) |
| `GET /api/v1/me/credentials` | session | List of own credential summaries, never secrets (5.7) |
| `GET/PUT/DELETE /api/v1/me/credentials/:sourceId` | session; PUT/DELETE step-up | One state-system credential (5.7) |
| `GET /api/v1/me/delegated-queries` | session | Officer view: parts run under the caller's credentials, read-only (5.7) |
| `POST /api/v1/delegations` | session | Trainee requests `{ purpose, sourceIds[], durationMinutes }`; returns `{ id, code, expiresAt }` (5.7) |
| `POST /api/v1/delegations/redeem` | session, redemption limiter | Officer redeems `{ code }`; returns the preview (5.7) |
| `POST /api/v1/delegations/:id/approve` | session, step-up | Officer confirms or narrows sources and duration (5.7) |
| `GET /api/v1/delegations` | session | Delegations where caller is either party, active plus last 24h (5.7) |
| `DELETE /api/v1/delegations/:id` | either party or admin | Revoke, audited (5.7) |
| `GET /api/v1/admin/audit` | admin | Filters: user (actor OR credential owner), correlation ID, type; required window <= 31 days; cursor, limit <= 200; writes `auditViewed` |
| `GET /api/v1/admin/audit/export` | admin | Same filters, NDJSON stream; writes `auditExported` |
| `GET /api/v1/admin/queries/:correlationId?includeHidden=true` | admin | Request with payloads including hidden results (FR-063); writes `adminViewed` with `viewerBasis: "admin"` |
| `PUT /api/v1/dev/mock-credential-state` | admin; exists only when `ALLOW_MOCK_SOURCES=true` | Set `mock_credential_state` for (user, source) (5.4) |
| `GET /api/v1/health` | public | Liveness for Docker healthcheck; no data |

Web routes are served from the same process: `/`, `/embed` (6.9), `/delegate` (standalone only, 5.7) and `/settings/credentials/:sourceId`. There is no unversioned `/api` alias.

Covers BR-007, FR-062, FR-063.

### 5.2 Query lifecycle

Vocabulary: a submit has one correlation ID (UUIDv7). The plan (4.6) splits it into parts: `part_id` 0 is the primary and each `alsoRun` child's id is its `alsoRun` index plus 1 (one nesting level, at most 4 children; 4.6). Each (part, source) pair is one `source_result` row with its own `result_id`.

Steps for `POST /api/v1/queries`:

1. **Admission.** Resolve principal (5.6). Check `X-Requested-With`, body cap 32 KB, per-value cap 4 KB (413 `payloadTooLarge`), per-user rate limit (default 30 per minute, `rate_limit` table, 429). Require `Idempotency-Key`. If a `query_request` row with (user_id, idempotency_key) exists, return its original 202 body and stop; no new writes. The replayed body is rebuilt from the part rows, their `source_result` rows and the `acknowledged` audit row (found through the `correlation_id` index). A concurrent duplicate that loses the unique-index race does the same.
2. **Validation and plan (no writes).** Reject 409 `configHashMismatch` if `configHash` differs from the loaded config (5.8). Run `evaluateForm` and `planRequest` server-side (4.3, 4.6); an unknown query type or key, a `mode` mismatch and plan errors are 400 per 4.7. Total dispatched (part, source) pairs across all parts are capped at 8; over the cap is 400 `plan.tooManySources { max }`. Persisted and dispatched values are built only from the server `FormState`'s visible effective values. The raw body is never persisted or logged.
3. **Credential snapshot (no writes).** For each (part, source) with `requiresCredentials`: an active delegation matching (current session_id, source_id) wins, giving the officer as `credential_user_id` plus `delegation_id`; otherwise the caller's own `state_credential`; otherwise none. Only ownership is resolved here; decryption happens in dispatch (5.7). This snapshot is authoritative for the submit: later revocation or expiry does not change it.
4. **Transaction T1 (acknowledge).** One SQLite transaction:
   - insert two `request_key` rows (fresh DEKs for scopes `values` and `payload`, wrapped under `DATA_KEY`, 5.5);
   - insert one `query_request` row per part (values encrypted under the `values` DEK; skipped parts carry `skipped_reason`);
   - insert one `pending` `source_result` per dispatched (part, source) with `credential_user_id`, `delegation_id`, `adapter_kind`;
   - through `AuditService.record`, audit rows per 4.7 in this order: `submitted` per part, `partSkipped` per skipped part, `sourceDispatched` per (part, source) (written here, at plan commit, not at the adapter call), then `acknowledged` carrying `acknowledged_at`.

   `acknowledged_at` is taken inside T1 as epoch ms. Any audit write failure rolls back T1 and returns 500 `internal` (fail closed). Only after commit does the server return 202 `{ correlationId, acknowledgedAt, parts: [{ partId, queryType, status: "dispatched"|"skipped", sourceIds, droppedSourceIds }] }` with a `Server-Timing` header. NFR-004 split: server target 200 ms from request receipt to 202; end-to-end measured from the client's ack-receipt message over the WebSocket (5.3), recorded as a metric log line, not an audit row.
5. **Dispatch (in-process, after commit).** The dispatcher owns all deadlines. Sources within a part run in parallel; parts run in parallel. Concurrency caps: per source default 4, global default 32; excess jobs wait in memory. Each deadline is `acknowledged_at + timeoutMs`, so queue wait counts against it. Per job: no credential when required -> outcome `credentialsMissing` without calling the adapter; decryption failure -> `credentialsInvalidated` audit and outcome `credentialsMissing`; otherwise `Promise.race(adapter.query(...), deadline)`, then abort the signal on deadline. A settlement after the deadline is logged (no payload) and never changes status. No automatic retries; "retry this source" is a new submit for that source (5.7).
6. **Transaction T2 (one per outcome).** Update the `source_result` row `WHERE result_id = ? AND status = 'pending'` (write-once), set `returned` (payload encrypted under the `payload` DEK), `failed`, `timedOut` (sets `timed_out_at`), `credentialsMissing` or `credentialsRejected`, and `received_at`; write `sourceResponded` (source, status, latency from the monotonic clock, credential owner, delegation id, `adapter_kind`); on a credentialed call update `state_credential.last_status` and `last_verified_at`; append a `sourceStatus` row to `event_log`. If the update matches no row, nothing else is written. After commit, `EventBus.publish` pushes the event (5.3). If T2 fails, the dispatcher logs it and the process exits non-zero (fail closed); the row stays `pending` and the startup sweep marks it `interrupted`, so nothing is lost.
7. **Client.** The 202 alone drives the ack toast. `sourceStatus` events tell the client which result to fetch through `GET /api/v1/queries/:correlationId` (6.7).

**Startup sweep.** Before the server listens, one transaction sets every `pending` `source_result` to `interrupted`, writes an `interrupted` audit row per result (system actor, 4.7) and an `event_log` row per owner; clients receive them on replay. Nothing is re-dispatched.

**Sweeper.** One in-process sweeper runs every 60 s. It (a) marks pending delegation requests past their deadline `requestExpired` and writes `delegationRequestExpired`; (b) marks active delegations past `expires_at` `expired` and writes `delegationExpired`; (c) deletes sessions past the idle or absolute limit, writes `sessionRevoked { reason: "expired" }`, revokes delegations bound to them with reason `sessionEnded` and signals `EventBus.onSessionEnded` (5.5), which closes the session's sockets with 4001; (d) once an hour, prunes `event_log` rows older than 24 h. Step-3 resolution still checks `expires_at` and session liveness directly, so sweep lag never grants access.

**SIGTERM drain.** Stop accepting `POST /api/v1/queries` (503 `unavailable`) and new WebSocket upgrades; let in-flight dispatch reach outcome or deadline, bounded by the maximum configured `timeoutMs` plus 5 s; then close sockets and exit. Compose `stop_grace_period` exceeds that bound (8.3). Anything still pending is swept at next start.

**Access policy.** One function, `authorizeQueryAccess(principal, correlationId, action: "read"|"hide")`, used by every query route and by WebSocket delivery:
- owner: read and hide;
- admin: read through the admin route only, audited `adminViewed` with `viewerBasis: "admin"`; never hide;
- delegating officer: read-only on (part, source) rows whose `credential_user_id` is the officer, via `GET /api/v1/me/delegated-queries`, audited `adminViewed` with `viewerBasis: "credentialOwner"`;
- anyone else: 404, never 403. The correlation ID is an identifier, not a capability.

**Hide.** `POST /api/v1/results/hide { resultIds[] }` runs in one transaction. Every id must pass the owner check or the whole call is 404. Inserts use `ON CONFLICT DO NOTHING`; each row actually inserted writes one `deletedFromView` audit row (result id, correlation ID, part, source, actor) and one `resultHidden` `event_log` row, pushed after commit so the owner's other devices drop it. Every read path, including replay, filters `result_visibility`.

Covers FR-040 to FR-044, FR-062, FR-064, FR-065, SEC-010 to SEC-012, SEC-014, NFR-002, NFR-004.

### 5.3 Result feed

WebSocket at `/api/v1/ws`. WebSocket rather than SSE because React Native supports it without a polyfill.

**Upgrade.** Rejected unless:
- `Origin` equals the deployed origin (dev origins accepted only when `NODE_ENV=development`); or
- `Origin` is absent and the request carries `Authorization: Bearer` (native). A token in the query string is never accepted.

Browser sessions authenticate with the `__Host-` prefixed session cookie (5.6). Each socket is bound to its session id and closed with 4001 on logout, session expiry, session revocation or user disable, through `EventBus.onSessionEnded` (5.5).

**Messages:** 4.7.

**Replay.** `seq` is per user, monotonically increasing, assigned inside the writing transaction (single writer). On `hello` the server sends `event_log` rows with `seq > lastSeq`, created within the last 24 h, skipping `sourceStatus` for results the user has hidden, up to 500 events. If `lastSeq` is unknown, older than the 24 h window, or more than 500 events are due, the server sends `resync` and the client refetches its list over HTTP. The server closes a socket that has sent no `ping` for 60 s. `event_log` rows older than 24 h are pruned at startup, by `scripts/ops/purge.ts`, and hourly by the sweeper (5.2).

Delivery is at-least-once over intermittent links without an external broker.

Covers FR-043, FR-062, FR-065 (foreground), SEC-014, NFR-003.

### 5.4 Sources

**Adapter API v1.**

```
interface SourceAdapter {
  query(req: SourceRequest, creds: Secret<Credentials> | null, signal: AbortSignal): Promise<SourcePayload>
}
SourceRequest { correlationId, partId, sourceId, queryType, values }    // visible effective values of the part
Credentials   { username, secret }
class SourceError { code: "credentialsRejected" | "failed" }            // anything else thrown -> failed
AdapterModule { apiVersion: 1, kind: string, create(settings: unknown): SourceAdapter }
```

`creds.reveal()` is called only at the adapter's wire boundary (5.7). The dispatcher enforces the deadline (5.2), so an adapter that ignores `signal` cannot hold a status open.

**Registry.** The mock adapter (`kind: "mock"`) is built in. Other adapters load at startup from `ADAPTER_DIR` (a mounted volume): each module default-exports an `AdapterModule`; a wrong `apiVersion` or duplicate `kind` fails startup. `create` receives `Source.server`, the server-only settings never sent to clients. Adding a site adapter never rebuilds the image.

**Kind.** `Source.kind` is required, with no default. Startup fails if any source names a kind not in the registry, or names `mock` while `ALLOW_MOCK_SOURCES` is not `true`. `ALLOW_MOCK_SOURCES=true` is set only in dev, CI and the demo deployment. The resolved kind is stored as `source_result.adapter_kind` and in `sourceResponded` details. A config with no `kind` fails to load (tested).

**Mock files.** Site configs carry no fixtures. Mock behaviour lives in `packages/config/mock/<siteId>.json` (volume-supplied in deploy, 8), loaded only when mocks are allowed. `example-ok` has its own file. A mock source with no spec in the site's mock file is a validation error.

```
MockFile   { siteId, sources: { [sourceId]: MockSource } }
MockSource { latencyMs: [min, max],
             responses: { queryType, types?: { [typeFieldKey]: code },
                          default: SourcePayload,
                          scenarios: { when: { [fieldKey]: value },
                                       respond?: SourcePayload,
                                       behavior?: "timeout" | "error" | "credentialsRejected" }[] }[] }
```

Matching is keyed by (sourceId, queryType, type-field values): pick the `responses` entry for the part's query type whose `types` all match, most matching types wins; within it the first scenario whose `when` equals the part's canonicalised values wins, else `default`. A nested part matches on its mapped values under the nested query type, so a scenario seeded for the nested type does not fire on the parent. `timeout` never settles; `error` throws `failed`.

**Credential state.** Missing credentials never reach an adapter (5.2 step 5). The mock adapter reads `mock_credential_state` (user, source, `valid`|`expired`|`rejected`; no row = `valid`) for the snapshot's credential owner and throws `credentialsRejected` for `expired` or `rejected`. The seed and `PUT /api/v1/dev/mock-credential-state` set it. No stored secret value has meaning to the mock.

**Default site scenarios** (the site is in 7). Plate `ZZ-0001` returns a STOLEN hit. Plate `ABC123` returns a clean no-record (A4 parse). Plate `TIMEOUT` times out on exactly one of the two default sources (B1). Plate `FAIL1` errors. Last name `WANTED` returns a WANTED hit on the nested wanted query type only (B2).

**Fixture policy** (also in `docs/site-config.md`). Every payload in a mock file is fictitious by construction:
- plates use the reserved format `ZZ-####`;
- VINs fail the ISO 3779 check digit;
- DOBs fall in 1901 (the `1901-01-01` family);
- names come from a synthetic corpus (Testerson, Sampleworth, ...);
- street addresses are on Example Ave.

Trigger values in `when` (such as `ABC123`, `TIMEOUT`) are inputs, not records, and are exempt. Payloads are produced by `scripts/mock-data/generate.ts` (committed). `config:validate` rejects payload violations, detecting fields by leaf key name (`plate`, `vin`, `dob`, name and address keys, listed in `docs/site-config.md`); it also checks that every (queryType, mock source) pair has a `default` and warns where its ResponseMapping paths do not resolve against the default and scenario payloads (4.5).

Covers FR-043, FR-044, SEC-002.

### 5.5 Persistence

SQLite through libSQL and Drizzle, one file on `/data`. Migrations generated by drizzle-kit, applied at process start, expand-then-contract (9).

**Connection.** Whole-database encryption through libSQL `encryptionKey`, read from the `DB_ENCRYPTION_KEY` Docker secret file. `DB_ENCRYPTION_KEY`, `CREDENTIAL_KEY` (5.7) and `DATA_KEY` (below) are three separate Docker secret files; losing one never affects the others, and none is ever stored on `/data`. Opening the database without `DB_ENCRYPTION_KEY` fails (tested). Pragmas: `journal_mode=WAL`, `synchronous=FULL`, `secure_delete=ON`, `busy_timeout=5000`, `foreign_keys=ON`.

**Conventions.** Every timestamp is an INTEGER of epoch milliseconds UTC. Durations come from the monotonic clock and live in audit `details`. Ids are UUIDv7 text unless stated.

**Tables.**

- Better Auth: `user` (plus `role`, `disabled_at`, `identity_source` (`local`|`host`), `host_issuer` and `host_subject` nullable, UNIQUE (`host_issuer`, `host_subject`)), `session` (plus `step_up_at` and `host_token_exp` nullable), `account`, `verification`, `two_factor` (M3). Owned by Better Auth (5.6).
- `query_request`, insert-once (trigger aborts UPDATE):
  `correlation_id`, `part_id` INTEGER, PK (`correlation_id`, `part_id`); `user_id`; `parent_part_id` nullable; `origin` (`primary`|`alsoRun`); `query_type`; `type_values` JSON (`role:"type"` field values only); `values_ciphertext`, `values_iv`, `values_tag` (under the request's `values` DEK); `plate_only` INTEGER; `selected_source_ids` JSON; `dropped_source_ids` JSON; `skipped_reason` nullable; `config_hash`; `idempotency_key` (part 0 only); `submitted_at`. No `acknowledged_at` (it lives in the `acknowledged` audit row) and no `credential_user_id` (it lives per `source_result`).
- `source_result`:
  `result_id` PK; `correlation_id`, `part_id`, `source_id`, UNIQUE (`correlation_id`, `part_id`, `source_id`); `user_id` (request owner); `status` (`pending`|`returned`|`failed`|`timedOut`|`credentialsMissing`|`credentialsRejected`|`interrupted`); `credential_user_id` nullable; `delegation_id` nullable; `adapter_kind`; `payload_ciphertext`, `payload_iv`, `payload_tag` nullable (under the request's `payload` DEK); `error_code` nullable (no free text); `created_at`; `received_at` nullable; `timed_out_at` nullable. A trigger aborts any UPDATE whose old status is not `pending` (write-once). Rows are never deleted by application code (FR-063).
- `result_visibility`: `result_id` FK, `user_id`, `hidden_at`; PK (`result_id`, `user_id`). Delete-from-view inserts here with `ON CONFLICT DO NOTHING`.
- `event_log`: `user_id`, `seq` INTEGER, PK (`user_id`, `seq`); `type`; `correlation_id`, `part_id`, `source_id`, `result_id`, `delegation_id`, each nullable; `created_at`. Serves as the outbox for `EventBus`.
- `audit_event`: `id` INTEGER PK AUTOINCREMENT (ordering is by `id`, never by `at`); `type`; `at`; `correlation_id`, `part_id` nullable; `actor_user_id`, `actor_email` nullable, `actor_role` (snapshot, no FK to `user`; the system actor is `system`, 4.7); `credential_user_id` nullable; `identity_source` (`local`|`host`|`system`); `host_subject` nullable; source and delegation ids live in `details`; `details` JSON validated by the per-type schema (4.7). `details` holds identifiers, metadata and `role:"type"` values only, never field values or payloads.
  Triggers `audit_event_no_update` and `audit_event_no_delete` `RAISE(ABORT)`. At startup the server checks `sqlite_master` for both and refuses to serve if either is missing. Migrations may only CREATE, ADD a nullable COLUMN or CREATE INDEX on this table, enforced in CI (9.2). Hash chaining is deferred (12.6).
- `state_credential` (5.7): `user_id`, `source_id`, PK both; `ciphertext`, `iv`, `auth_tag`, `key_version`, `username_hint`, `updated_at`, `last_verified_at` nullable, `last_status` nullable.
- `credential_delegation` (5.7), one row per delegation lifecycle: `id`; `purpose`; `trainee_user_id`; `session_id` (trainee session); `officer_user_id` nullable until redeemed; `code_hash`; `status` (`pending`|`active`|`revoked`|`expired`|`requestExpired`); `requested_source_ids` JSON; `requested_minutes`; `approved_minutes` nullable; `created_at`; `redeemed_at`, `approved_at` nullable; `expires_at`; `ended_at`, `ended_by`, `end_reason` nullable (`end_reason` uses the `delegationRevoked.reason` enum, 4.7).
- `credential_delegation_source`: `delegation_id`, `source_id`, PK both; `session_id`; `active` INTEGER. Partial unique index on (`session_id`, `source_id`) WHERE `active = 1`: one active delegation per trainee session per source.
- `request_key`: `correlation_id`, `scope` (`values`|`payload`), PK both; `wrapped_dek`, `iv`, `auth_tag`, `key_version`; `created_at`. Each DEK is wrapped directly under `DATA_KEY`, the third Docker secret file, kept apart from `CREDENTIAL_KEY` so losing one key never affects the other.
- `key_canary` (5.7): `key_name` PK (`credential`|`data`); `ciphertext`, `iv`, `auth_tag`, `key_version`; `created_at`. One row per key, written under that key on first boot.
- `user_preference`: `user_id` PK; `layout` JSON (orientation, terminal `toggle`|`pane`); `default_view`; `persona_override` nullable; `theme_mode`; `locale`; `updated_at`.
- `rate_limit`: `key` PK (for example `login:ip:<ip>`, `login:acct:<email>`, `queries:user:<id>`, `delegationCode:officer:<id>`); `window_start`; `count`; `locked_until` nullable. Thresholds in 5.6 and 5.2.
- `mock_credential_state`: `user_id`, `source_id`, PK both; `state` (`valid`|`expired`|`rejected`). Read only by the mock adapter.

**Indexes.** `query_request`: UNIQUE (`user_id`, `idempotency_key`) WHERE `part_id = 0`; (`user_id`, `submitted_at`). `source_result`: (`user_id`, `created_at`); (`credential_user_id`, `created_at`); (`status`) for the sweep. `event_log`: (`created_at`). `audit_event`: (`at`), (`actor_user_id`, `at`), (`credential_user_id`, `at`), (`correlation_id`), (`type`, `at`).

**Retention.** Values and payloads are encrypted under two per-request DEKs (`request_key` scopes `values` and `payload`), so each can be crypto-shredded on its own clock while the audit trail and metadata stay. `scripts/ops/purge.ts` deletes expired `request_key` rows by scope per `SiteConfig.retention { payloadDays, valuesDays }` (`null` = keep, as shipped), writes `retentionPurged` and ends with `wal_checkpoint(TRUNCATE)`. A read of a shredded part or result returns `purged: true` with no values or payload, admin `includeHidden` reads included. `request_key` and DEK encryption ship with the first `query_request` in M1 P2; the `retention` config block lands in M2; `purge.ts` ships in M3. Audit rows are kept indefinitely (11); a user row may be hard-deleted by ops script any time after disable, because audit carries the actor snapshot and has no foreign key.

**Seam interfaces.** All code goes through these; each ships a shared contract-test suite that local and future Shared Platform implementations must pass.

```
interface AuditService {
  record(tx: Tx, event: AuditEvent): Promise<{ id: number }>   // same txn as the change it audits; throws -> caller rolls back
}
interface IdentityService {
  resolve(req: Request): Promise<Principal | null>             // standalone: Better Auth session; embedded: host JWT (5.6)
}
Principal { userId, email, role: Role, sessionId, identitySource: "local" | "host", hostSubject?,
            authenticatedAt, stepUpAt?, hostTokenExp? }            // single role, matching the actor snapshot
interface EventBus {
  publish(userId: string, event: WsEvent): void                // called only after the event_log row commits
  subscribe(userId: string, handler: (e: WsEvent) => void): () => void
  onSessionEnded(sessionId: string, handler: () => void): () => void   // internal signal; closes sockets (5.3)
}
interface EntityStore {                                        // FR-061 write-back, B6 later; local impl rejects NotImplemented
  appendSupplemental(principal: Principal, target: { recordType: string, recordId: string }, resultIds: string[]): Promise<void>
}
```

**Scale limit.** Single node is a hard limit (2); the NFR-002 ceiling is the dispatch caps (11); risk in 14.

Covers FR-061 (interface only), FR-062, FR-063, SEC-010, SEC-013, SEC-021, PLT-001 to PLT-005, PLT-008.

### 5.6 Authentication

Two identity modes behind `IdentityService.resolve(req) -> Principal` (5.5). Every route and the WebSocket upgrade (5.3) authenticate through it; no route reads a cookie or token directly.

**Standalone mode** (the demo app). Better Auth with email plus password, mounted at `/api/v1/auth/*`; its password routes return 404 unless `IDENTITY_MODES` lists `standalone` (8.2). Password hashing is Better Auth's default (scrypt). Web sessions use a `__Host-` prefixed cookie: httpOnly, Secure, `Path=/`, no `Domain`, SameSite=Lax. Native uses the Better Auth Expo plugin; the bearer token lives in SecureStore only and travels only in the `Authorization` header, never in a query string (5.3, 6.10).

**Embedded mode** (a host CAD product frames the module, 6.9). `/embed` and `POST /api/v1/auth/embedded` return 404 unless `IDENTITY_MODES` lists `embedded` and the issuer, audience and JWKS URL are set in deploy config (8.2). The host passes a host-issued JWT to the module over postMessage. `IdentityService` validates signature, `iss`, `aud` and `exp` against deploy config and takes roles from `SiteConfig.auth.embedded.roleClaims` (4.1). Embedded principals are separate `user` rows keyed (`iss`, `sub`) with `identity_source = host` and no local password; they are never linked to password accounts. The module presents the JWT to `POST /api/v1/auth/embedded`, which issues an ordinary module session carried in a `__Host-` cookie with `SameSite=None; Secure; Partitioned`, because the frame is third-party to the host and a browser cannot send an `Authorization` header on a WebSocket (risk in 14). When a live module session presents a token for the same (`iss`, `sub`), the call extends that session's `hostTokenExp` and nothing else. The session ends at the earliest of host `exp`, the absolute limit and the idle limit; the module then asks the host for a token (`identityRequest`, 6.9) and a new session starts with its own `loginSucceeded { method: "hostJwt" }`. Delegations bound to the old session end `sessionEnded`, as in standalone. Audit rows carry `identity_source` and the host subject. `Principal` is defined in 5.5.

**Session limits** from `SiteConfig.auth.session` (4.1): absolute 12h, idle 30 min, defaults `{ absoluteMinutes: 720, idleMinutes: 30 }`. The same limits apply to native bearer sessions and embedded sessions. Only user-initiated requests refresh the idle clock: requests carrying `X-Background: 1` (pending refetches, resync refetches, health polls; 6.8) and WebSocket pings never do. The sweeper (5.2) ends sessions past either limit and writes `sessionRevoked { reason: "expired" }`. Expiry, logout and revocation close the session's sockets (5.3), revoke delegations bound to it (5.7) and reset client state (6.7).

**Rate limiting and lockout.** Client IP is read from `CF-Connecting-IP`. The header is trusted only because cloudflared is the sole ingress and the app port is not published on the host (8); outside production the socket address is used. The limiter is keyed by IP and by target account and stored in the `rate_limit` table (5.5), so it survives redeploys. Thresholds:

| Key | Limit | On breach |
|---|---|---|
| Target account, failed sign-ins | 10 per 15 min | Account locked 15 min; further attempts rejected without password check |
| Client IP, auth requests | 100 per 15 min | 429 for the rest of the window |
| Officer, failed delegation code redemptions (5.7) | 5 per 15 min | Redemption blocked 15 min |

Lockouts are audited: the `loginFailed` row whose failure starts a lockout carries `lockoutUntil` (4.7).

**Auth audit.** Better Auth hooks write `loginSucceeded`, `loginFailed`, `logout`, `mfaEnrolled` and `mfaDisabled`; the session service and the sweeper write `sessionRevoked` (4.7).

**MFA.** TOTP through the Better Auth two-factor plugin (M3, SEC-005). `SiteConfig.auth.mfaRequired: boolean | { roles: Role[] }`, default `false`. When it applies to a user who has not enrolled, middleware returns 403 `mfaEnrollmentRequired` (4.7) on every route except auth, enrollment, `meta`, `config` and `locales`, and the client routes to enrollment. In embedded mode the host owns MFA and `mfaRequired` is not evaluated.

**Roles.** `user`, `trainingOfficer`, `admin`, stored on the user row in standalone mode and checked by route middleware. Roles change only through `scripts/ops/grant-role.ts`, which writes `roleChanged`. There is no role-editing route. Delegator roles are per purpose (5.7).

**Step-up.** Routes marked step-up (credential PUT and DELETE, delegation approval) require: a TOTP code in the request when the user has TOTP enrolled, otherwise a password re-entry at `POST /api/v1/me/step-up` within the last 5 minutes, recorded as `stepUpAt` on the session. A missing step-up is 403 `stepUpRequired` (4.7). Step-up failures count against the account limiter. In embedded mode step-up requires a host token with `iat` at most 5 minutes old, obtained with `identityRequest { reason: "stepUp" }` (6.9).

**User disable.** One transaction: revoke every delegation where the user is trainee or officer (reason `userDisabled`), delete the user's `state_credential` rows, revoke all sessions, set the user disabled, write `userDisabled` (plus `delegationRevoked` and `credentialsDeleted` per affected row). Sockets close after commit. Run by `scripts/ops/disable-user.ts`; there is no admin UI. `audit_event` has no foreign key to `user` and carries an actor snapshot (5.5), so audit survives. A user row may be hard-deleted by ops script any time after disable (5.5, 11).

**Demo users** and their password derivation: 8.5.

Covers SEC-005, BR-002, PLT-006.

### 5.7 Credentials and delegation

**Storage.** One `state_credential` row per user per source (SEC-001, SEC-002). `{ username, secret }` is serialised and encrypted as one AES-256-GCM blob under `CREDENTIAL_KEY`, random 12-byte IV per write, AAD = `user_id|source_id|key_version`. Columns: `ciphertext`, `iv`, `auth_tag`, `key_version`, `username_hint` (last 2 characters of the username), `updated_at`, `last_verified_at`, `last_status`. A row copied to another user or source fails authentication; a decrypt failure writes `credentialsInvalidated` and the source resolves as `credentialsMissing`. This column encryption sits inside the whole-database encryption of 5.5, whose key is separate.

**Key custody.** `CREDENTIAL_KEY` and `DATA_KEY` (32 bytes, base64 each) are read from Docker secret files, never from environment variables and never stored on `/data` (8.2). At startup the API decrypts one `key_canary` row per key (5.5), written under the current key on first boot; a missing, malformed or mismatched key refuses to serve (fail closed). A lost `CREDENTIAL_KEY` is handled by `scripts/ops/lost-key.ts`, which deletes every credential and revokes active delegations with reason `keyLost`, since a delegation without credentials is dead (runbook in 8.7). Rotation remains a non-goal (2); `key_version` exists so it can be added.

**Change and delete.** A change replaces the row; a delete removes it. With `secure_delete=ON` (5.5), the write is followed by `PRAGMA wal_checkpoint(TRUNCATE)` so superseded ciphertext leaves both the main file and the WAL. Backups taken earlier still hold superseded ciphertext; their retention is bounded (8.6). Verified by the raw-bytes scan test (10).

**Secret handling.** Decrypted values exist only as `Secret<T>`: `toJSON`, `toString` and `util.inspect` return `"[redacted]"`, and `.reveal()` is called only at an adapter's wire boundary (5.4). Decryption is confined to the dispatch module; no other module imports the decrypt function.

**Routes** are in 5.1: GET returns `CredentialStatus` (the list covers every `requiresCredentials` source), PUT takes `{ username, secret }`, and PUT and DELETE need step-up. The API never returns a secret, ciphertext or full username.

```
CredentialStatus { sourceId, usernameHint, hasSecret, updatedAt, lastVerifiedAt,
                   lastStatus: "ok"|"credentialsRejected"|null }
```

PUT writes `credentialsCreated` or `credentialsChanged`; DELETE writes `credentialsDeleted`. A source without `requiresCredentials` returns 404.

**Credential statuses** (SEC-002). Dispatch resolves `credentialsMissing` when no usable credential exists (none stored, or decrypt failed) and does not call the adapter; the adapter reports `credentialsRejected` when the source refuses them. Both are `source_result` statuses (5.5) and update `last_status` and `last_verified_at`. The result card shows the status with a deep link to the user's own credential editor, or, when the credential was delegated, the officer's name and no link. "Retry this source" resubmits the same values to that one source as a new submission with a new correlation ID and Idempotency-Key, because a status is write-once. The mock simulates rejection through `mock_credential_state` (5.4).

**Delegation model** (SEC-003, SEC-004, SEC-011). The trainee never types anyone's password. The officer approves from their own session on their own device and lends their stored state credentials. Purposes and caps come from `SiteConfig.delegation` (4.1); the effective duration cap is the lower of the purpose's and the site's `maxDurationMinutes`. The officer must hold a role in the purpose's `delegatorRoles`; the trainee needs no role. The dialog title comes from the purpose `labelKey`, never a hard-coded "training officer". Tables: `credential_delegation` and `credential_delegation_source` (5.5).

**Request and approval flow.**

1. **Trainee device, trainee session.** Trainee opens the delegation dialog, picks purpose, sources and duration. `POST /api/v1/delegations { purpose, sourceIds[], durationMinutes }`. Server checks every source exists and has `requiresCredentials`, and duration is within the cap. It creates a `pending` row bound to the trainee's `session_id`, generates a 6-character code from an unambiguous alphabet, stores only its SHA-256 hash, sets `expires_at` to now plus 5 minutes (the redemption deadline), and writes `delegationRequested`. A newer request from the same session turns an older pending one into `requestExpired` with `delegationRequestExpired`. Response: `{ id, code, expiresAt }`.
2. **Trainee device.** Shows the code and a countdown. In standalone mode it also shows a QR code encoding `https://<origin>/delegate#code=<code>` (fragment, so the code never reaches server or tunnel logs). In embedded mode no QR is shown; the officer types the code into the "Approve delegation" screen inside their own host-embedded module session.
3. **Officer device, officer session.** Officer signs in normally on their own device, then types the code or scans the QR. `POST /api/v1/delegations/redeem { code }`. The code is single-use: redemption binds the request to this officer and sets `expires_at = redeemed_at + 5 min` as the approval deadline. A wrong, expired or already-redeemed code returns 404 `notFound`, writes `delegationVerifyFailed` and counts against the per-officer redemption limiter (5.6). An officer lacking a delegator role for the purpose gets 403 `forbidden` and `delegationVerifyFailed`. Success returns a preview: trainee name, purpose, requested sources, duration, and `missingCredentials[]` (requested sources for which the officer has no `state_credential`).
4. **Officer device, officer session.** The preview shows who is asking and for what. The officer may narrow the sources, shorten the duration, or add missing credentials in the same flow through the credential editor (PUT above, step-up).
5. **Officer device, officer session.** `POST /api/v1/delegations/:id/approve { sourceIds[], durationMinutes, totpCode? }`, step-up required (5.6). One transaction re-checks: request still `pending`, bound to this officer and unexpired; role still held; trainee session still live; `sourceIds` a subset of the request and `durationMinutes` no longer than requested; officer holds a `state_credential` for every approved source, else 409 `delegationCredentialsMissing` naming each source (4.7). Any active delegation on the same trainee session that shares a source is revoked whole with reason `superseded` and `delegationRevoked`. The row becomes `active` with `expires_at` = now plus duration, source rows are inserted active, and `delegationApproved` is written with officer, trainee, purpose, sources and expiry. After commit `delegationChanged` (4.7) goes to both users.
6. **Trainee device, trainee session.** A persistent banner shows the officer's name, the covered sources and the expiry, with a revoke control, until the delegation ends.
7. **Server, per submission.** Credentials resolve in the step-3 snapshot (5.2): an active, unexpired delegation matching the submitting session and source overrides the trainee's own credential; a delegation on another session of the same trainee (for example their phone) never resolves. A job already acknowledged keeps its snapshot until its deadline (`acknowledged_at + timeoutMs`). If the credential row was deleted before the job runs (user disable, lost key, owner delete), dispatch resolves `credentialsMissing`.
8. **Any device.** The delegation ends by one of: `DELETE /api/v1/delegations/:id` by trainee, officer or admin (`delegationRevoked`, actor and reason recorded); expiry (`delegationExpired`, written by the sweeper, 5.2; resolution checks `expires_at` directly); the trainee session ending by sign-out, expiry or revocation (`delegationRevoked`, reason `sessionEnded`); user disable (5.6); a lost `CREDENTIAL_KEY` (reason `keyLost`, 8.7). A request unredeemed within 5 minutes of creation, or unapproved within 5 minutes of redemption, becomes `requestExpired` with `delegationRequestExpired` (sweeper, 5.2).

**Visibility.** `GET /api/v1/delegations` returns, to both trainee and officer, their active delegations and those ended in the last 24h. `GET /api/v1/me/delegated-queries` gives the officer a read-only list of requests that ran on their credentials (policy function, 5.2; audited). The admin audit user filter matches actor OR credential owner (5.1). Dispatch and response events copy the credential owner from the step-3 snapshot; a later hide records the actor only.

Covers SEC-001, SEC-002, SEC-003, SEC-004, SEC-006, SEC-011.

### 5.8 Config loading

**Source.** One image serves every site. Site config, locales and mock files come from a read-only volume; the image bundles `packages/config` as the default. `SITE_CONFIG` names the site file (default the bundled `sites/default.json`). Locales load from `locales/<locale>.json` beside it. Mock files `mock/<siteId>.json` load only when `ALLOW_MOCK_SOURCES=true` (5.4). The demo deployment runs the bundled `packages/config` (8.1). No admin editing UI; edit the file and restart.

**Startup sequence.** Fails closed at every step, naming the file and JSON path.

1. Read the site file and its `extends` base.
2. `migrateConfig` each file of the chain (see below).
3. Merge the chain: keyed deep merge (arrays of entities merge by `id`, `code` or `key`), `$remove` deletes an inherited entry (4.1).
4. Strict Zod parse of `SiteConfig` (4.1).
5. `validateSiteConfig(config, locales)`: the referential pass (4.1), including labelKeys present in every locale listed in `SiteConfig.locales`, source `kind` against the adapter registry and `ADAPTER_DIR` plugins, and mock coverage (5.4). Errors stop startup; warnings are logged.
6. Compute `configHash`: SHA-256 of the canonical JSON (sorted keys) of the resolved config.
7. Write `configLoaded` (system actor) with site id, `schemaVersion` and `configHash`.

**Migration.** `SiteConfig.schemaVersion` is an integer. Core exports `migrateConfig`, an ordered list of pure step functions (`n -> n+1`) applied in memory at startup with a logged warning per step. `pnpm config:migrate <file>` writes the migrated file for the site developer. A config whose version is newer than the server's schema version is rejected. The server parse is strict; clients parse `ClientSiteConfig` forward-tolerantly (6.7).

**Client view.** `GET /api/v1/config` returns the `ClientSiteConfig` allowlist (4.1). Every submit carries `configHash`; a mismatch returns 409 `configHashMismatch` (4.7) and the client refetches config. The hash is stored on `query_request` and in `submitted` details.

**Locales** (NFR-001). `SiteConfig.locales[]` lists the site's locales; the first is the default. A per-user locale is a preference (5.1). `GET /api/v1/locales/:locale` returns the bundle for a listed locale, 404 otherwise; it needs no session because the sign-in screen uses it, and holds UI strings only. Ships `en` only. Every user-facing string, picklist label and error is a message key with params (4.1, 4.4); formatting uses `Intl`.

**Feature flags.** This is the single home for flags and dark merges. `SiteConfig.features: { [FeatureKey]: boolean }` over the closed catalogue `FEATURES` exported by core: `credentials`, `delegation`, `resultHide`, `adminAudit`. An unknown key is a validation error; an unlisted key defaults to false. A disabled feature's routes return 404 as if absent and its UI is hidden (`ClientSiteConfig.features`). Unfinished and sensitive capabilities merge dark: their flag is off in every shipped site config until their acceptance tests (10.2) pass on `main`, and turning one on is its own config PR. Test configs under `packages/config/test/` turn every flag on; `packages/config/test/flags-off.json` turns every flag off for the route matrix (10.3). OpenAPI ignores flags (5.1). Embedded mode is not a feature: it is the deployment property `IDENTITY_MODES` (5.6, 8.2).

Covers BR-001, BR-004, NFR-001, PLT-007.

Overridden by ADR-0011.

### 5.9 Security baseline

**Content Security Policy** on every HTML response. The API serves `index.html` with a fresh nonce per response.

```
default-src 'self';
script-src 'nonce-<n>' 'strict-dynamic';
style-src 'self';
connect-src 'self' wss://<deployed-origin>;
img-src 'self' data:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';     // on /embed only: the FRAME_ANCESTORS allowlist, 'none' when empty
```

The web app is Vite plus React DOM (3); inline styles are set through the CSSOM, which `style-src 'self'` permits, and no stylesheet is inlined. From M0 a Playwright check asserts zero CSP violations across the smoke flow (10).

**Headers.** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. `Cache-Control: no-store` on every `/api` response and on `index.html`; hashed static assets are `public, max-age=31536000, immutable`.

**Origins.** CORS and `frame-ancestors` each read an allowlist from deploy config (`CORS_ORIGINS`, `FRAME_ANCESTORS`, 8), default the deployed origin only; localhost origins are added only in development. The WebSocket upgrade enforces its own Origin check (5.3). Better Auth's trusted origins are the same list.

**CSRF.** Every state-changing request (POST, PUT, PATCH, DELETE) to a non-auth route must carry `X-Requested-With: querymodule`, else 403 `forbidden`. A cross-site form cannot set it and a cross-origin script cannot send it without passing CORS. Better Auth routes rely on its own origin check; `POST /api/v1/auth/embedded` is not a Better Auth route and needs the header. The `__Host-` session cookie (5.6) cannot be set or overwritten by a sibling subdomain.

**Limits.** Request body 32KB, 4KB per field value (4.1); over either is 413 `payloadTooLarge`.

**Logging.** Structured logs. The logger redacts, at any depth, every key that is a `FieldDef` key in the resolved config, and every object under `values`, `payload`, `body`, `credentials`, `secret`, `password`, `authorization` or `cookie`. `Secret<T>` (5.7) redacts itself regardless. The error reporter never captures request or response bodies. A log-capture test submits known test values and asserts none appear in any sink (10).

**Secrets.** `CREDENTIAL_KEY`, `DB_ENCRYPTION_KEY`, `DATA_KEY`, `BETTER_AUTH_SECRET` and `SEED_PASSWORD_SECRET` are Docker secret files (8.2). Environment variables name file paths only. None live on `/data`.

**Transport.** TLS terminates at Cloudflare. The container listens on plain HTTP on the private compose network, with no host port published; cloudflared is the sole ingress, which is also what makes `CF-Connecting-IP` trustworthy (5.6). This is SEC-007 at the prototype's boundary; real adapters are out of scope (2).

Covers SEC-006, SEC-007.

## 6 Apps

### 6.1 Personas

Persona is resolved in this order, first hit wins:

1. Host context: in embedded mode the host's `init` message names the persona (6.9); in `packages/rn-ui` it is a prop.
2. The user's stored override (`user_preference.persona_override`).
3. Device heuristic: native means `mobile`; web with `(any-pointer: coarse)` means `mobileUnit`, otherwise `dispatch`. A touch-monitor dispatch desk uses the stored override.

Width never selects a persona, so browser zoom cannot swap layout or response mapping. The heuristic is re-evaluated only when the pointer media query changes and neither host context nor an override applies; an override or a host persona disables re-evaluation.

Personas are the open list `SiteConfig.personas` (`PersonaDef { key, labelKey, layout }`, 4.1). `ResponseMapping.persona` references a key from it. Layout components are a fixed set in code (`dispatch`, `mobileUnit`, `mobile`); a persona picks one of them plus its own response mappings. Shipped personas: `dispatch`, `mobileUnit`, `mobile`, and `records` (dispatch layout, Records-oriented mappings, for CAD Records and Records-only hosts). A Mobile Field Reporting host selects an existing persona through host context; no dedicated persona ships.

Persona selects layout and response mapping only. It never changes what data is fetched. The keyboard model (6.4) applies in every web persona.

Covers UX-001, UX-012, UX-014, BR-002, PLT-006.

### 6.2 Screens and semantics

Phase 1 screens: login (standalone mode only); query panel (query-type selector, form or terminal toggle, source checkboxes, quick-access bar, FR-007); results list; credentials settings; preferences (persona override, layout orientation, terminal layout, theme mode, locale); admin audit viewer. M3 adds the delegation screens below; M4 the mobile home with quick queries (6.10). A screen whose `features` flag is off is not rendered (5.8).

**Generic field renderer.** Forms render only from core's `FormState` (4.3): fields in `order`, grouped by section under `sectionLabelKey`, picklist options from the filtered enabled options, labels from `labelKey`. No per-query-type UI code exists (BR-001). A field with `isDefault` shows a text tag "default"; typing makes it a user value.

- Required indicator: label text, an asterisk (`aria-hidden`), visually hidden "required", and `aria-required="true"` on the input. Never colour alone. Styled by the `field.required` token (6.5).
- Blocked submit (Enter or Submit, FR-006): each field in `missingRequired` or named by an entry of `errors` (`params.field`) gets `aria-invalid="true"` and an inline message linked by `aria-describedby`, rendered from its `{key, params}` through the locale bundle. Focus moves to the first invalid field in render order. The announcer (6.6) says the count ("3 fields need attention").
- A field revealed by a rule (A2's Plate Type) is announced politely with its label and required state. Focus does not move.
- Terminal errors: every error from `tokenize` and validation (4.4) renders in a list under the terminal input, linked by `aria-describedby`. The input keeps focus and its text.
- Submit uses `aria-disabled="true"`, never `disabled`, so it stays focusable, with a visible reason linked by `aria-describedby`: submitting (until the 202 settles, 6.7), no connection (6.8), client update required (6.7).

**Semantics.** Web builds these as shared primitives in `packages/web-ui`. `packages/rn-ui` builds the same list with `accessibilityRole`, `accessibilityState` and `accessibilityLabel`.

| Control | HTML element | Role and states |
|---|---|---|
| Query-type selector | `<select>` + `<label>` | implicit combobox; selected option |
| Quick-access bar | `<nav aria-label>` of `<button>` | `aria-pressed` on the current type |
| Form or terminal toggle | `<button>` | `aria-pressed` (true = terminal) |
| Source checkboxes | `<fieldset>` + `<legend>` + `<input type="checkbox">` | checked; `aria-disabled` when unavailable |
| Form section | `<fieldset>` + `<legend>` from `sectionLabelKey` | none extra |
| String field | `<input type="text">` + `<label>` | `aria-required`, `aria-invalid`, `aria-describedby` |
| Picklist field | `<select>` + `<label>` | as string field |
| Date and number fields | `<input type="text" inputmode="numeric">` (`decimal` for decimals) | as string field; accepted formats in the description |
| Boolean field | `<input type="checkbox">` + `<label>` | checked |
| Terminal input | `<input type="text" autocomplete="off" spellcheck="false">` + `<label>` | `aria-describedby` to the error list |
| Submit | `<button type="submit">` | `aria-disabled` + described reason |
| Results list | `<ul>`, one `<li>` per request | list |
| Request entry | `<section aria-labelledby>` headed by query type and type-field values | none extra |
| Source result | `<section aria-labelledby>` headed "source: status" | status in text, never colour alone |
| Severity badge | `<span>`: icon (`aria-hidden`) + text | text carries severity |
| Highlighted keyword | `<mark>` + severity `marker` text | marker never colour alone |
| Summary or detail toggle | `<button aria-expanded aria-controls>` | expanded |
| Value element | `<dl>`: `<dt>` label, `<dd>` value | label names the value |
| Table element (UX-016 grid) | `<table>` + `<caption>` + `<th scope="col">`, inside `<div role="region" tabindex="0" aria-labelledby>` | scrolls in its own container |
| Delete from view | `<button>` + modal `<dialog>` confirm | focus into dialog; after confirm, to the next entry, else the list |
| Dialogs | `<dialog>` via `showModal()` | `aria-labelledby`; Esc closes; focus returns to opener |
| Connection indicator | icon + text | changes announced (6.6) |

**Results list.** Each request entry shows query type, type-field values, the correlation ID as a copy button, and the ack time (MM-DD-YY HH:mm:ss local). Parts nest under the entry: part 0, then each nested part labelled with its `alsoRun` origin. Each part lists its sources with status: `pending`, `returned`, `failed`, `timedOut`, `interrupted`, `credentialsMissing`, `credentialsRejected`; a skipped nested part shows `skipped` and its reason. Entry, card and notification always carry the severity badge from `assessResult` (4.5): icon, text, colour and `marker`. With no matching mapping the card renders core's generic key and value dump. Keyword hits render as `<mark>` with severity style and marker; elements with `highlight: false` render plain. A purged part or result shows "Purged under retention" and never calls `mapResponse` (5.5).

**Credential statuses (SEC-002).** `credentialsMissing` or `credentialsRejected` on the user's own credential links to `/settings/credentials/:sourceId?returnTo=<entry>`, then offers "Retry this source" (5.7), shown linked to the original; from a nested part it submits a new primary query of that part's query type, values and one source. A delegated credential shows the officer's name and no link.

**Toasts.** Supplementary; the entry holds the lasting record. The ack toast is driven by the 202 alone and shows correlation ID and ack time. Toasts stay at least 10 s, pause on hover or focus, have a dismiss button, and are announced politely (6.6).

**Terminal layout.** `user_preference.layout.terminal`: `"toggle"` (M1, terminal replaces the form in the panel) or `"pane"` (M2, terminal beside results, same draft store, 6.7). FR-050 is partial until M2 (11).

**Delegation screens (M3).** Titles come from the purpose's `labelKey`, never hard-coded "training".

- Trainee request dialog: purpose (when more than one), sources, duration up to the purpose cap. Submit shows the 6-character code, a 5-minute countdown and, in standalone mode only, a QR code of `https://<origin>/delegate#code=<code>`. It closes on `delegationChanged` to `active`, or shows expired on `requestExpired`.
- Officer approval on the officer's own device and session: in standalone mode at `/delegate` (code entry or the QR link); in embedded mode on the "Approve delegation" screen of the officer's own host-embedded session (code entry only). The preview shows trainee, purpose, sources and duration; the officer may narrow sources or shorten duration. Each source in `missingCredentials` is named with a link to the credential editor that returns to the approval. Approve runs step-up first when required (5.6).
- Trainee banner: persistent, not dismissable, on every screen while a delegation is active: "Using <officer>'s credentials for <sources> until HH:MM". It opens a dialog listing sources and expiry with "End delegation" (revoke).
- Delegations list, both parties: active and last 24 h from `GET /api/v1/delegations`, each with revoke.
- Officer delegated queries: read-only list from `GET /api/v1/me/delegated-queries`, same entry component with hide absent.
- On `delegationChanged` the client refetches `GET /api/v1/delegations`; banner and lists follow.

Every Playwright scenario runs axe (10). A2 and A3 assert invalid-field association, focus move and announcement.

Covers FR-005, FR-006, FR-007, FR-043, FR-044, FR-050 (partial), FR-062, FR-064, SEC-002, SEC-003, SEC-004, SEC-011, SEC-014, UX-004, UX-010, UX-015, UX-016.

### 6.3 Mobile unit layout

Designed at 1024x768 first, verified at 1366x768 and 800x600 (scrolling allowed at 800x600). Single column, no side panels. Query panel and results stacked, results collapsible. Minimum touch target 48x48 CSS px, minimum body text 16 px, no reliance on hover, focus or colour alone.

- Contrast: body text 7:1 in every mode of the mobile unit layout, day included (6.5). A manual daylight check on a Toughbook-class screen is an M4 exit item.
- Condensed cards show summary elements and the severity badge (6.2), always. Detail is one tap behind a `<button aria-expanded>`.
- Orientation preference switches horizontal versus vertical value layout (UX-013), saved in `user_preference.layout`.
- Tables scroll horizontally in their own container; the page does not scroll horizontally except at 800x600.
- Reflow: at 200% zoom and at 320 CSS px width, content reflows to one column with no loss of function; only table containers scroll.

Covers UX-002, UX-010, UX-012, UX-013, UX-014.

### 6.4 Keyboard model

A shortcut engine in `packages/web-ui` serves every web persona. Bindings use `ShortcutMap` (4.1): each stroke is `[Ctrl+][Alt+][Shift+]<KeyboardEvent.code>`, strokes separated by spaces form a chord. Codes are layout-independent; the shortcut sheet shows each code's label for the current layout where the browser exposes it, else the code.

- Single keys (no modifier, or Shift only) are inert while focus is in an `input`, `textarea`, `select`, contenteditable element or the terminal.
- Combos (Ctrl or Alt) and chords fire anywhere unless the focused text input consumes the key. Standard editing combos (Ctrl+A, C, V, X, Z, Y) are never bound.
- A chord whose first stroke is a single key is therefore inert in text inputs. A pending chord times out after 1000 ms.
- Context: `global` always applies; `panel`, `results` or `terminal` applies while focus is inside that region. When regions nest and bind the same keys, the innermost region wins, then outer regions, then `global`.
- Config validation (4.1) rejects: two bindings with the same keys in one context; a chord prefix equal to another binding in the same context (`KeyG` with `KeyG KeyR`); a `global` binding that collides with a binding in any context; a single-key binding whose character equals `terminal.delimiter`, resolved on a US layout because `KeyboardEvent.code` is US-positional.
- `siteConfig.shortcuts` overrides the default map per action key.

Default map:

| Keys | Context | Action key: behaviour |
|---|---|---|
| `Slash` | global | `focusTerminal`: focus terminal input |
| `Ctrl+Backquote` | global | `toggleMode`: form or terminal |
| `Alt+Digit1` to `Alt+Digit9` | global | `quickType1..9`: select quick-access query type by position |
| `Enter` in a form field | panel | native form submit (FR-006), not an engine binding |
| `Ctrl+Enter` | panel | `submit` |
| `Enter` in terminal | terminal | parse and submit (FR-053) |
| `ArrowUp` / `ArrowDown` | results | `selectPrev` / `selectNext` |
| `Enter` | results | `toggleDetail` |
| `Delete` | results | `deleteFromView`, with confirm |
| `Escape` | global | `dismiss`: close dialog or clear selection |
| `Shift+Slash` | global | `shortcutSheet` |
| `KeyG KeyQ` | global | `goPanel` |
| `KeyG KeyR` | global | `goResults` |

Every interactive element is in the tab order with a visible focus ring (`focus.ring` token). Playwright drives the plate query and the terminal query keyboard-only from M1.

Covers FR-006, FR-007, FR-051, FR-053, FR-056.

### 6.5 Tokens and themes

`packages/tokens` is the single source for colour, spacing, type, radius and motion, as semantic tokens (`color.text.body`, `color.surface.base`, `color.severity.critical.bg`, `focus.ring`, `field.required`) with a value per mode. A build step emits CSS custom properties for web and a typed theme object for React Native. Components use no literal colour or size.

Modes:

- `day`: light surfaces.
- `night`: dark surfaces.
- `redShift`: low-blue dim mode for in-vehicle night work; amber and red on near-black, no blue-dominant colours.

Selection: `user_preference.theme_mode` is `day`, `night`, `redShift` or `auto`; unset falls back to `SiteConfig.theme.defaultMode` (4.1). `auto` follows `SiteConfig.theme.auto`: `os` maps a dark OS scheme to `night`, `time` uses `night` from 19:00 to 07:00 local. Web sets `data-theme` on `<html>`; native swaps the theme object; no reload. Motion tokens drop to zero under reduced-motion settings.

Site overrides: `SiteConfig.theme.tokens` overlays token values for all modes or one mode. Unknown token names fail validation.

Contrast validation runs in `config:validate` and in the tokens package tests, per mode, over declared foreground and background pairs: mobile unit body text 7:1; elsewhere text 4.5:1 and non-text UI (focus ring, required marker, badge edge) 3:1; severity styles 4.5:1 (4.1).

Covers UX-002, UX-011, BR-001.

Overridden by ADR-0009.

### 6.6 Announcements and focus

One announcer. Its queue lives in `packages/client`; web binds it to two live regions present from first render (`role="status"` polite, `role="alert"` assertive); native binds it to `AccessibilityInfo.announceForAccessibility`.

- Polite: ack, source status changes, timeouts, validation counts, rule-revealed fields, connection changes, delegation changes.
- Assertive: only when `assessResult` severity is `critical`.
- Coalesced per correlation ID: status messages for one request within 1500 ms merge into one, such as "VEH ZZ-0001: 2 of 2 sources returned, critical: STOLEN". A `critical` message is never delayed by the window.
- Incoming events never move focus. Entries insert without remounting the focused row: stable keys (correlation ID, part, source), selection tracked by id, and the focused row is never virtualised away.
- Audible cue per severity when `SeverityStyle.audibleCue` is true (default false); one built-in sound per severity.

Covers FR-043, FR-044, FR-064, FR-065 (foreground).

### 6.7 State and data

`packages/client` is shared by `apps/web` and `apps/mobile` through an injected `ClientPlatform` (3): API client generated from the committed OpenAPI document, WebSocket client with replay cursor, Zustand stores, TanStack Query hooks, selectors and the announcer queue, each tested (threshold in 10.5).

**Draft.** The canonical draft is user values per field, held in Zustand with mode and selected sources, one draft per query type in memory, cleared on logout. Effective values never enter it; `setDefault` never touches it (4.3). The form renders `evaluateForm(draft)`; the terminal is a derived view whose toggle, merge, "n fields not shown" and round-trip rules are in 4.4.

**Submit.** The client POSTs per 5.2 with `Idempotency-Key` and `X-Requested-With`. It generates a key per submit attempt, reuses it only to retry an attempt that got no response, and discards it once a 202 or an error settles. Submit stays `aria-disabled` until then. On the 202 the client sends `ackReceipt` over the socket (4.7). A 409 `configHashMismatch` refetches config, re-evaluates the draft and asks the user to resubmit.

**Events.** Handled per the 4.7 client rules, then fetched through `GET /api/v1/queries/:correlationId`. An event for an unknown correlation ID (it can beat the 202) creates a placeholder entry that the fetch fills.

**Regulated data on the client.** Nothing from queries, drafts or config goes to persistent storage: no TanStack persister, no `localStorage`, IndexedDB or AsyncStorage for them, no service worker in Phase 1. Native keeps only the bearer token, in SecureStore. On logout, 401 or a change of user id: clear the query cache, reset every store, close the socket, clear the announcer. `Cache-Control: no-store` comes from the server (5.9).

**Versions and locale.** At start the client reads `GET /api/v1/meta`; below `minClientVersion` it shows "update required" and submit stays `aria-disabled`. Strings come from `GET /api/v1/locales/:locale` for `user_preference.locale` (one of `SiteConfig.locales`). Numbers and times format through `Intl`; dates display as MM-DD-YY. Every core and API error renders from `{key, params}`.

Covers FR-056, FR-064, FR-065 (foreground), NFR-001, NFR-003 (partial), SEC-006, SEC-014.

### 6.8 Connectivity

- Heartbeat: `ping` every 20 s; two missed `pong`s mark the socket stale, close it and reconnect. `readyState` alone is never trusted. Pings never refresh the session idle clock (5.6).
- Reconnect: exponential backoff from 1 s to 30 s with full jitter, reset after a successful open and first `pong`. The client sends `hello` with its `lastSeq` for replay (4.7), then refetches over HTTP every entry that still has a `pending` source.
- While the socket is down, entries with a `pending` source are refetched at the backoff interval. Pending refetches, resync refetches and health polls carry `X-Background: 1`, so they never refresh the idle clock (5.6).
- Indicator: icon plus text, derived from both signals: `offline` when HTTP is gated (submit blocked); `reconnecting in n s` when HTTP is up and the socket is down (results arrive by polling; submit allowed); `connected` when both are up. Changes announced politely.
- Submit is gated on HTTP reachability, not socket state: gated when a request fails with no response or the platform online signal (`ClientPlatform`, 3) is false; ungated when `GET /api/v1/health` next succeeds, polled on the same backoff. While gated, submit is `aria-disabled` with the visible reason "No connection to server".
- No offline queue. The draft stays in memory; retrying an attempt that got no response reuses its Idempotency-Key (6.7).

Covers NFR-003 (partial), FR-043, FR-065 (foreground).

### 6.9 Embedded mode

Two modes (3): standalone (Better Auth login, the demo) and embedded. In embedded mode a web host loads `https://<origin>/embed` in an iframe and the module never shows its login screen.

- Allowlists: host origins from deploy config set `frame-ancestors` on `/embed`, CORS, and the accepted `postMessage` origins (5.9). Other routes keep `frame-ancestors 'none'`.
- Identity: the host passes a host-issued JWT in `init`. The module presents it to `POST /api/v1/auth/embedded`, which validates it through `IdentityService` and issues a module session (5.6). The JWT is held in memory only. A token for the same (`iss`, `sub`) presented to a live session extends that session's `hostTokenExp` and nothing else; the session still ends at the earliest of host `exp`, absolute and idle. To refresh or step up, the module sends `identityRequest` and the host answers with `identity`. Roles come from `SiteConfig.auth.embedded.roleClaims`; audit rows carry `identity_source` and the host subject.
- Persona: from `init` (6.1). Embedded mode lands in M4 (12).

Protocol v1. Envelope `{ protocol: "qm", version: 1, type, payload }`. Both sides check `event.origin` against the allowlist and ignore other origins. The module answers an unknown `version` with `error`.

| Direction | type | payload |
|---|---|---|
| module to host | `ready` | `{ protocolVersion: 1, moduleVersion }`, sent on load |
| host to module | `init` | `{ identityToken, persona?, locale?, context?: { incidentId?, unitId?, recordId? } }` |
| module to host | `identityRequest` | `{ reason: "refresh" \| "stepUp" }`; the host answers with `identity` |
| host to module | `identity` | `{ identityToken }`, in answer to `identityRequest` or as a refresh before expiry |
| host to module | `context` | `{ incidentId?, unitId?, recordId? }` |
| module to host | `resize` | `{ height }` |
| module to host | `resultSelected` | `{ correlationId, partId, sourceId, resultId, queryType, severity }`, identifiers only, no values |
| module to host | `writeBackRequest` | `{ resultId, target }`, reserved for FR-061 (B6), never sent before then |
| module to host | `error` | `{ key, params }`; keys `identityRejected`, `unsupportedVersion` |

Native hosts embed `packages/rn-ui` instead: the same inputs as props (identity token provider, persona, context), the same outputs as callbacks. The Expo app (6.10) is a demo shell over that library.

**Host simulator.** `apps/host-simulator`, a static page served on its own origin: a local port in dev and CI (9.3), and a second demo origin (`host.querymodule.birchdesignlab.com`) on the live deployment, served as a separate static container, never inside the API image. It signs test JWTs with a demo key whose JWKS only demo and CI deploy configs trust. Any deploy config that trusts the simulator's key has a `roleClaims` map that grants no `admin` and no `trainingOfficer`. It lets the viewer pick a demo subject, role claims, persona and context; embeds `/embed`; and logs every message both ways. Playwright uses it for embedded tests: foreign origin ignored, token refresh, `resultSelected` carries no query values.

Covers BR-002, PLT-006, FR-061 (reserved channel).

### 6.10 Native

`apps/mobile` (M4) is an Expo app over `packages/client`, `packages/rn-ui` and the tokens' RN theme. Development runs in Expo Go (single-SDK lockstep, 14). CI runs `expo export` for iOS and Android from M0 (9.3). EAS builds only when Phase 3 needs camera, background execution and push.

- Auth: Better Auth Expo plugin, bearer token in SecureStore only, same session limits as web (5.6). Fallback trigger: the token is not restored after a cold start; then switch to a plain bearer session.
- Push (FR-065 background, not built in Phase 1): payload carries only the opaque correlation ID and generic text ("Query results available"): no values, keywords or severity. Content is fetched through the authenticated API after unlock. FR-071's launch mechanism stays deferred (11).
- Input hints (UX-003): `keyboardType` and `autoCapitalize` follow `dataType` and `transform` (number pad for dates and numbers, capitals for `upper` fields); autocorrect off for `upper` fields; OS predictive text left on for free-text strings. No recent-values cache: query values are regulated data. UX-003 is partial (13).
- Font scaling: OS text size honoured up to 2x; targets grow with text and never clip (minimum 48 dp).
- Delete from view: a visible labelled button in the card's action menu. Swipe is optional and, when present, is also exposed as an accessibility action. The confirm is a modal that takes focus and returns it to the list.
- Reduced motion through motion tokens (6.5); announcements through the announcer (6.6).
- Home screen: quick-query tiles for `quickAccess` types (FR-070, C2).

Verification: a Maestro flow against Expo Go (login, quick query, plate submit, result with severity badge, delete from view), run manually per release with results in `docs/releases/<tag>.md`. The M4 exit includes a VoiceOver and TalkBack pass at the largest text size.

Covers FR-062, FR-065 (partial), FR-070, FR-071 (deferred), UX-001, UX-002, UX-003 (partial), SEC-006.

## 7 Site-developer experience

One image serves every site. A site never edits `packages/core` or the apps and never rebuilds the image. It supplies by volume (paths in 5.8):

- site config `sites/<siteId>.json`, selected by `SITE_CONFIG`
- locale bundles `locales/<locale>.json`
- mock data `mock/<siteId>.json`, loaded only when `ALLOW_MOCK_SOURCES=true` (5.4)
- server-side source adapters in `ADAPTER_DIR`, each a module implementing SourceAdapter API v1, registered by `kind` (5.4)

Config covers query types, type fields, rules, picklists, commands, keywords and severity styles, response mappings, personas, shortcuts, theme tokens and locales. Response formats are declarative from a fixed set with parameters (`text`, `upper`, `phone`, `date{pattern}`, `template`); an unknown format is a validation error. A new format kind is a core release, not a site change.

**Shipped default site** (`packages/config/sites/default.json`). Site default State is `TX`. Two default sources, one state-scoped and one national-scoped, both `kind: "mock"`; the state source is flagged `plateOnly` for `VEH`. Mock scenarios are in 5.4.

| Query type | Command (positions in order) | Fields and notes |
|---|---|---|
| `VEH` vehicle | `VEH` (plate, state, year, VIN) | plate, state, year, VIN, `plateType` (required when State is not the site default, A2); `allowPlateOnly` (A1) |
| `PER` person (FR-020) | `PER` (last, first, DOB, sex, race) | last, first, DOB (`century: "past"`), sex, race; `alsoRun` the wanted type through `fieldMap` (B2) |
| `PRO` property (FR-030) | `PRO` (serial, propertyType, description) | serial, `propertyType` (`role: "type"` picklist, narrowed per site, B7), description |
| wanted check | its own command, same person positions | last, first, DOB; reached directly or as the nested part of `PER` |

**Overlay.** A site extends a shipped site with `extends`: keyed deep merge, `$remove` to drop an entry (4.1). `packages/config/sites/example-ok.json`:

```json
{
  "extends": "default",
  "site": { "id": "example-ok", "labelKey": "site.exampleOk" },
  "defaults": { "state": "OK" },
  "terminal": { "delimiter": "/" },
  "shortcuts": { "focusTerminal": { "keys": "Ctrl+Slash", "context": "global" } },
  "picklists": [
    { "id": "propertyType", "values": [ { "code": "BOAT", "$remove": true } ] }
  ],
  "queryTypes": [
    { "code": "VEH", "fields": [
      { "key": "tagSticker", "labelKey": "field.tagSticker", "dataType": "string",
        "section": "expanded", "custom": true }
    ] }
  ]
}
```

The `/` delimiter collides with the default `Slash` shortcut, so the overlay rebinds it; without that line validation fails (6.4). Its mocks live in `packages/config/mock/example-ok.json`.

**Tooling.**

- `pnpm install`, `pnpm dev`: API and Vite web app with the default site, mocks allowed, and seeded demo users whose passwords derive from `SEED_PASSWORD_SECRET` and print once.
- JSON Schema for editor autocomplete (shape only).
- `pnpm config:validate`: shape, referential pass with JSON paths (4.1), fixture policy (5.4), mapping paths against mock payloads, shortcut and delimiter collisions, contrast per theme mode. `--resolved` prints the merged overlay; `--diff <tag>` prints the change against a release.
- `pnpm config:migrate` applies `migrateConfig` steps to an older config (5.8).
- `scripts/mock-data/generate.ts` produces fixture-policy mock payloads.

**Docs.** `docs/site-config.md` (every config section, the Appendix B vehicle plate example, condition language, type fields, commands, keyword styles with `except`, response mappings with tables, personas, shortcuts, theme, fixture policy); `docs/adapters.md` (SourceAdapter API v1); `docs/embedding.md` (6.9 protocol, host JWT); `docs/api.md` from OpenAPI.

**Release notes (BR-004)** for site developers: 9.5.

Covers BR-001, BR-004, BR-007, FR-008, FR-020, FR-030, FR-051, FR-052, FR-060, UX-011, NFR-001.

## 8 Deployment

### 8.1 Image

One image serves every site. A multi-stage Dockerfile runs `pnpm install --frozen-lockfile`, builds `packages/core`, `packages/tokens`, `packages/client`, `packages/web-ui`, `packages/api`, `apps/web` (Vite) and `scripts/ops` (compiled to JS), then copies the API bundle, production `node_modules`, the web build and the compiled ops scripts into a runtime stage `node:<lts>-alpine`, pinned by digest to the same major as `.nvmrc`. `apps/mobile` and `packages/rn-ui` are not in the image. The process runs as a non-root user (uid 10001) that can write only `/data`. The Docker healthcheck calls `GET /api/v1/health`. The process serves nothing until migrations are applied, both `audit_event` triggers are present (5.5), both key canaries decrypt (5.7) and the site config validates (5.8); any failure exits non-zero (fail closed).

Nothing site-specific is baked in. For other sites, read-only mounts supply it: `/config` holds `sites/`, `locales/` and `mock/<siteId>.json` (`SITE_CONFIG` names the site file), and `ADAPTER_DIR=/adapters` holds server-side adapters (5.4, 5.8, 7). A new site is a new volume, never a new image. The demo deployment mounts no `/config` and leaves `SITE_CONFIG` unset, so it runs the bundled `packages/config` and a merged config PR reaches the live URL.

### 8.2 Secrets and the data volume

Secrets are Docker secret files under `/run/secrets/`. Environment variables name file paths only. No secret is in the image, in `.env`, or on `/data`.

| Secret file | Use |
|---|---|
| `DB_ENCRYPTION_KEY` | libSQL `encryptionKey`; whole-database encryption (5.5) |
| `CREDENTIAL_KEY` | State-credential envelope (5.7); wipes credentials only if lost |
| `DATA_KEY` | Wraps each per-request data key (DEK) in `request_key` (5.5); wipes only request values and payloads if lost, independent of `CREDENTIAL_KEY` |
| `BETTER_AUTH_SECRET` | Session signing (5.6) |
| `SEED_PASSWORD_SECRET` | Demo password derivation (8.5) |
| `TUNNEL_TOKEN` | cloudflared only; the app never mounts it |

Non-secret deploy config lives in `deploy/.env` (template `deploy/.env.example`, committed; `.env` is not): `PUBLIC_ORIGIN`, `SITE_CONFIG`, `ADAPTER_DIR`, `ALLOW_MOCK_SOURCES` (`true` only on the demo host, CI and dev; 5.4), `IDENTITY_MODES` (`standalone`, `embedded` or both; default `standalone`; 5.6), `MIN_CLIENT_VERSION` (unset means no minimum; 4.7), the `frame-ancestors` and CORS allowlists (`FRAME_ANCESTORS`, `CORS_ORIGINS`; 5.9), and the embedded-mode JWT issuer, audience and JWKS URL (5.6, 6.9). No shipped deploy config lists `embedded` before M4.

`/data` holds the encrypted database and its WAL and nothing else. Copying the file off the laptop yields ciphertext; opening it without `DB_ENCRYPTION_KEY` fails (tested, 10.4). Pragmas are set by the API (5.5). Copies of `DB_ENCRYPTION_KEY`, `CREDENTIAL_KEY`, `DATA_KEY` and the backup private key (8.6) are held offline, off the laptop, and never stored alongside backups; they are the only recovery path. Losing `DB_ENCRYPTION_KEY` with no offline copy loses the database; there is no recovery path.

### 8.3 Compose

The laptop runs `deploy/compose.yml` with two services, each `restart: unless-stopped`, plus a systemd timer (ADR-0002):

- `app`: `ghcr.io/birchdesignlab/querymodule:release`. Secrets per 8.2. Volumes `data:/data` and `./adapters:/adapters:ro`; no `/config` mount and `SITE_CONFIG` unset (8.1). No published ports: cloudflared is the sole ingress, which is what makes `CF-Connecting-IP` trustworthy (5.6). `stop_grace_period: 30s`. Label `com.centurylinklabs.watchtower.enable=false`, so any Watchtower already running on the host ignores it.
- `cloudflared`: tunnel token from the `TUNNEL_TOKEN` secret file, routing `querymodule.birchdesignlab.com` (HTTP and WebSocket) to `app:3000`. DNS is on Cloudflare, so the route creates the CNAME.
- `deploy-pull.timer` (systemd user unit with lingering, `deploy/systemd/`): every five minutes runs `scripts/ops/deploy-pull.sh`, which does `docker compose pull app`, and when the digest changed, `docker compose up -d app`, waits for `/api/v1/health`, runs `smoke.sh`, and logs the result. GHCR read-packages token in the deploy user's Docker `config.json`. No third-party updater and no container holds the Docker socket.

On SIGTERM the app drains per 5.2; `stop_grace_period: 30s` covers the 10 s default, and a site raising any `timeoutMs` above 20 s raises it too (stated in `docs/deploy.md`, not enforced).

### 8.4 Release tags, promote and rollback

CI pushes `sha-<commit>` and `latest` on every merge to `main` (9.3). Nothing deploys `latest`. Production runs the `release` tag.

`.github/workflows/promote.yml` (manual `workflow_dispatch`, inputs `sha`, optional `milestone` `m0` to `m4`):

1. Verify the `ci` workflow succeeded for `sha` on `main`.
2. For a milestone, run the story-tag gate for that milestone (10.2) and require `docs/releases/<milestone>.md` at `sha` (9.5).
3. Retag `sha-<commit>` as `release` by manifest copy (no rebuild). For a milestone, also push git tag `<milestone>` at `sha`.

The `deploy-pull` timer deploys the new `release` within five minutes. A milestone is a release tag. After every promote the developer runs `scripts/ops/smoke.sh` against the live URL (8.7).

Rollback is a promote of an older sha. `release` then points at the older digest, so the next timer run restores the older image and nothing can re-pull the bad one. Migrations are expand-then-contract (9.2): an older image runs on a newer schema, its migrator finds nothing to apply, and migrations are never rolled back.

### 8.5 Seed and demo accounts

`docker compose run --rm app node scripts/ops/seed.js` runs once against an empty database. It creates the users in `packages/api/src/seed/users.ts` (usernames and roles) plus a non-admin `smoke` user. Each password is derived as HMAC-SHA256 of the email under `SEED_PASSWORD_SECRET` (8.2). It is printed once to that command's stdout, never to the service log, and is never committed. `docs/demo.md` lists usernames only. Roles beyond the seed go through `scripts/ops/grant-role.ts` (5.6). CI generates a random `SEED_PASSWORD_SECRET` per run and derives passwords the same way.

### 8.6 Backups and restore

`scripts/ops/backup.sh` runs nightly from a systemd timer on the laptop:

1. Take an online backup of the database into a staging volume, never `/data`, through `scripts/ops/backup.ts` inside the app container. The copy stays encrypted under `DB_ENCRYPTION_KEY`.
2. Encrypt it again with `age` to a recipient public key. The private key is not on the laptop.
3. Upload it off-box with `rclone` to one configured remote (a Cloudflare R2 bucket for the demo), then delete the local staging copy.
4. Prune remote copies older than 30 days.

Retention is 30 days. `docs/deploy.md` states that backups hold superseded and deleted credential ciphertext for up to 30 days (recoverable only with the `age` private key, `DB_ENCRYPTION_KEY` and `CREDENTIAL_KEY` together) and crypto-shredded payload DEKs for the same window (recoverable only with the `age` private key, `DB_ENCRYPTION_KEY` and `DATA_KEY` together) (5.5).

`scripts/ops/restore-test.sh` fetches the newest backup, decrypts it, and starts a throwaway app container on it with no published ports. It then checks `/api/v1/health` (which proves the migrations, triggers and canary) and compares the `audit_event` row count and max id with the backup manifest. It runs at every milestone exit from M0, and the result is recorded in `docs/releases/<milestone>.md`.

### 8.7 Smoke and runbooks

`scripts/ops/smoke.sh <baseUrl>`, run from the laptop:

1. `GET /api/v1/health` and `GET /api/v1/meta`.
2. Log in as `smoke`, with the password derived from the local `SEED_PASSWORD_SECRET` file.
3. Submit a plate query for `ZZ-0001` on the default site and expect 202 with a correlation ID.
4. Poll `GET /api/v1/queries/:correlationId` until no part-source is `pending`.
5. Open `/api/v1/ws` and receive one heartbeat.

`--soak 10m` holds the socket open with heartbeats for ten minutes; that is the M0 tunnel exit check. Smoke runs after every promote and at every milestone exit.

**Lost `CREDENTIAL_KEY`.** The startup canary fails and the app refuses to serve (5.7). This runbook wipes credentials only; it never touches `request_key`, query values or payloads. Documented in the header of `scripts/ops/lost-key.ts`:

1. Confirm the offline copy is also lost.
2. Provision a new `CREDENTIAL_KEY` secret file.
3. Run `lost-key.ts` with the new key mounted. It deletes every `state_credential` row, writing `credentialsInvalidated` (reason `keyLost`) per row, revokes active delegations (`delegationRevoked`, reason `keyLost`), and writes a new `credential` row in `key_canary` (5.5). It ends with `wal_checkpoint(TRUNCATE)`.
4. Start the app. Users see `credentialsMissing` and re-enter credentials.

**Lost `DATA_KEY`.** The startup canary fails and the app refuses to serve (5.7). `request_key.wrapped_dek` values are unrecoverable, so every stored query value and payload is already unreadable; this runbook shreds those payloads only and never touches `state_credential` or delegations. Documented in the header of `scripts/ops/lost-data-key.ts`:

1. Confirm the offline copy is also lost.
2. Provision a new `DATA_KEY` secret file.
3. Run `lost-data-key.ts` with the new key mounted. It deletes every `request_key` row (the values and payloads they wrapped are already unreadable), writes one `retentionPurged` per scope with reason `keyLost`, and writes a new `data` row in `key_canary` (5.5). It ends with `wal_checkpoint(TRUNCATE)`.
4. Start the app. New submissions get fresh `request_key` rows under the new `DATA_KEY`; existing audit rows and metadata are unaffected.

**Lost `DB_ENCRYPTION_KEY`.** Restore from the offline copy of the key; without it the database and every backup are unreadable.

Covers SEC-006, SEC-007, SEC-010, SEC-012, NFR-003.

## 9 CI and repository process

### 9.1 Branches, ruleset and sensitive review

Each change gets a short-lived branch (`feat/`, `fix/`, `docs/`, `chore/`) and one PR, squash-merged. There are no direct commits to `main`. Self-merge is allowed once the required checks pass.

A GitHub ruleset on `main` requires a PR and the status checks `ci` and `sensitive-review`, and blocks force push and deletion. It requires linear history and has an empty bypass list.

`sensitive-review` is a job in `ci.yml`. `.github/sensitive-paths` lists globs for the sensitive areas in `CLAUDE.md` (credentials, delegation, audit, dispatch and adapters, terminal parser, write-back, delete-from-view, the migrations for their tables, `.github/`, `scripts/ci/`, `scripts/ops/`). If the PR diff touches none of them, the job passes. If it touches any, the PR must contain `docs/reviews/pr-<number>.md` with front matter `{ reviewer: "opus-5.5", effort, reviewedSha, verdict: "approve" }`, and no sensitive-path file may change in commits after `reviewedSha`. The Opus review seat writes the artifact (that front matter plus a findings body) and the developer commits it. The check proves a review was recorded, not that it was independent; section 14 covers that.

Amended by ADR-0007 (tiered review: critical, gate, deps and exempt paths replace the one-tier artifact rule).

Amended by ADR-0008 (aggregate ci check, path-scoped jobs, break glass, squash from W6).

### 9.2 Dark merges and migrations

Unfinished capabilities merge dark behind their feature flag (5.8).

Migrations are generated by drizzle-kit, applied at startup, and follow expand-then-contract. Expand adds nullable or defaulted columns. A later release switches reads to them, and a release after that contracts. `audit_event` never contracts: no column is ever removed or renamed.

`scripts/ci/check-audit-migrations.ts` fails the build if any migration statement names `audit_event`, unless it is one of:

- the initial `CREATE TABLE` and `CREATE TRIGGER` statements;
- `ALTER TABLE audit_event ADD COLUMN` of a nullable column;
- `CREATE INDEX ... ON audit_event`.

drizzle-kit's table-rebuild pattern (`__new_audit_event`, `DROP TABLE audit_event`) always fails.

### 9.3 `ci.yml`

Triggers on pull requests and pushes to `main`. Concurrency is cancelled per ref. Runs on `ubuntu-latest` with `contents: read`, plus `packages: write` in the publish job on `main` only.

1. Checkout, pnpm with store cache, `pnpm install --frozen-lockfile`.
2. `biome ci`, `tsc -b`.
3. `pnpm config:validate`: runs every shipped site (default, and `example-ok` resolved through `extends`) through the shape schema, `validateSiteConfig` (4.1) and the fixture policy and mock checks (5.4).
4. Licence check (BR-006): `scripts/ci/check-licences.ts` over `pnpm licenses list --prod --json` for every runtime package. Allowlist: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC. Anything else fails unless `.github/licence-exceptions.json` lists the package, licence, reason and review date. A new runtime dependency with a licence outside the allowlist needs that entry in the same PR.
5. `vitest run --coverage` with per-directory thresholds (10.5).
6. Story-tag gate: `scripts/ci/check-story-tags.ts` (10.2).
7. Contract diff. Regenerate `packages/api/openapi.json` and `packages/core/contracts/ws-events.schema.json` (from the 4.7 Zod schemas). Fail if either differs from the committed copy, so every contract change shows in the PR diff. Run `oasdiff breaking` against the copy on `main`. A breaking change fails unless the PR carries the label `api-breaking`, and the next release notes list it (9.5).
8. `apps/web` production build (Vite), and from M4 the `apps/host-simulator` build.
9. `apps/mobile`: `expo export --platform ios --platform android` from M0 (bundles only).
10. Docker image build (buildx, layer cache). Not pushed yet.
11. Boot smoke. Run the image with a fresh temp volume, CI-generated random secret files, the test deploy config and `ALLOW_MOCK_SOURCES=true`. Wait up to 60 s for `/api/v1/health`. `docker exec` runs `scripts/ops/check-triggers.js`, which asserts both `audit_event` triggers exist. Send SIGTERM and assert a clean exit inside the grace period. From M4, also serve the `apps/host-simulator` build on its own origin next to the container, trusted by the test deploy config, so the embedded Playwright scenarios have a host (6.9).
12. Playwright against that running container. The `@smoke` subset runs first (login, plate `ZZ-0001` submit, ack and correlation ID visible), then the full suite. From M0, every scenario fails on any CSP violation. From M1, `@axe-core/playwright` runs in every scenario and fails on serious or critical violations. The M0 suite is login, the health page (authenticated WebSocket heartbeat) and CSP.
13. Publish (push to `main` only, after steps 1 to 12 pass): log in to GHCR, push `sha-<commit>` and `latest`.

`nightly.yml` runs Stryker mutation testing on `packages/api/src/{audit,credentials,delegation,dispatch}`. It is non-blocking and publishes its report as a workflow artifact. `promote.yml` is described in 8.4.

Amended by ADR-0008 (aggregate ci check, path-scoped jobs, break glass, squash from W6).

### 9.4 Dependabot

`.github/dependabot.yml` updates npm weekly (minor and patch grouped, majors separate), github-actions weekly and docker weekly (the runtime base digest). Security updates are on. Majors are reviewed and never auto-merged. Newest stable, no sitting on known advisories (`CLAUDE.md`).

### 9.5 Release notes and doc refresh

Every milestone exit PR adds `docs/releases/<milestone>.md` (BR-004), containing:

- a generated section from `pnpm config:validate --resolved --diff` against the previous milestone tag (config schema changes, new, renamed or removed keys, migration notes);
- the developer's upgrade-impact summary for site developers;
- API and WebSocket contract changes from the step 7 diff, including any `api-breaking` PRs;
- smoke, restore-test, manual accessibility and Maestro results (10.6, 10.7).

The same PR refreshes `docs/site-config.md`, `docs/api.md` and `docs/demo.md` (BR-005). `promote.yml` refuses a milestone without the notes file.

Covers BR-004, BR-005, BR-006, BR-007.

## 10 Testing strategy

### 10.1 Layers and conventions

Overridden by ADR-0006 (only the phrase "per the superpowers workflow"; TDD for every task stands).

| Layer | Tool | Location | Runs in |
|---|---|---|---|
| Core unit | Vitest; property tests for tokenize/format round trip and canonicalisation idempotency | colocated `packages/core/src/**/*.test.ts` | CI step 5 |
| Client | Vitest, node environment, `ClientPlatform` fakes, `renderHook` for hooks | `packages/client/src/**/*.test.ts` | CI step 5 |
| API | Vitest + Hono `app.request`, fresh libSQL database per test (in-memory; file-backed and encrypted where the test is about storage) | `packages/api/test/` | CI step 5 |
| Web components | Vitest + Testing Library (DOM) | `packages/web-ui`, `apps/web/src` | CI step 5 |
| Native components | React Native Testing Library (M4) | `packages/rn-ui` | CI step 5 |
| End to end | Playwright + axe against the built image | `apps/web/e2e/` | CI step 12 |
| Native flow | Maestro against Expo Go, manual per release (M4) | `apps/mobile/maestro/` | developer phone |

TDD for every task, per the superpowers workflow. Core tests keep one `describe` per requirement ID where one maps. The API has a shared helper that validates every response against its route's declared response schema, and every WebSocket event against its 4.7 schema. `AuditService`, `IdentityService`, `EntityStore` and `EventBus` each have one contract suite that runs against every implementation (5.5).

Test data follows the fixture policy and default-site scenarios (5.4).

### 10.2 Acceptance matrix

Each story's tests carry the story ID in the test title as `[A1]`. `scripts/ci/check-story-tags.ts` reads `docs/testing/stories.json` (story, milestone, test files). It fails CI when:

- any story in a milestone at or below the highest milestone git tag lacks a tagged test in a listed file; or
- run by `promote.yml` for milestone N, any story in milestone N lacks one.

Stories marked `later` are exempt until scheduled. A milestone exits when every story in it and earlier ones is green on `main`, smoke passes against the live URL (8.7), and that milestone's manual passes (10.6, 10.7) are recorded. A9, B3 and B5 are asserted at the API layer by reading `audit_event` rows field by field.

| Story | Given / When / Then (summary) | Layer | Test files | Milestone |
|---|---|---|---|---|
| A1 | Site default State TX; open plate form: only Plate, State=TX, Year, VIN shown (no expanded fields); Enter with plate submits. Table cases: A1 as written, State changed, Year typed (4.3 mode). | core, e2e | `packages/core/src/rules/evaluate-form.a1.test.ts`; `apps/web/e2e/a1-plate-form.spec.ts` (keyboard only) | M1 |
| A2 | State TX to OK: Plate Type appears, required, announced; back to TX: hidden, not required, value not submitted. | core, e2e + axe | `packages/core/src/rules/evaluate-form.a2.test.ts`; `apps/web/e2e/a2-conditional-fields.spec.ts` | M1 |
| A3 | Required field empty; submit: blocked, field marked with `aria-describedby` message, focus on first invalid, count announced. | core, e2e + axe | `packages/core/src/rules/validation.a3.test.ts`; `apps/web/e2e/a3-required.spec.ts` | M1 |
| A4 | `VEH.ABC123..26`: Plate=ABC123, State=TX, Year=2026 runs (clean no-record); `XYZ.123`: `unknownCommand` error tied to the terminal input. | core, e2e | `packages/core/src/terminal/parse.a4.test.ts`; `apps/web/e2e/a4-terminal.spec.ts` (keyboard only) | M1 |
| A5 | Toggle form and terminal: mode switches; positioned user values survive both ways; unpositioned fields kept with "n fields not shown". | core (property), e2e | `packages/core/src/terminal/roundtrip.a5.test.ts`; `apps/web/e2e/a5-toggle.spec.ts` | M1 |
| A6 | Submit: 202 with correlation ID and `acknowledgedAt` after commit; toast plus a copyable correlation ID and ack time on the request entry; notification when mock results return. | api, e2e | `packages/api/test/queries/submit.a6.test.ts`; `apps/web/e2e/a6-ack.spec.ts` | M2 |
| A7 | STOLEN and WANTED critical; response for `ZZ-0001` contains STOLEN: critical style plus marker; STOLEN only in a detail-only path still badges the card at 1024x768. | core, e2e | `packages/core/src/response/assess-result.a7.test.ts`; `apps/web/e2e/a7-highlight.spec.ts` | M2 |
| A8 | Mapping configured; results return: mapped summary elements render; expand shows detail (button `aria-expanded`); unmapped source falls back to generic dump. | core, e2e | `packages/core/src/response/map-response.a8.test.ts`; `apps/web/e2e/a8-mapping.spec.ts` | M2 |
| A9 | Submit: `submitted` per part (actor snapshot, queryType, type-field values, selected and dispatched sources, plateOnly, configHash), `acknowledged` (at), `sourceResponded` per source (status, latency, credential owner, adapter_kind), all epoch ms. | api | `packages/api/test/audit/query-audit.a9.test.ts` | M2 |
| B1 | Two default sources, `TIMEOUT` on one; submit: first `returned`, second `timedOut` at `timeoutMs` from ack; late settlement ignored. | api (fake timers), e2e | `packages/api/test/dispatch/timeout.b1.test.ts`; `apps/web/e2e/b1-multi-source.spec.ts` | M3 |
| B2 | Person query with `alsoRun` wanted check; submit: parts 0 and 1 under one correlation ID, `submitted` per part (origin, parent, fieldMap), results per part per source. | api, e2e | `packages/api/test/dispatch/nested.b2.test.ts`; `apps/web/e2e/b2-nested.spec.ts` | M3 |
| B3 | Trainee requests delegation; officer approves on own session with code; trainee query dispatches with officer's credentials; `source_result.credential_user_id` and `delegation_id` set; `submitted` actor is trainee, `sourceDispatched` and `sourceResponded` name the officer. Diverges from B3 wording: the officer approves on their own device using stored credentials instead of typing them into the trainee session (5.7). | api, e2e (two contexts) | `packages/api/test/delegation/delegated-query.b3.test.ts`; `apps/web/e2e/b3-delegation.spec.ts` | M3 |
| B4 | Stored credentials; change with step-up: next dispatch sends the new username (mock records it); `credentialsChanged` audited; raw-bytes scan finds no old ciphertext (10.4). | api | `packages/api/test/credentials/change.b4.test.ts` | M3 |
| B5 | Three results; hide two: list, single GET and replay exclude them; `source_result` rows intact; two `result_visibility` rows; one `deletedFromView` per real insert; repeat hide inserts and audits nothing; admin `includeHidden` returns them. | api, e2e | `packages/api/test/results/hide.b5.test.ts`; `apps/web/e2e/b5-delete-from-view.spec.ts` | M3 |
| B6 | Response; "Add to supplemental": mapped data written to the target record through `EntityStore`. | api (EntityStore contract) | `packages/api/test/writeback/supplemental.b6.test.ts` | later |
| B7 | Site-narrowed property type list; open property form: only enabled types listed; required fields follow selected type; disabled codes never appear. | core, e2e | `packages/core/src/rules/property-picklist.b7.test.ts`; `apps/web/e2e/b7-property.spec.ts` | M3 |
| C1 | Mobile-unit and mobile personas; results return: condensed summary cards; orientation preference persists across logout and login. | e2e (1024x768, 1366x768, 800x600), Maestro | `apps/web/e2e/c1-mobile-unit.spec.ts`; `apps/mobile/maestro/c1-condensed.yaml` | M4 |
| C2 | CAD Mobile opens: quick-access query types one tap from home; targets at least 48x48 and grow with OS font scale to 2x. | rn component, Maestro | `packages/rn-ui/src/quick-queries.c2.test.tsx`; `apps/mobile/maestro/c2-quick-queries.yaml` | M4 |

### 10.3 Security tests (API)

Each test is required from the milestone that introduces its route or feature. Files live under `packages/api/test/security/`.

- **Route by caller matrix** (`route-matrix.test.ts`). It is generated from `openapi.json`, so a route with no matrix row fails. It runs twice: against the all-on test config, and against `packages/config/test/flags-off.json`, asserting 404 for every `x-feature` route. Expectations:
  - anonymous: 401;
  - another user's correlation ID or result IDs (GET, hide, retry): 404;
  - non-admin on `admin/*`: 403;
  - missing `X-Requested-With` on a state-changing route: 403;
  - disabled feature: 404;
  - `GET /api/v1/config` without a session: 401, and the body matches the `ClientSiteConfig` allowlist (no `Source.server`).
  
  Policy-function positives are asserted too: an admin view writes `adminViewed`, the delegating officer gets read-only access, and hide is owner-only.
- **WebSocket** (`ws-auth.test.ts`). Upgrade is rejected with no session, an expired session, a foreign Origin, a missing Origin with a cookie, or a bearer token in the query string. It is accepted with a missing Origin and a bearer token in `Authorization`. No event crosses users. The socket closes on logout, expiry and revocation, and nothing is pushed after logout.
- **Credential non-disclosure** (`credentials-disclosure.test.ts`). The list and per-source GET bodies never contain the secret, ciphertext, IV or auth tag. PUT and DELETE without step-up are rejected. A row copied from officer to trainee (swapped AAD) fails decryption, writing `credentialsInvalidated` and producing `credentialsMissing`.
- **Log capture** (`log-capture.test.ts`). Captures the logger and error reporter across a submit, a credential PUT, a delegation approval and an adapter that throws with its request config. Asserts that no FieldDef value, secret plaintext, `DB_ENCRYPTION_KEY`, `CREDENTIAL_KEY` or `DATA_KEY` material, or session token appears, and that `Secret<T>` redacts under `JSON.stringify`, `String()` and `util.inspect`.
- **Delegation failures** (`delegation-failures.test.ts`). Covers:
  - a wrong code;
  - a request past 5 minutes;
  - approval without fresh auth or TOTP;
  - an officer lacking the delegator role;
  - an officer missing credentials for a source (the error names it);
  - a revoked or expired delegation;
  - a trainee session ending (`sessionEnded`);
  - the code-redemption rate limit.
  
  Each asserts that no active delegation resolves and that the expected audit rows exist.
- **Auth limiter and sessions** (`auth-limits.test.ts`). 10 failures in 15 minutes per account locks it for 15 minutes. 100 per 15 minutes per IP, keyed on `CF-Connecting-IP`. Lockout is audited. Limiter state survives a restart. `mfaRequired` blocks non-auth routes until enrolment. Idle 30 minutes and absolute 12 hours are checked with a fake clock.
- **Storage** (`storage.test.ts`). Opening the database file without `DB_ENCRYPTION_KEY` fails. A mismatched `CREDENTIAL_KEY` fails the canary and startup refuses to serve. A mismatched `DATA_KEY` fails to unwrap `request_key` rows without affecting `state_credential`. `UPDATE` and `DELETE` on `audit_event` abort. Dropping a trigger makes startup refuse to serve.
- **Raw bytes** (`raw-bytes.test.ts`). Runs on a database opened without whole-DB encryption, so the scan sees the column layer. After a credential change and a delete plus checkpoint, the old ciphertext, username and secret bytes are absent from the database and WAL files.
- **Mock gate** (`mock-gate.test.ts`). A source with no `kind` fails to load. A `mock` kind fails startup when `ALLOW_MOCK_SOURCES` is not `true`. `adapter_kind` is recorded on `source_result` and in `sourceResponded`.
- **Submit guards** (`submit-guards.test.ts`). `configHash` mismatch returns 409. Unknown field keys return 400. A posted `mode` mismatch returns 400. Hidden field values are neither persisted nor dispatched. A replayed `Idempotency-Key` returns the original 202 with no new rows.

### 10.4 Pipeline and durability tests (API)

- **Replay** (`packages/api/test/feed/replay.test.ts`). Submit a two-source query with staggered mock latency, close the socket after the first event, and reconnect with the last `seq`. Each missed event arrives exactly once, in `seq` order. More than 500 events due, or a cursor older than 24 hours, yields `resync`. Hidden results are not replayed. The client high-water-mark dedup is tested in `packages/client/src/ws/dedup.test.ts`.
- **Timeouts and nesting** (`dispatch/*.test.ts`, fake timers). B1 and B2 as above. Status is write-once from `pending`. A nested part failing validation becomes `skipped` with `partSkipped` while the parent proceeds. Per-source (4) and global (32) caps are enforced. There are no retries.
- **Concurrency** (`dispatch/concurrency.test.ts`). 20 parallel submits from 5 users against a file-backed WAL database. Each gets a 202 and, per part, `submitted`, `acknowledged` and one `pending` row per (part, source). No `SQLITE_BUSY` reaches a caller.
- **Kill during dispatch** (`lifecycle/kill.test.ts`). Spawns the built server as a child process on a file database, submits to a slow mock source, and sends SIGKILL after the 202. On restart the sweep marks those rows `interrupted` with one `interrupted` audit row each and an `event_log` entry, and nothing is re-dispatched.
- **SIGTERM drain** (`lifecycle/drain.test.ts`). SIGTERM during dispatch: a new submit gets 503, in-flight sources reach an outcome, and the process exits 0 within the drain bound.
- **Audit fields** (`audit/fields.test.ts`). For every `AuditEventType` (4.7), trigger the event and assert each field of its details schema plus the SEC-010, SEC-011 and SEC-012 fields (actor snapshot, credential owner, epoch ms, integer id order). This asserts on audit rows as well as executing the code that writes them.
- **Offline** (`apps/web/e2e/offline.spec.ts`). `context.setOffline(true)`: submit stays focusable with `aria-disabled` and a visible reason; on reconnect, pending rows are refetched over HTTP.

### 10.5 Coverage and mutation

| Directory | Threshold |
|---|---|
| `packages/api/src/audit`, `credentials`, `delegation`, `dispatch` | 100% branches |
| `packages/core` | 95% lines and branches |
| `packages/api` (rest) | 85% lines |
| `packages/client` | 85% lines and branches |

`apps/web`, `packages/web-ui` and `packages/rn-ui` carry no threshold. Logic belongs in `packages/client`, and those packages are covered by e2e and axe. Stryker runs nightly and non-blocking on the four sensitive API directories (9.3).

### 10.6 Accessibility

`@axe-core/playwright` runs in every Playwright scenario from M1 and fails on serious or critical violations (9.3). Named Playwright cases:

- keyboard-only A1 and A4 flows from M1;
- typing while a result arrives, asserting that focus, the input value and the live-region text are unchanged (6.6);
- 1920x1080 at 200% zoom, where the persona and response mapping do not change (6.1);
- 320 CSS px reflow;
- the mobile-unit viewports 1024x768, 1366x768 and 800x600 (6.3);
- 1024x768 with STOLEN in a detail-only element, where the card shows the critical badge (4.5).

Manual passes, recorded in `docs/releases/<milestone>.md`:

- NVDA with Chrome at the M2 and M3 exits;
- VoiceOver and TalkBack at the largest text size at the M4 exit;
- a daylight readability check of the mobile-unit day theme at the M4 exit (6.3).

### 10.7 Native

`expo export` for iOS and Android runs from M0 (9.3). From M2, API tests cover bearer auth on REST and on the WebSocket upgrade (`packages/api/test/security/bearer.test.ts`). The Maestro flows for C1 and C2 run manually against Expo Go at each release from M4, with results in `docs/releases/`. The Better Auth Expo plugin fallback (14) triggers if the token is not restored after a cold start, which the Maestro flow checks first.

### 10.8 Config and fixture validation

`packages/core/src/config/validate.test.ts` holds one failing fixture per `validateSiteConfig` rule. `scripts/mock-data/generate.test.ts` holds one per fixture-policy rule:

- a real-format plate;
- a VIN that passes the ISO 3779 check digit;
- a plausible DOB;
- a non-synthetic name or address.

Both assert the JSON path in the error. `config:validate` runs over every shipped site and mock file in CI step 3, including mapping-path resolution against mock defaults and scenarios.

Covers FR-043, FR-044, FR-064, NFR-003, NFR-004, SEC-010, SEC-011, SEC-012, SEC-013.

## 11 Decisions on spec TBDs

| Open question | Decision |
|---|---|
| Rule condition language | Structured JSON conditions, no expression strings, no eval (4.2). |
| Values carry over on form and terminal toggle (FR-056) | Yes, both directions; the draft is user values and the terminal a derived view (4.4, 6.7). |
| Two-digit year | `year` fields and site-added two-digit date formats: 2000 plus by default, latest year not after today for `century: "past"` (DOB); default date formats take four-digit years only (4.3, 4.4). |
| Per-source timeout default (FR-044) | 10s, per source in config. The dispatcher owns the deadline; late settlements never change a write-once status; no retries (5.2). |
| Acknowledgment target (NFR-004) | Split. Server target: 200ms from request receipt to 202, covering the one step-3 transaction, reported in `Server-Timing` (5.2). End-to-end: the client reports ack receipt over the WebSocket; recorded as a metric, not an audit row, and measured per milestone with no pass/fail target, because the requirement's own target is TBD. |
| Transaction volume target (NFR-002) | Single node is a hard limit. The caps are the ceiling: the dispatcher's global cap of 32 in-flight source calls, 4 per source, 30 submits per minute per user, one SQLite writer. The concurrency test (10.4) proves correctness at that ceiling, not throughput beyond it. No Postgres move is claimed (14). |
| Retention of responses, including those deleted from view | Mechanism now, policy off: crypto-shred per scope, hidden and visible alike; `request_key` DEKs from M1, `retention` config M2, `purge.ts` M3 (5.5). |
| Session limits | Absolute 12h, idle 30 min, for web, native bearer and embedded sessions (5.6). |
| Minimum touch target | 48x48 CSS px; native targets grow with OS font scale to 2x (6.3, 6.10). |
| FR-050 "addable to a user layout" | Toggle in M1, pane in M2; partial until M2 (6.2). |
| Scan auto-submit (FR-074) | Stays TBD, Phase 3. Default will be confirm first. |
| Background lookup launch (FR-071) | Stays TBD, Phase 3. Expo push notification action is the leading option. |
| Background notification content (FR-065) | Push payload carries only an opaque correlation ID and generic text; content is fetched through the authorized API after unlock. Background push is not built in the prototype (6.10). |
| B6 and B7 placement | B7 (property picklist) moves to M3 with Phase 2. B6 (add to supplemental) stays later: it needs the host embedding contract (`writeBackRequest`, 6.9) and a host-backed `EntityStore` (5.5), and neither has a real host to write to in the prototype. |
| Compliance posture (SEC-020) | No CJIS data exists in the prototype (1). The architecture targets the CJIS Security Policy control areas it touches: identification and authentication (5.6), access control (5.2 policy function), audit and accountability (4.7, 5.5), encryption at rest and in transit (5.5, 5.7, 5.9), and configuration management (9). Certification is out of scope; the adopting company certifies. |
| Compliance posture (SEC-021) | GDPR aimed at, not certified. Minimisation: audit `details` hold identifiers, metadata and `role:"type"` values only (4.7). Storage limitation: the retention mechanism above. Erasure: crypto-shred of query values and payloads. Audit rows are never shredded: the prototype keeps them indefinitely under the legal-obligation basis, and the adopting agency sets the period. `clientIp` and `actor_email` in audit are personal data kept on the same basis. Users are disabled in one transaction; a user row may be hard-deleted by ops script any time after disable, because audit carries the actor snapshot and has no foreign key (5.5, 5.6). |
| Compliance posture (SEC-022) | Whether the EU Cyber Resilience Act applies is the adopting company's determination. The prototype stays in its neighbourhood through existing practice: newest stable dependencies with no known advisories (9), licence allowlist (9), `docs/threat-model.md` and an independent human security review before handoff (14). |

## 12 Milestones and phases

A milestone is a release tag promoted through the promote workflow (8.4), not a merge. Every merge still deploys to the URL, so unfinished capabilities merge dark behind their feature flag (5.8).

### 12.1 Tracks and ownership

| Track | Machine | Owns |
|---|---|---|
| A | Linux | `packages/api`, `deploy/`, `.github/`, `scripts/ops/`, `scripts/mock-data/`, `packages/config/mock/` |
| B | Windows | `apps/web`, `packages/web-ui`, `packages/tokens`, `packages/client`, Playwright, axe |
| Core | either | `packages/core`, `packages/config/sites/`, `packages/config/locales/`. Small PRs from either track. |
| D | either, from M4 | `apps/mobile`, `packages/rn-ui`, Maestro flow |

Rules:

- Contract changes land first: a Core schema, OpenAPI route, WebSocket event or audit type merges in its own PR before any consumer, and both tracks rebase on it.
- Backend leads by half a milestone: Track A's work for a phase is on `main` (dark if needed) before Track B's consumer merges.
- A phase closes when its Gate cell holds on `main`. The next phase may start on a track whose inputs are met.
- Sensitive areas (CLAUDE.md list) are implemented on Opus per CLAUDE.md. Every phase that touches sensitive code runs with an Opus critic, and every phase that builds UI does too.

### 12.2 M0 Skeleton and M1 Forms and terminal

| Phase | Track A (Linux) | Track B (Windows) | Core | Gate |
|---|---|---|---|---|
| P0 contracts | Workspace skeleton; CI skeleton | Tokens skeleton; web shell scaffold | Config schema v1; audit catalogue with the query event schemas frozen (`submitted`, `acknowledged`, `sourceDispatched`, `sourceResponded`, `interrupted`, `partSkipped`); WS event schemas; OpenAPI skeleton | Typecheck and CI green; contracts frozen |
| P1 foundation | Docker secrets; encrypted SQLite; Better Auth + session limits + limiter, with the `loginSucceeded`, `loginFailed` and `logout` schemas; `/meta`; `/health`; locales route; WS heartbeat; image smoke; tunnel; release promote; `backup.sh` and `restore-test.sh` | Login screen; three theme modes; Playwright + axe + CSP check in CI | Rules engine + conditions | M0 exit: login live; heartbeat socket alive 10 min through the tunnel |
| P2 engine | Config load + validate CLI; `GET config`; policy function; idempotency; `POST queries` step-3 transaction with pending rows, per-request DEKs and audit | Generic field renderer; rules-driven form; shortcut engine | Canonicalisation; tokenize / parser / formatter; planner | Form works against `GET config`; parser property tests green |
| P3 flow | Mock adapter + fixture generator; `event_log`; WS `sourceStatus`; dispatch deadlines | Terminal UI; toggle with user-value draft; announcements; submit against real API | | M1 exit: A1 to A5 green; keyboard-only Playwright; live smoke |

The P1 heartbeat socket ships with the 5.3 upgrade checks (Origin, session binding, bearer header only), because it is the first socket. The locales route (5.8) ships in P1 with the login screen, which needs its strings. The `expo export` CI step runs from M0 against a placeholder `apps/mobile` shell (9.3).

Overridden by ADR-0012 (M1 P3 row, Track A cell).

### 12.3 M2 Results and audit

| Phase | Track A (Linux) | Track B (Windows) | Core | Gate |
|---|---|---|---|---|
| P0 contracts | | | ResponseMapping element union; `assessResult` signature; `resultHidden` and `resync` events; admin, ops and `sessionRevoked` audit schemas; OpenAPI for `GET queries`, admin audit and queries | Contracts frozen; OpenAPI diff reviewed |
| P1 feed | Replay by user seq with caps and `resync`; `GET queries` list and one, filtered by policy function and hidden rows; `Server-Timing`; ack-receipt metric | `packages/client` WS client with replay cursor and seq dedup; results list with per-source status; ack toast; correlation ID and ack time on each entry; announcer severity rules | Response mapper with precedence score and generic dump; `assessResult`; highlighter with `except` and Unicode boundaries | A6 green; socket-close-mid-dispatch replay test green |
| P2 audit | Sweeper with `sessionRevoked` on expiry (5.2); admin audit route with cursor paging, indexes, `auditViewed`, NDJSON export; `admin/queries` `includeHidden`; `scripts/ops/grant-role.ts`; `retention` config block; bearer REST + WS API tests | Summary/detail toggle; table elements (UX-016); severity badge with icon, text and colour on card, row and notification; admin audit viewer; terminal pane layout | `config:validate` resolves mapping paths against mock payloads | A7 to A9 green |
| P3 hardening | Security test matrix for M2 routes; backup restore test | Playwright STOLEN-in-detail-only test at 1024x768; type-while-result-arrives test; setOffline test | | M2 exit (12.7) |

### 12.4 M3 Workflow and compliance

| Phase | Track A (Linux) | Track B (Windows) | Core | Gate |
|---|---|---|---|---|
| P0 contracts | | | `SiteConfig.delegation` and `auth` blocks; credential and delegation audit types; `credentialsMissing` / `credentialsRejected` statuses; `delegationChanged` event; OpenAPI for credentials, delegations, `results/hide` | Contracts frozen; `features` flags for credentials, delegation, hide off in shipped site config |
| P1 credentials and MFA | Envelope credential store with AAD and `key_version`; canary check and lost-key runbook; `secure_delete` + checkpoint; `GET` list and per source; `PUT`/`DELETE` with step-up; `mock_credential_state`; TOTP + `mfaRequired`; user disable transaction | Credentials settings; credential status on cards with deep link and "retry this source"; TOTP enrolment; step-up prompt | | B4 green; raw-bytes credential scan and log-capture tests green |
| P2 multi-source, nested, hide | Nested parts with children cap and `skipped`; per-source and global caps; `results/hide` with `deletedFromView`; crypto-shred `scripts/ops/purge.ts` | Per-part, per-source status; nested grouping under one correlation ID; multi-select delete from view with confirm; property form | Nested `evaluateForm` on mapped values; type-field picklist filtering for B7 | B1, B2, B5, B7 green |
| P3 delegation | Request / approve with code and QR; rate-limited redemption; fresh auth or TOTP on approve; session binding and `sessionEnded` revoke; override rule; list, revoke, `me/delegated-queries`; audit filter actor or owner | Trainee request dialog with QR; officer approve screen; persistent trainee banner; delegation list and revoke | | M3 exit (12.7); flags on |

### 12.5 M4 Mobile and host integration

| Phase | Track A (Linux) | Track B (Windows) | Track D (mobile) | Core | Gate |
|---|---|---|---|---|---|
| P0 contracts | Bearer session cold-start check | | Expo shell on `packages/client`; `rn-ui` skeleton | postMessage v1 message schemas, including `identityRequest` | `expo export` iOS and Android green; contracts frozen |
| P1 layouts and host | Better Auth Expo plugin with fallback; embedded-mode `IdentityService` (host JWT); `frame-ancestors` and CORS allowlists from deploy config | Mobile unit layout at 1024x768, 1366x768, 800x600; 7:1 day theme; orientation preference; 200% zoom and 320px reflow; iframe embed, postMessage v1 and `apps/host-simulator` | Login; query panel and condensed results on `rn-ui` | | C1 green on web; host-simulator Playwright test green |
| P2 native | Security tests for embedded identity | | Home-screen quick queries; OS autocomplete hints; font scaling to 2x; reduced motion; delete-from-view button; `announceForAccessibility`; Maestro flow | | C1 and C2 green on native |
| P3 exit | Backup restore test | Manual daylight check on the mobile unit theme | VoiceOver and TalkBack at largest text; Maestro results in `docs/releases/` | | M4 exit (12.7) |

Embedded mode (6.9), including `apps/host-simulator`, lands in M4 alongside `rn-ui`, the other host-embedding path, because the two share the host-embedding work.

### 12.6 Later

B6 add to supplemental (rationale in 11), background push and FR-071 (C5), C3 and C4 scans, C6 voice spike, FR-045 aggregation spike, offline submit queue (NFR-003), audit hash chain.

### 12.7 Milestone exit criteria

Every milestone exits only when all of these hold: its story tests are green and tagged (10), its security tests are green, the named accessibility pass is done, the smoke run against the live URL passes (`scripts/ops/smoke.sh`), a backup restore is tested, `docs/releases/<tag>.md` is written from `config:validate --diff` (BR-004), product docs are refreshed (BR-005), and the release tag is promoted.

| Milestone | Stories | Security tests | Accessibility pass |
|---|---|---|---|
| M0 | none; login smoke | Auth rate limit and lockout; WS upgrade rejections (no session, expired, foreign Origin, missing Origin with cookie); log-capture for secrets and keys | axe on login; zero CSP violations |
| M1 | A1 to A5 | Route x caller matrix for config, queries, meta; unknown keys and hidden values rejected; `configHash` 409 | axe on every scenario; keyboard-only plate and terminal flows |
| M2 | A6 to A9 | No cross-user events; replay excludes hidden; admin-only audit routes; bearer REST + WS | NVDA + Chrome |
| M3 | B1 to B5, B7 | Credential responses never contain secret or ciphertext; step-up; delegation wrong code, expired, revoked with audit rows; hide owner-only | NVDA + Chrome |
| M4 | C1, C2 | Embedded JWT issuer, audience and JWKS rejections; frame-ancestors allowlist | VoiceOver + TalkBack at largest text; manual daylight check |

Overridden by ADR-0012 (M1 row).

## 13 Traceability

All 87 IDs from the spec's Project Specifications table. Stories refer to Appendix A. FR-065 and NFR-002 have two labelled rows each; every other ID has one. Status: **covered** (fully addressed), **partial** (addressed with a stated gap), **deferred** (addressed in principle, work later), **non-goal** (out of scope per 2).

| ID | Where | Story | Milestone | Status | Note |
|---|---|---|---|---|---|
| BR-001 | 4.1, 5.8, 7 | | M1 | covered | Config-driven customization |
| BR-002 | 3, 6.1, 6.9 | | M4 | covered | Standalone and embedded modes; `records` persona |
| BR-003 | 2 | | M0 | covered | No new licensing; runs under the host licence |
| BR-004 | 2, 7, 9.5 | | every | covered | `docs/releases/<tag>.md` from `config:validate --diff` |
| BR-005 | 2, 9.5, 12.7 | | every | covered | Docs refresh per milestone exit |
| BR-006 | 2, 9.3 | | M0 | covered | Licence allowlist in CI, exceptions file |
| BR-007 | 5.1, 7, 9.5 | | M1 | covered | OpenAPI, `docs/api.md` |
| FR-001 | 4.3, 6.2 | A3 | M1 | covered | |
| FR-002 | 4.2, 4.3 | A2 | M1 | covered | |
| FR-003 | 4.2, 4.3 | A2 | M1 | covered | |
| FR-004 | 4.1, 4.3 | A1 | M1 | covered | Defaults precedence |
| FR-005 | 4.3, 6.2 | A3 | M1 | covered | |
| FR-006 | 6.2, 6.4 | A1 | M1 | covered | |
| FR-007 | 4.1, 6.2, 6.4 | | M1 | covered | `quickAccess`; quick-access bar; `quickType1..9` |
| FR-008 | 4.1, 7 | | M1 | covered | Custom fields; overlay example |
| FR-010 | 4.3 | A1 | M1 | covered | |
| FR-011 | 4.3 | A2 | M1 | covered | |
| FR-012 | 4.3, 4.6 | | M1 | covered | `FormState.mode`; planner intersect |
| FR-020 | 4.1, 4.4, 7 | | M1 | covered | Shipped `PER` query type on the generic `FieldDef` model (7) |
| FR-030 | 4.1, 7 | B7 | M3 | covered | Shipped `PRO` query type: serial, `propertyType`, description (7) |
| FR-031 | 4.1 | B7 | M3 | covered | `enabled` codes; overlay |
| FR-032 | 4.2, 4.3 | B7 | M3 | covered | Type-fields model |
| FR-040 | 4.6, 5.2 | B1 | M3 | covered | |
| FR-041 | 4.6, 6.2 | B1 | M3 | covered | |
| FR-042 | 4.6, 5.2 | B2 | M3 | covered | One nesting level |
| FR-043 | 5.2, 6.2 | B1 | M3 | covered | Status per part per source |
| FR-044 | 5.2, 5.4, 11 | B1 | M3 | covered | Deadline mechanism from M1 |
| FR-045 | 2 | | | non-goal | Aggregation spike, not built |
| FR-050 | 4.4, 6.2, 11 | A4 | M2 | partial | Toggle in M1; pane layout (addable to a layout) in M2 |
| FR-051 | 4.1, 4.4 | A4 | M1 | covered | Site-level delimiter |
| FR-052 | 4.1, 4.4 | A4 | M1 | covered | Presets select type-level fields |
| FR-053 | 4.4, 6.4 | A4 | M1 | covered | |
| FR-054 | 4.4 | A4 | M1 | covered | |
| FR-055 | 4.4 | A4 | M1 | covered | |
| FR-056 | 4.4, 6.7, 11 | A5 | M1 | covered | Values carry over both ways |
| FR-060 | 4.5 | A8 | M2 | covered | |
| FR-061 | 5.5, 6.9, 11 | B6 | later | deferred | `EntityStore` interface only; no real host to write to |
| FR-062 | 5.1, 5.2, 5.5, 6.2, 6.10 | B5 | M3 | covered | |
| FR-063 | 5.5 | B5 | M3 | covered | Crypto-shred retains rows |
| FR-064 | 5.2, 6.2 | A6 | M2 | covered | |
| FR-065 (foreground) | 5.3, 6.2, 6.6, 6.7, 6.8 | A6 | M2 | covered | WebSocket results and notifications while the app is open |
| FR-065 (background) | 6.10, 11 | C5 | later | deferred | Background push partial: opaque payload designed, not built |
| FR-070 | 4.1, 6.10 | C2 | M4 | covered | |
| FR-071 | 6.10, 11 | C5 | later | deferred | Launch mechanism TBD |
| FR-072 | 2 | C3 | | non-goal | Barcode scanning, not built |
| FR-073 | 2 | C4 | | non-goal | OCR, not built |
| FR-074 | 2, 11 | C3, C4 | | non-goal | Scan execution, not built; confirm-first is the stated default if built |
| FR-075 | 2 | C6 | | non-goal | Voice input, not built |
| UX-001 | 6.1, 6.2 | | M1, M4 | covered | Dispatch M1; mobile unit and mobile M4 |
| UX-002 | 6.3, 6.5, 6.10 | C2 | M4 | covered | 48x48 CSS px; native font-scaled targets |
| UX-003 | 6.10 | | M4 | partial | OS autocomplete hints; no recent-values cache, by design |
| UX-004 | 4.3, 6.2 | A2 | M1 | covered | |
| UX-010 | 4.5, 6.2, 6.3 | A7 | M2 | covered | |
| UX-011 | 4.1, 4.5, 6.5, 7 | A7 | M2 | covered | Severity styles and marker; contrast validation |
| UX-012 | 4.5, 6.1, 6.3 | C1 | M4 | covered | |
| UX-013 | 6.3 | C1 | M4 | covered | |
| UX-014 | 5.1, 6.1, 6.3 | C1 | M4 | covered | `user_preference` persists it |
| UX-015 | 4.5, 6.2 | A8 | M2 | covered | |
| UX-016 | 4.5, 6.2 | | M2 | covered | Table element / grid |
| SEC-001 | 5.7 | B3, B4 | M3 | covered | |
| SEC-002 | 5.4, 5.7, 6.2 | B4 | M3 | covered | |
| SEC-003 | 5.7, 6.2 | B3 | M3 | covered | Diverges from B3 wording: the officer approves on their own device and their stored credentials are used; no officer password or state credential is typed in the trainee's session |
| SEC-004 | 5.7 | | M3 | covered | Delegation purposes generalize beyond training |
| SEC-005 | 5.6 | | M3 | partial | TOTP only; MFA beyond TOTP is a non-goal (2) |
| SEC-006 | 5.5, 5.7, 5.9, 6.7, 6.10, 8 | | M0, M3 | covered | Whole-DB encryption M0; credential envelope M3 |
| SEC-007 | 5.4, 5.9 | | M0 | partial | Prototype's own boundary secured; real adapters' connections are out of scope (2) |
| SEC-010 | 4.7, 5.2, 8.7 | A9 | M2 | covered | |
| SEC-011 | 5.2, 5.7, 6.2 | B3 | M3 | covered | Owner per source result |
| SEC-012 | 5.2, 8.7 | A9 | M2 | covered | |
| SEC-013 | 4.7, 5.5 | B5 | M3 | covered | |
| SEC-014 | 4.7, 5.2, 5.3, 6.2, 6.7 | A6 | M2 | covered | |
| SEC-020 | 2, 11, 14 | | every | partial | Targeted to CJIS control areas, not certified; adopting company certifies |
| SEC-021 | 5.5, 11, 14 | | M1, M2, M3 | partial | Per-request DEKs M1; retention config M2; crypto-shred M3; targeted, not certified |
| SEC-022 | 11 | | | deferred | Whether EU CRA and other regs apply is the adopting company's determination |
| SEC-023 | 11, 14 | | | non-goal | Not triggered: no Shared Platform service is built here; independent human security review before handoff is the interim mitigation |
| SEC-024 | 1, 11 | | | non-goal | Not triggered: prototype holds no regulated/CJIS data |
| NFR-001 | 4.1, 5.8, 6.2, 6.7, 7 | | M1 | covered | Mechanism complete; ships `en` only |
| NFR-002 (multi-source and nested) | 3.2, 4.6, 5.2 | B1, B2 | M3 | covered | Parts and sources dispatched in parallel under one correlation ID |
| NFR-002 (volume) | 5.5, 11, 14 | | | partial | Ceiling is the existing caps (32 global, 4/source, 30/min/user); no throughput number; single-node hard limit |
| NFR-003 | 3.2, 5.2, 5.3, 6.7, 6.8, 8.7 | | M1, M2 | partial | No offline submit queue (non-goal, 2) |
| NFR-004 | 3.2, 4.7, 5.2, 11 | A6 | M1, M2 | partial | Server 200ms target M1; end-to-end metric M2, no pass/fail target |
| PLT-001 | 5.5, 5.6, 6.9 | | | non-goal | `IdentityService` seam only; real Shared Platform identity integration out of scope (2) |
| PLT-002 | 5.5, 5.7 | | | non-goal | Delegated-credential identities stay local; Shared Platform tie-in out of scope (2) |
| PLT-003 | 5.5 | B6 | later | non-goal | `EntityStore` seam only; no real Shared Platform entities to write to (2) |
| PLT-004 | 5.1, 5.3, 5.5 | | | non-goal | `EventBus` seam only; REST/events integration with Shared Platform out of scope (2) |
| PLT-005 | 5.5 | | | non-goal | `AuditService` seam only; centralized audit to Shared Platform out of scope (2) |
| PLT-006 | 3, 6.1, 6.9 | | M4 | covered | Dispatch-only, Records-only, Dispatch+Records, Mobile Field Reporting, CAD Mobile |
| PLT-007 | 3, 5.8, 6.9 | | M4 | covered | Works through existing host integration (iframe/API), no legacy dependency added |
| PLT-008 | 3, 5.5 | | M0 | covered | No legacy layer dependency |

## 14 Risks

- **Two UI codebases.** Web is Vite + React DOM and native is Expo, so layout and component work happens twice. Mitigation: `packages/core`, `packages/client` and `packages/tokens` are shared; native is built only at M4; `rn-ui` covers the mobile persona only.
- **Better Auth Expo plugin** is younger than its web path. Mitigation: native auth is exercised at M4; fallback to a plain bearer session triggers when the token is not restored after cold start.
- **WebSocket through Cloudflare Tunnel.** Mitigation: M0 exit requires the authenticated heartbeat socket alive 10 min through the tunnel.
- **Single node is a hard limit.** The replay cursor, dispatch queue and `EventBus` assume one process and one writer.
  The NFR-002 ceiling is stated in 11.
- **Third-party cookies in embedded mode.** The embedded session rides a `Partitioned` third-party cookie (5.6); a browser that blocks such cookies in frames breaks embedded mode.
- **Home laptop uptime.** Compose `restart: unless-stopped` and the `deploy-pull` timer cover reboots; nightly encrypted off-box backups cover disk loss; there is no failover.
- **Correlated AI authorship and review.** The same model family writes and reviews credential, audit and dispatch code, so blind spots are shared. Mitigation: `docs/threat-model.md` kept current, and an independent human security review before handoff.
- **Bus factor.** One developer. Mitigation: runbooks in `scripts/ops/` (backup, restore, lost key, purge, grant role), specs and release notes in `docs/`.
- **Provenance.** Most code is agent-written. Mitigation: a provenance note in the README.
- **Compliance posture.** SEC-020 to SEC-022 are aimed at, not certified (11). A company adopting the code must run its own certification and the SEC-023 architecture review.
- **Accessibility verification is partly manual.** axe catches a subset; screen-reader and daylight passes depend on one person at each exit (12.7).
- **Config schema churn.** Sites break on schema changes. Mitigation: `configSchemaVersion` in `/meta`, `migrateConfig` and `config:migrate`, forward-tolerant parse, release notes from `config:validate --diff`.
- **Mock-shape drift.** Response mappings are tuned to mock payloads that real sources may not match. Mitigation: `config:validate` resolves mapping paths against mocks and warns; the generic dump fallback shows unmapped data; the fixture policy keeps shapes plausible.
- **Expo Go SDK lockstep.** Expo Go on a phone runs one SDK version. Mitigation: upgrade the Expo SDK and the phone's Expo Go together; Expo majors from Dependabot are reviewed, never auto-merged.
