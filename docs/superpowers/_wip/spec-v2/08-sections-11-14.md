## 11 Decisions on spec TBDs

| Open question | Decision |
|---|---|
| Rule condition language | Structured JSON conditions, no expression strings, no eval (4.2). `in`/`notIn` take arrays; typed `gt`/`gte`/`lt`/`lte`; evaluated on canonicalised values; `$default` is the configured default, frozen before evaluation. |
| Values carry over on form and terminal toggle (FR-056) | Yes, both directions. The canonical draft is user values in one store; the terminal is a derived view; parse merges and never erases unpositioned fields; a "n fields not shown" indicator covers fields with no position (4.4, 6.7). |
| Two-digit year | Per field kind. `year` fields: two digits map to 2000 plus; anything other than two or four digits is rejected (4.3). `date` fields: default `inputFormats` (MMDDYYYY, MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD) take four-digit years only; a site-added two-digit format resolves by `FieldDef.century`, where `"past"` (DOB) picks the latest matching year not after today and the default is 2000 plus [open]. Stored ISO, terminal output MMDDYYYY, display MM-DD-YY (4.4). |
| Per-source timeout default (FR-044) | 10s, per source in config. The dispatcher owns the deadline; late settlements never change a write-once status; no retries (5.2). |
| Acknowledgment target (NFR-004) | Split. Server target: 200ms from request receipt to 202, covering the one step-3 transaction, reported in `Server-Timing` (5.2). End-to-end: the client reports ack receipt over the WebSocket; recorded as a metric, not an audit row, and reported per milestone with no pass/fail target in the prototype [open]. |
| Transaction volume target (NFR-002) | Single node is a hard limit. Stated ceiling: the dispatcher's global cap of 32 in-flight source calls, 4 per source, 30 submits per minute per user, one SQLite writer. The concurrency test (10) proves correctness at that ceiling, not throughput beyond it [open]. No Postgres move is claimed (14). |
| Retention of responses, including those deleted from view | Mechanism now, policy off. `SiteConfig.retention { payloadDays, valuesDays }` exists and is `null` (indefinite) in the prototype. Purge is crypto-shredding: delete the per-request DEK so `query_request.values` and `source_result.payload` become unreadable; the rows stay. `scripts/ops/purge.ts` writes `retentionPurged`. Hidden and visible responses follow the same rule. Schema in M2, shredding in M3 (5.5). |
| Session limits | Absolute 12h, idle 30 min, from `SiteConfig.auth.session`; the same limits apply to native bearer sessions (5.6). |
| Minimum touch target | 48x48 CSS px on mobile unit and mobile; on native, targets grow with OS font scaling up to 2x (6.3, 6.10). |
| FR-050 "addable to a user layout" | M1: terminal is a toggle inside the query panel. M2: `user_preference.layout.terminal` is `"toggle"` or `"pane"`; pane places the terminal beside results on the same draft store (6.2). FR-050 is partial until M2. |
| Scan auto-submit (FR-074) | Stays TBD, Phase 3. Default will be confirm first. |
| Background lookup launch (FR-071) | Stays TBD, Phase 3. Expo push notification action is the leading option. |
| Background notification content (FR-065) | Push payload carries only an opaque correlation ID and generic text; content is fetched through the authorized API after unlock. Background push is not built in the prototype (6.10). |
| B6 and B7 placement | B7 (property picklist) moves to M3 with Phase 2. B6 (add to supplemental) stays later: it needs the host embedding contract (`writeBackRequest`, 6.9) and a host-backed `EntityStore` (5.5), and neither has a real host to write to in the prototype. |
| Compliance posture (SEC-020) | No CJIS data exists in the prototype (1). The architecture targets the CJIS Security Policy control areas it touches: identification and authentication (5.6), access control (5.2 policy function), audit and accountability (4.7, 5.5), encryption at rest and in transit (5.5, 5.7, 5.9), and configuration management (9). Certification is out of scope; the adopting company certifies. |
| Compliance posture (SEC-021) | GDPR aimed at, not certified. Minimisation: audit `details` hold identifiers, metadata and `role:"type"` values only (4.7). Storage limitation: the retention mechanism above. Erasure: crypto-shred of query values and payloads. Audit rows are kept under the legal-obligation basis and are never shredded; users are disabled in one transaction and hard-deleted only by ops script after retention (5.6). |
| Compliance posture (SEC-022) | Whether the EU Cyber Resilience Act applies is the adopting company's determination. The prototype stays in its neighbourhood through existing practice: newest stable dependencies with no known advisories (9), licence allowlist (9), `docs/threat-model.md` and an independent human security review before handoff (14). |

## 12 Milestones and phases

A milestone is a release tag promoted through the promote workflow (8), not a merge. Every merge still deploys to the URL, so unfinished capabilities merge dark behind their `features` flag (4.1, 5.8: 404 and UI hidden), and sensitive features stay dark until their acceptance tests pass.

### 12.1 Tracks and ownership

| Track | Machine | Owns |
|---|---|---|
| A | Linux | `packages/api`, `deploy/`, `.github/`, `scripts/ops/`, `scripts/mock-data/`, `packages/config/mock/` |
| B | Windows | `apps/web`, `packages/web-ui`, `packages/tokens`, `packages/client`, Playwright, axe |
| Core | either | `packages/core`, `packages/config/sites/`, `packages/config/locales/` [open]. Small PRs from either track. |
| D | either, from M4 | `apps/mobile`, `packages/rn-ui`, Maestro flow |

Rules:

- Contract changes land first: a Core schema, OpenAPI route, WebSocket event or audit type merges in its own PR before any consumer, and both tracks rebase on it.
- Backend leads by half a milestone. Track A's work for phase Pn is on `main` (dark if needed) before Track B's consumer of it merges; B builds against the contracts frozen in P0 and the API already on `main`.
- A phase closes when its Gate cell holds on `main`. The next phase may start on a track whose inputs are met.
- Every phase that touches sensitive code (CLAUDE.md list) runs with an Opus critic, and every phase that builds UI does too.

### 12.2 M0 Skeleton and M1 Forms and terminal

| Phase | Track A (Linux) | Track B (Windows) | Core | Gate |
|---|---|---|---|---|
| P0 contracts | Workspace skeleton; CI skeleton | Tokens skeleton; web shell scaffold | Config schema v1; audit catalogue; WS event schemas; OpenAPI skeleton | Typecheck and CI green; contracts frozen |
| P1 foundation | Docker secrets; encrypted SQLite; Better Auth + session limits + limiter; `/meta`; `/health`; WS heartbeat; image smoke; tunnel; release promote | Login screen; three theme modes; Playwright + axe + CSP check in CI | Rules engine + conditions | M0 exit: login live; heartbeat socket alive 10 min through the tunnel |
| P2 engine | Config load + validate CLI; `GET config`; policy function; idempotency; `POST queries` step-3 transaction with pending rows + audit | Generic field renderer; rules-driven form; shortcut engine | Canonicalisation; tokenize / parser / formatter; planner | Form works against `GET config`; parser property tests green |
| P3 flow | Mock adapter + fixture generator; `event_log`; WS `sourceStatus`; dispatch deadlines | Terminal UI; toggle with user-value draft; announcements; submit against real API | | M1 exit: A1 to A5 green; keyboard-only Playwright; live smoke |

The P1 heartbeat socket ships with the 5.3 upgrade checks (Origin, session binding, bearer header only), because it is the first socket. The locales route (5.8) ships with `GET config` in P2 [open]. The `expo export` CI step runs from M0 against a placeholder `apps/mobile` shell (9) [open].

### 12.3 M2 Results and audit

| Phase | Track A (Linux) | Track B (Windows) | Core | Gate |
|---|---|---|---|---|
| P0 contracts | | | ResponseMapping element union; `assessResult` signature; `resultHidden` and `resync` events; details schemas for every query and auth audit type; OpenAPI for `GET queries`, admin audit and queries | Contracts frozen; OpenAPI diff reviewed |
| P1 feed | Replay by user seq with caps and `resync`; `GET queries` list and one, filtered by policy function and hidden rows; `Server-Timing`; ack-receipt metric | `packages/client` WS client with replay cursor and seq dedup; results list with per-source status; ack toast; correlation ID and ack time on each entry; announcer severity rules | Response mapper with precedence score and generic dump; `assessResult`; highlighter with `except` and Unicode boundaries | A6 green; socket-close-mid-dispatch replay test green |
| P2 audit | Auth audit events via Better Auth hooks; admin audit route with cursor paging, indexes, `auditViewed`, NDJSON export; `admin/queries` `includeHidden`; `scripts/ops/grant-role.ts`; retention and `request_key` schema; bearer REST + WS API tests | Summary/detail toggle; table elements (UX-016); severity badge with icon, text and colour on card, row and notification; admin audit viewer; terminal pane layout | `config:validate` resolves mapping paths against mock payloads | A7 to A9 green |
| P3 hardening | Security test matrix for M2 routes; backup restore test | Playwright STOLEN-in-detail-only test at 1024x768; type-while-result-arrives test; setOffline test | | M2 exit (12.7) |

### 12.4 M3 Workflow and compliance

| Phase | Track A (Linux) | Track B (Windows) | Core | Gate |
|---|---|---|---|---|
| P0 contracts | | | `SiteConfig.delegation` and `auth` blocks; credential and delegation audit types; `credentialsMissing` / `credentialsRejected` statuses; delegation WS events; OpenAPI for credentials, delegations, `results/hide` | Contracts frozen; `features` flags for credentials, delegation, hide off in deploy config |
| P1 credentials and MFA | Envelope credential store with AAD and `key_version`; canary check and lost-key runbook; `secure_delete` + checkpoint; `GET` list and per source; `PUT`/`DELETE` with step-up; `mock_credential_state`; TOTP + `mfaRequired`; user disable transaction | Credentials settings; credential status on cards with deep link and "retry this source"; TOTP enrolment; step-up prompt | | B4 green; raw-bytes credential scan and log-capture tests green |
| P2 multi-source, nested, hide | Nested parts with children cap and `skipped`; per-source and global caps; `results/hide` with `deletedFromView`; crypto-shred `scripts/ops/purge.ts` | Per-part, per-source status; nested grouping under one correlation ID; multi-select delete from view with confirm; property form | Nested `evaluateForm` on mapped values; type-field picklist filtering for B7 | B1, B2, B5, B7 green |
| P3 delegation | Request / approve with code and QR; rate-limited redemption; fresh auth or TOTP on approve; session binding and `sessionEnded` revoke; override rule; list, revoke, `me/delegated-queries`; audit filter actor or owner | Trainee request dialog with QR; officer approve screen; persistent trainee banner; delegation list and revoke | | M3 exit (12.7); flags on |

### 12.5 M4 Mobile and host integration

| Phase | Track A (Linux) | Track B (Windows) | Track D (mobile) | Core | Gate |
|---|---|---|---|---|---|
| P0 contracts | Bearer session cold-start check | | Expo shell on `packages/client`; `rn-ui` skeleton | postMessage v1 message schemas; `records` persona | `expo export` iOS and Android green; contracts frozen |
| P1 layouts and host | Better Auth Expo plugin with fallback; embedded-mode `IdentityService` (host JWT); `frame-ancestors` and CORS allowlists from deploy config | Mobile unit layout at 1024x768, 1366x768, 800x600; 7:1 day theme; orientation preference; 200% zoom and 320px reflow; iframe embed, postMessage v1 and host-simulator page | Login; query panel and condensed results on `rn-ui` | | C1 green on web; host-simulator Playwright test green |
| P2 native | Security tests for embedded identity | | Home-screen quick queries; OS autocomplete hints; font scaling to 2x; reduced motion; delete-from-view button; `announceForAccessibility`; Maestro flow | | C1 and C2 green on native |
| P3 exit | Backup restore test | Manual daylight check on the mobile unit theme | VoiceOver and TalkBack at largest text; Maestro results in `docs/releases/` | | M4 exit (12.7) |

Embedded mode (6.9) lands in M4 alongside `rn-ui`, the other host-embedding path [open].

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

## 13 Traceability

Draft. A later checker regenerates this table for all 87 IDs. Stories refer to Appendix A. Rows marked [check] need the checker's confirmation.

| ID | Sections | Story | Milestone | Note |
|---|---|---|---|---|
| BR-001 | 4.1, 5.8, 7 | | M1 | |
| BR-002 | 3, 6.1, 6.9 | | M4 | Standalone and embedded modes; `records` persona |
| BR-003 | 2 | | M0 | No new licensing; runs under the host licence |
| BR-004 | 2, 7, 12.7 | | every | `docs/releases/<tag>.md` |
| BR-005 | 2, 12.7 | | every | Docs refresh per exit |
| BR-006 | 2, 9 | | M0 | Licence allowlist in CI |
| BR-007 | 5.1, 7 | | M1 | OpenAPI and `docs/api.md` |
| FR-001 | 4.3, 6.2 | A3 | M1 | |
| FR-002 | 4.2, 4.3 | A2 | M1 | |
| FR-003 | 4.2, 4.3 | A2 | M1 | |
| FR-004 | 4.1, 4.3 | A1 | M1 | Defaults precedence |
| FR-005 | 4.3, 6.2 | A3 | M1 | |
| FR-006 | 6.4 | A1 | M1 | |
| FR-007 | 4.1, 6.2 | | M1 | Quick-access bar [check] |
| FR-008 | 4.1, 7 | | M1 | Custom fields; overlay example |
| FR-010 | 4.3 | A1 | M1 | |
| FR-011 | 4.3 | A2 | M1 | |
| FR-012 | 4.3, 4.6 | | M1 | `FormState.mode`; planner intersect [check] |
| FR-020 | 4.1, 4.4 | | M1 | Date syntax; NAM tests [check] |
| FR-030 | 4.1 | B7 | M3 | |
| FR-031 | 4.1 | B7 | M3 | `enabled` codes; overlay |
| FR-032 | 4.2, 4.3 | B7 | M3 | Type-fields model |
| FR-040 | 4.6, 5.2 | B1 | M3 | |
| FR-041 | 4.6, 6.2 | B1 | M3 | |
| FR-042 | 4.6, 5.2 | B2 | M3 | One nesting level |
| FR-043 | 5.2, 6.2 | B1 | M3 | Status per part per source |
| FR-044 | 5.2, 5.4, 11 | B1 | M3 | Deadline mechanism from M1 |
| FR-045 | 2 | | later | Non-goal |
| FR-050 | 4.4, 6.2, 11 | A4 | M2 | Partial until M2 pane |
| FR-051 | 4.1, 4.4 | A4 | M1 | Site-level delimiter |
| FR-052 | 4.1, 4.4 | A4 | M1 | Presets replace subtype |
| FR-053 | 4.4, 6.4 | A4 | M1 | |
| FR-054 | 4.4 | A4 | M1 | |
| FR-055 | 4.4 | A4 | M1 | |
| FR-056 | 4.4, 6.7, 11 | A5 | M1 | |
| FR-060 | 4.5 | A8 | M2 | |
| FR-061 | 5.5, 6.9, 11 | B6 | later | `EntityStore`; `writeBackRequest` |
| FR-062 | 5.1, 5.5 | B5 | M3 | |
| FR-063 | 5.5 | B5 | M3 | |
| FR-064 | 5.2, 6.2 | A6 | M2 | |
| FR-065 | 5.3, 6.6 | A6 | M2 | Foreground only |
| FR-065 | 6.10, 11 | C5 | later | Background push partial, deferred |
| FR-070 | 4.1, 6.10 | C2 | M4 | |
| FR-071 | 6.10, 11 | C5 | later | Launch mechanism TBD |
| FR-072 | 2 | C3 | later | Non-goal |
| FR-073 | 2 | C4 | later | Non-goal |
| FR-074 | 2, 11 | C3, C4 | later | Confirm first by default |
| FR-075 | 2 | C6 | later | Non-goal |
| UX-001 | 6.1, 6.2 | | M1, M4 | Dispatch M1; mobile unit and mobile M4 |
| UX-002 | 6.3, 11 | C2 | M4 | 48x48 CSS px |
| UX-003 | 6.10 | | M4 | OS autocomplete hints; no recent-values cache by design; partial |
| UX-004 | 4.3, 6.2 | A2 | M1 | |
| UX-010 | 4.5 | A7 | M2 | |
| UX-011 | 4.1, 4.5 | A7 | M2 | Severity styles and marker |
| UX-012 | 4.5, 6.1, 6.3 | C1 | M4 | |
| UX-013 | 6.3 | C1 | M4 | |
| UX-014 | 5.1, 6.3 | C1 | M4 | |
| UX-015 | 4.5, 6.2 | A8 | M2 | |
| UX-016 | 4.5 | | M2 | Table element [check] |
| SEC-001 | 5.7 | B3, B4 | M3 | |
| SEC-002 | 5.7 | B4 | M3 | |
| SEC-003 | 5.7 | B3 | M3 | Diverges from B3 wording: the officer approves on their own device and their stored credentials are used; no officer password or state credential is typed in the trainee's session |
| SEC-004 | 5.7 | | M3 | Delegation purposes |
| SEC-005 | 5.6 | | M3 | TOTP; `mfaRequired` |
| SEC-006 | 5.5, 5.7, 5.9, 8 | | M0, M3 | Whole-DB encryption M0; credential envelope M3 |
| SEC-007 | 5.4, 5.9 | | M0 | Prototype boundary; real adapters later [check] |
| SEC-010 | 4.7, 5.2 | A9 | M2 | |
| SEC-011 | 5.2, 5.7 | B3 | M3 | Owner per source result |
| SEC-012 | 5.2 | A9 | M2 | |
| SEC-013 | 4.7, 5.5 | B5 | M3 | |
| SEC-014 | 5.2, 5.3 | A6 | M2 | |
| SEC-020 | 11, 14 | | every | Targeted, not certified |
| SEC-021 | 5.5, 11, 14 | | M2, M3 | Retention schema M2; crypto-shred M3 |
| SEC-022 | 11 | | | Adopting company determines |
| SEC-023 | 11, 14 | | | Not triggered: no Shared Platform service is built; human security review before handoff [check] |
| SEC-024 | 1, 11 | | | Not triggered: no regulated data [check] |
| NFR-001 | 4.1, 5.8, 6.2 | | M1 | Ships `en` only |
| NFR-002 | 4.6, 5.2 | B1, B2 | M3 | Multi-source and nested |
| NFR-002 | 11, 14 | | | Volume: single-node prototype scale only |
| NFR-003 | 5.2, 5.3, 6.8 | | M1, M2 | Partial: no offline submit queue |
| NFR-004 | 5.2, 11 | A6 | M1, M2 | Server 200ms M1; end-to-end metric M2 |
| PLT-001 | 5.5, 6.9 | | M4 | `IdentityService`; Shared Platform deferred |
| PLT-002 | 5.5, 5.7 | | | Deferred |
| PLT-003 | 5.5 | B6 | later | `EntityStore` |
| PLT-004 | 5.1, 5.3, 5.5 | | M2 | REST and events; `EventBus`; Shared Platform deferred [check] |
| PLT-005 | 5.5 | | | `AuditService`; deferred |
| PLT-006 | 3, 6.1, 6.9 | | M4 | [check] |
| PLT-007 | 3, 6.9 | | M4 | Works through existing host integration by iframe [check] |
| PLT-008 | 3, 5.5 | | M0 | No legacy layer dependency |

## 14 Risks

- **Two UI codebases.** Web is Vite + React DOM and native is Expo, so layout and component work happens twice. Mitigation: `packages/core`, `packages/client` and `packages/tokens` are shared; native is built only at M4; `rn-ui` covers the mobile persona only.
- **Better Auth Expo plugin** is younger than its web path. Mitigation: native auth is exercised at M4; fallback to a plain bearer session triggers when the token is not restored after cold start.
- **WebSocket through Cloudflare Tunnel.** Mitigation: M0 exit requires the authenticated heartbeat socket alive 10 min through the tunnel.
- **Single node is a hard limit.** The replay cursor relies on one writer's commit order, and the dispatch queue and `EventBus` are in process, so a second replica or a Postgres move is a redesign, not a config change. The NFR-002 ceiling is stated in 11.
- **Home laptop uptime.** Compose `restart: unless-stopped` and Watchtower cover reboots; nightly encrypted off-box backups cover disk loss; there is no failover.
- **Correlated AI authorship and review.** The same model family writes and reviews credential, audit and dispatch code, so blind spots are shared. Mitigation: `docs/threat-model.md` kept current, and an independent human security review before handoff.
- **Bus factor.** One developer. Mitigation: runbooks in `scripts/ops/` (backup, restore, lost key, purge, grant role), specs and release notes in `docs/`.
- **Provenance.** Most code is agent-written. Mitigation: a provenance note in the README.
- **Compliance posture.** SEC-020 to SEC-022 are aimed at, not certified (11). A company adopting the code must run its own certification and the SEC-023 architecture review.
- **Accessibility verification is partly manual.** axe catches a subset; screen-reader and daylight passes depend on one person at each exit (12.7).
- **Config schema churn.** Sites break on schema changes. Mitigation: `configSchemaVersion` in `/meta`, `migrateConfig` and `config:migrate`, forward-tolerant parse, release notes from `config:validate --diff`.
- **Mock-shape drift.** Response mappings are tuned to mock payloads that real sources may not match. Mitigation: `config:validate` resolves mapping paths against mocks and warns; the generic dump fallback shows unmapped data; the fixture policy keeps shapes plausible.
- **Expo Go SDK lockstep.** Expo Go on a phone runs one SDK version. Mitigation: upgrade the Expo SDK and the phone's Expo Go together; Expo majors from Dependabot are reviewed, never auto-merged.

## Writer notes (remove at assembly)

(a) [open] tags:
- 11 two-digit year: default `century` for a site-added two-digit date format is 2000 plus.
- 11 NFR-004: end-to-end ack is measured and reported per milestone with no pass/fail target.
- 11 NFR-002: ceiling expressed as the existing caps (32 global, 4 per source, 30/min/user) plus one writer; no throughput number.
- 12.1: `packages/config/sites/` and `locales/` follow the Core rule (either track, contract-first).
- 12.2: locales route ships with `GET config` in M1 P2.
- 12.2: `expo export` CI step runs from M0 against a placeholder `apps/mobile` shell (x4 says from M0; section 3 says Expo is M4).
- 12.5: embedded mode (iframe, postMessage v1, host JWT, host-simulator) placed in M4; decisions give no milestone.

(b) Assumptions about other sections:
- 4.1 has a `features` block, `SiteConfig.retention`, `SiteConfig.auth.session`, `auth.mfaRequired`, `delegation`, `personas` incl. `records`, and `FieldDef.century`.
- 4.7 owns the audit catalogue incl. `retentionPurged`, `deletedFromView`, `auditViewed`.
- 5.1 route names: `/api/v1/meta`, `/api/v1/config`, `/api/v1/locales/:locale`, `/api/v1/results/hide`, `/api/v1/me/credentials`, `/api/v1/me/delegated-queries`, `/api/v1/admin/audit` (+ export), `/api/v1/admin/queries/:id?includeHidden=true`.
- 5.5 tables: `event_log`, `request_key`, `mock_credential_state`, `user_preference.layout.terminal`.
- 5.6 describes user disable and ops-script hard delete.
- 6.7 is State and data (draft store); 6.10 Native holds push rule, autocomplete hints, font scaling.
- 8 owns the promote workflow and `scripts/ops/smoke.sh`, `backup.sh`; 9 owns the licence check and `expo export`.
- 10 owns story tags, the security test list and the acceptance matrix; 12.7 references them.

(c) Decision lines not placed:
- None. c069 hash chain deferral is listed under 12.6 Later; its mechanism belongs to 5.5.
