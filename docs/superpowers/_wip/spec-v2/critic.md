# Critic: Query Module 2.0 design v2

Date: 09-25-26
Draft: `docs/superpowers/specs/2026-09-25-query-module-2-design-v2.md` (1848 lines; line numbers below refer to it)
Inputs: both checker reports, writer notes, decisions log, review report, v1, requirements doc.

Reviser order: apply the checker reports (except section E), then A, B, C, D, then F last.

## A. Combined-decision contradictions

### A.1 Conflicts between decisions

**A1. Session-bound delegation vs step-3 credential snapshot (5.2 step 3, 5.7 steps 7-8; c052, c054).**
A submit acknowledged under an active delegation can still sit in the dispatcher queue when the trainee session ends or the delegation is revoked, and the snapshot says it still dispatches on the officer's credentials. User disable and lost key delete the credential rows that snapshot points at.
Ruling: the snapshot fixes *whose* credential is used. It is not re-checked against revocation, because the deadline (`acknowledged_at + timeoutMs`) bounds the exposure. The credential *row* is read at dispatch, so a deleted row resolves as `credentialsMissing`. No job-cancel path is built.
Edit: 5.7 step 7, append: "A job already acknowledged keeps its snapshot until its deadline (`acknowledged_at + timeoutMs`). If the credential row was deleted before the job runs (user disable, lost key, owner delete), dispatch resolves `credentialsMissing`."

**A2. Expiry-driven revocation needs detection (5.6 session limits, 5.7 step 8, 4.7 `sessionRevoked` [open]; c052, c032).**
c052 requires that a session *expiring* auto-revokes its delegations, with an audit row, and closes the session's sockets. Better Auth expiry is lazy, and the draft's "a sweep marks rows" has no owner or period.
Ruling: one in-process sweeper runs every 60 s. It (a) marks pending delegation requests past their deadline `requestExpired`; (b) marks active delegations past `expires_at` `expired`; (c) deletes sessions past idle or absolute, writes `sessionRevoked { reason: "expired" }`, revokes bound delegations `sessionEnded` and publishes the internal session-ended signal, which closes the session's sockets with 4001; (d) prunes `event_log` older than 24 h once an hour. Step-3 resolution still checks `expires_at` and session liveness directly, so sweep lag never grants access.
Edit: add a "Sweeper" paragraph to 5.2 (next to "Startup sweep"), and point to it from 5.6, 5.7 step 8 and 5.3 pruning.

**A3. Idle timeout vs heartbeat and background polling (5.6 idle 30 min; 6.8 ping 20 s, pending refetch, health poll).**
If background traffic counts as activity, an open tab never goes idle and c032's idle limit is dead.
Ruling: only user-initiated requests refresh the idle clock. The client sends `X-Background: 1` on pending refetches, resync refetches and health polls, and those never refresh it. WebSocket pings never refresh it either.
Edit: 5.6 session limits paragraph and 6.8, one sentence each.

**A4. Embedded host JWT vs absolute and idle session limits (5.6 embedded paragraph, 6.9 identity bullet; c110, c032).**
If every token refresh mints a fresh module session, the 12 h absolute limit never fires in embedded mode.
Ruling: when a live module session presents a token for the same (`iss`, `sub`) to `POST /api/v1/auth/embedded`, the call extends that session's `hostTokenExp` and nothing else. The session ends at the earliest of host `exp`, absolute and idle. When it ends, the module asks the host for a token (A5) and a new session starts, with its own `loginSucceeded { method: "hostJwt" }`. Delegations bound to the old session end `sessionEnded`, as in standalone.
Edit: 5.6 embedded paragraph; 6.9 identity bullet.

**A5. Embedded step-up and refresh need a module-to-host request (5.6 step-up [open]; 6.9 protocol table).**
Embedded step-up needs a host token with `iat` no older than 5 min, but protocol v1 has no module-to-host message for asking for one.
Ruling: add module-to-host `identityRequest { reason: "refresh" | "stepUp" }`. The host answers with `identity`. Delete the `identityExpired` error key; `error` keeps `identityRejected` and `unsupportedVersion`.
Edit: 6.9 table; the 4.7 postMessage schema list; the 12.5 P0 Core cell.

**A6. Officer approval "on own device" vs embedded principals (5.7 steps 2-3, 6.2 delegation screens; c049, c110).**
The QR link opens `/delegate` in standalone mode, but an embedded officer has no standalone password.
Ruling: in embedded mode, the officer types the code into an "Approve delegation" screen inside their own host-embedded module session. QR codes are shown only in standalone mode. Step-up follows A5.
Edit: 5.7 step 2 (one clause); 6.2 officer-approval bullet.

**A7. Host-subject mapping vs local accounts, and the demo trust key (5.6, 6.9; c110).**
"Maps `sub` to a local principal" does not say how. Unqualified, a `sub` could collide with a standalone user. Separately, the host simulator signs tokens client-side, so anyone who can load it can mint any claim.
Ruling: embedded principals are separate `user` rows keyed (`iss`, `sub`), with `identity_source = host`, and are never linked to password accounts. Any deploy config that trusts the simulator's key has a `roleClaims` map that grants no `admin` and no `trainingOfficer`.
Edit: 5.6 embedded paragraph, two sentences; 6.9 host-simulator paragraph, one sentence.

**A8. Embedded mode in deploy config vs `features.embedded` in site config (3.1 "Mode is set per deployment in deploy config"; 5.8 and 9.2 flag list; c110, x6).**
The same thing is switched in two places, and the demo needs both modes at once for the portfolio simulator.
Ruling: remove `embedded` from `FEATURES`. Deploy config gets `IDENTITY_MODES` (`standalone`, `embedded`, or both; default `standalone`). `/embed` and `/api/v1/auth/embedded` return 404 unless `embedded` is listed and issuer, audience and JWKS URL are set. Better Auth password routes return 404 unless `standalone` is listed. This keeps embedded dark until M4, because no shipped deploy config lists it before then.
Edit: 3.1 first line; 5.8 feature names; 8.2 deploy-config list; 9.2 flag list.

**A9. Feature gating (and the env-gated dev route) vs the committed OpenAPI diff and the route matrix (5.1, 5.8, 9.3 step 7, 10.3; x6, x5, x3).**
If OpenAPI follows the flags, flipping a flag changes `openapi.json` and trips the contract diff. Also, test configs turn every flag on, so "disabled feature: 404" is never exercised.
Ruling: OpenAPI is generated from the route definitions, independent of flags and env. Flagged routes carry `x-feature: <key>`; the dev route carries `x-requires: ALLOW_MOCK_SOURCES`. The route matrix runs twice: against the all-on test config, and against `packages/config/test/flags-off.json`, asserting 404.
Edit: 5.1 intro, one sentence; 10.3 route-matrix bullet.

**A10. Flags in site config vs the demo's config volume (5.8, 8.1, 8.3 compose `./config:/config:ro`, 9.2 "turning one on is its own config PR").**
A config PR never reaches a volume sitting on the laptop, so dark-merge-then-enable does not work on the live URL.
Ruling: the demo deployment runs the bundled `packages/config`. Compose mounts no `/config` and leaves `SITE_CONFIG` unset. The `/config` volume is documented for other sites only.
Edit: 8.3 `app` volumes; 8.1 second paragraph (demo exception); 12.4 P0 gate "off in deploy config" becomes "off in shipped site config".

**A11. Reference-only events vs the connection indicator vs HTTP-gated submit (4.7, 6.8; c040, c083).**
The indicator follows the socket and submit follows HTTP, so the UI can say "connected" while submit is blocked.
Ruling: the indicator derives from both signals. `offline` means HTTP is gated (submit blocked). `reconnecting in n s` means HTTP is fine and the socket is down (results arrive by polling; submit allowed). `connected` means both are up.
Edit: 6.8 indicator bullet.

**A12. Crypto-shred with one DEK vs two retention clocks, and undefined reads after a shred (4.1 `retention { payloadDays, valuesDays }`, 5.5 `request_key` PK `correlation_id`, 4.7 `retentionPurged.scope`; c076, c048).**
One DEK wraps both values and payload, so they cannot be shredded at different ages. Nothing says what `GET` returns once a DEK is gone.
Ruling: `request_key` PK becomes (`correlation_id`, `scope`) with `scope` `values` | `payload`, giving two DEKs per request. `purge.ts` deletes by scope and ends with `wal_checkpoint(TRUNCATE)`. Reads of a shredded part or result return `purged: true` with no values or payload; the card shows "Purged under retention" and never calls `mapResponse`. Admin `includeHidden` reads behave the same way.
Edit: 5.5 `request_key` and Retention; 5.1 `GET /queries/:id` row; 6.2 results list, one sentence.

**A13. Erasure vs audit retention (5.6 "hard delete ... after the audit retention period (11)"; 11 SEC-021; c063, c002).**
Section 11 defines no audit retention period, so the hard-delete precondition cannot be evaluated.
Ruling: the prototype keeps audit rows indefinitely under the legal-obligation basis, and the adopting agency sets the period. A user row may be hard-deleted by ops script any time after disable, because audit carries the actor snapshot and has no foreign key. The SEC-021 row states that `clientIp` and `actor_email` in audit are personal data kept on the same basis.
Edit: 5.5 Retention last sentence; 5.6 User disable last sentence; 11 SEC-021 row.

**A14. Envelope-encryption timing vs the milestone plan (5.5 "schema lands in M2, shredding in M3"; 12.2 M1 P2 writes `query_request`; c076).**
M1 persists query values. Encrypting them later means rewriting plaintext rows, which expand-then-contract does not cover.
Ruling: read c076's "schema M2" as the `retention` config block. `request_key` and DEK encryption of values and payload ship with the first `query_request` in M1 P2. `purge.ts` ships in M3.
Edit: 5.5 Retention; 12.2 P2 Track A (add "per-request DEK"); 12.3 P2 (retention config only).

**A15. Audit schemas vs milestones (12.2 M0 P1 Better Auth plus limiter, 12.7 M0 "lockout audited", 12.2 M1 P2 "pending rows + audit" vs 12.3 M2 P0 "details schemas for every query and auth audit type" and M2 P2 "auth audit events via Better Auth hooks"; c070).**
`AuditService` validates every write, so M0 and M1 cannot write rows whose schemas land in M2.
Ruling: M0 P1 ships `loginSucceeded`, `loginFailed` and `logout` with Better Auth. M1 P0 freezes the query event schemas (`submitted`, `acknowledged`, `sourceDispatched`, `sourceResponded`, `interrupted`, `partSkipped`). M2 P0 adds admin and ops schemas. Credential and delegation schemas stay in M3 P0.
Edit: 12.2 P0 and P1 cells; 12.3 P0 and P2 cells.

**A16. "Backup restore tested at every milestone exit" vs no backup before M2 (12.7, 8.6, 12.3 P3; c028). Also, the M0 login screen needs the locales route, which is scheduled in M1 (5.8, 12.2).**
Ruling: `backup.sh` and `restore-test.sh` go into M0 P1 Track A. The locales route ships in M0 P1 with the login screen.
Edit: 12.2 P1 Track A; the sentence under the 12.2 table.

**A17. Idempotency-Key reuse vs repeat queries (6.7 "reused while the draft is unchanged"; c081).**
A dispatcher re-running the same plate an hour later would get the old 202 back.
Ruling: generate a key per submit attempt. Reuse it only to retry an attempt that got no response. Discard it once a 202 or an error settles.
Edit: 6.7 Submit, second sentence.

**A18. Idempotent replay vs `acknowledged_at` living only in the audit row (5.2 step 1; c068, c081).**
The original 202 body needs `acknowledgedAt`, `parts` and `droppedSourceIds`.
Ruling: rebuild the body from the `query_request` part rows, their `source_result` rows and the `acknowledged` audit row (found through the existing `correlation_id` index). No new column.
Edit: 5.2 step 1, one sentence.

**A19. Persona and form-factor timing (2 bullet 1 "dispatch, mobile unit, records from M1"; 12.5 P0 Core "`records` persona"; 12.5 P1 mobile-unit layout; c037).**
Ruling: the `records` persona is config plus the dispatch layout and ships in M1; delete it from 12.5 P0. From M1 the mobile-unit persona is reachable in the browser on the shared responsive layout; the Toughbook layout, the 7:1 theme and C1 land in M4.
Edit: 2 bullet 1; 12.5 P0 Core cell.

**A20. Pointer heuristic vs Toughbook hardware (6.1 step 3; x22 vs 2 "touch with gloves").**
Toughbooks usually report a trackpad as the primary pointer, so `(pointer: fine)` picks `dispatch`.
Ruling: web with `(any-pointer: coarse)` resolves to `mobileUnit`, otherwise `dispatch`. A touch-monitor dispatch desk uses the stored override.
Edit: 6.1 step 3.

**A21. Shared `packages/client` across Vite and Expo vs platform APIs in shared code (3 row, 6.7, 6.8 `navigator.onLine`, 10.5 client 85%; c113).**
Cookie vs bearer auth, SecureStore, `navigator.onLine` vs NetInfo and app visibility are all platform-specific.
Ruling: `packages/client` takes an injected `ClientPlatform` { auth transport (cookie | bearer), token store, online signal, visibility signal } and imports nothing from React Native or the DOM. Its tests run in the Vitest node environment with fakes; hooks are tested with `renderHook`.
Edit: 3 `packages/client` row; 6.7 first paragraph; 6.8 gating bullet ("platform online signal").

**A22. Shortcut collision rule (4.1 last collision bullet vs 6.4 "a binding in the focused context wins over a global").**
The two sections contradict each other.
Ruling: reject, per 4.1. Delete the 6.4 sentence.

**A23. Delegation request 5-minute expiry vs the officer adding missing credentials under step-up before approving (5.7 steps 1-5; c049, c051).**
Ruling: the 5 minutes bound redemption. Redemption sets `expires_at = redeemed_at + 5 min` for approval. Unapproved at that point means `requestExpired`.
Edit: 5.7 steps 3 and 8.

### A.2 Cross-section defects neither checker caught

1. **Error keys (4.3, 4.4, 4.6, 5.2).** 4.3 uses `validation.required`, `validation.tooShort`, `validation.tooLong` and `validation.patternMismatch`. 4.4 uses `field.required` and "`minLength`, `maxLength`, `pattern`". 4.4 and 5.2 each have their own `unknownField`. Ruling: field errors are `validation.*` as in 4.3; terminal grammar errors are `terminal.*`; planner errors are `plan.*`; an unknown posted key is `validation.unknownField`. Fix the 4.4 table.
2. **`ValidationError` shape (4.3 `FormState.errors { field, key, params }`, 4.7 `{ key, params? }`, 6.2 "`invalid`").** Ruling: `ValidationError = { key, params? }` with the field in `params.field`. `FormState.errors: ValidationError[]`. 6.2 reads `errors`.
3. **Config version (4.1 `schemaVersion: 2`, 4.7 `CONFIG_SCHEMA_VERSION = 1` "`SiteConfig.version`", 5.8 `SiteConfig.version`).** Ruling: the field is `schemaVersion` and the value is `1`, since nothing has shipped. 5.8: migrate each file of an `extends` chain before merging.
4. **`site` block (4.1 `{ id, labelKey, defaultLocale }` vs 7 example `{ id, name, locale }` vs 5.8 "first of `locales` is the default").** Ruling: `site { id, labelKey }`; `locales[0]` is the default; cut `defaultLocale`. Fix the 7 example.
5. **`Principal` (5.5 `role`, 5.6 `roles: Role[]`).** Ruling: a single `role`, matching the actor snapshot (c068). One definition in 5.5 that includes `authenticatedAt`, `stepUpAt?` and `hostTokenExp?`; 5.6 points to it.
6. **Error bodies (5.6 `{ key: "auth.mfaEnrollmentRequired" }`, 5.7 `{ key: "delegation.codeInvalid" }` and 409 `{ key, params: { sourceIds } }`, 5.8 409 `{ key: "config.changed" }`).** Ruling: every error uses the 4.7 `ApiError`. A wrong code is `notFound`. Add these codes: `delegationCredentialsMissing` (409, `errors[]` one per source `{ key: "delegation.credentialsMissing", params: { field: sourceId } }`), `payloadTooLarge` (413), `unavailable` (503, drain), `internal` (500, audit fail-closed). A missing `X-Requested-With` is `forbidden`.
7. **System actor.** The startup sweep, the sweeper, `configLoaded`, `purge.ts`, `lost-key.ts` and `delegationExpired` write audit rows with no user. Ruling: actor snapshot `{ id: "system", email: null, role: "system" }`; `identity_source` gains `system`.
8. **Audit envelope (5.5 adds `source_id` and `delegation_id` columns; 4.7 says the envelope is the listed set and details repeat none of it).** Ruling: drop both columns from 5.5 `audit_event`; they stay in details. No filter needs them.
9. **Plan mode (4.6 `"full"` vs 4.3 `"normal"`).** Ruling: `"normal"`.
10. **3.2 vs 5.2.** 3.2 step 4 says "insert `query_request` once", but it is one row per part, insert-only. The 202 body includes `parts[]`. 3.2 step 5 says the dispatcher audits `sourceDispatched`, but it is written in T1 (D36). Fix by compressing 3.2 (F1).
11. **5.1 route table** lacks `POST /api/v1/me/step-up`, `POST /api/v1/delegations/redeem` and `POST /api/v1/auth/embedded`. The last one is not a Better Auth handler, so it needs `X-Requested-With`. Add a web-routes line: `/`, `/embed`, `/delegate` (standalone only), `/settings/credentials/:sourceId`.
12. **CSP `frame-ancestors` (5.9 applies the allowlist to every HTML response; 6.9 applies it to `/embed` only).** Ruling: the allowlist applies to `/embed`, and `'none'` applies everywhere else. Fix 5.9.
13. **5.3 "server terminates a socket after 2 missed pongs".** The server sends pongs, so it cannot miss them. Ruling: the server closes a socket that has sent no `ping` for 60 s.
14. **`EventBus` carries the internal session-ended signal (5.3), but `publish` takes a `WsEvent`.** Ruling: add `onSessionEnded(sessionId, handler)` to the `EventBus` interface in 5.5.
15. **`ClientSiteConfig.delegation.purposes` omits the per-purpose `maxDurationMinutes`,** which the 6.2 dialog caps against. Add it.
16. **`key_canary` is missing from the 5.5 table list.** Add it, with one row per key (D50).
17. **5.2 source cap: no error when it is exceeded.** See D35.
18. **5.6 `lockoutStarted` vs 4.7 `lockoutUntil`.** See D46.
19. **5.5 audit indexes.** Keep (`credential_user_id`, `at`). It is the only index serving the "actor OR owner" filter.

## B. Invented beyond the decisions

Kept as `[open]`-resolved glue (the simplest way to implement a named decision):

| § | Item | Ruling |
|---|---|---|
| 5.5, 5.9, 8.2, 8.7, 10.3 | `DATA_KEY`, a third secret wrapping request DEKs, plus the `lost-data-key.ts` runbook (c076 says only "wrapped by master") | Keep. It follows c047's "loss of one key never affects the other" and is already consistent across five sections. Add it to the canary (D50). |
| 5.7 | `key_canary` table | Keep (c058 canary). |
| 5.6, 5.1 | `POST /api/v1/me/step-up`, `POST /api/v1/auth/embedded`, `Principal.stepUpAt` | Keep (c059, c110). |
| 5.1, 5.4 | `PUT /api/v1/dev/mock-credential-state` | Keep (c060 "admin dev route"). |
| 5.7, 6.2 | `/delegate#code=` QR fragment | Keep. It keeps the code out of logs. Standalone only (A6). |
| 4.1 | `charset: "printable"` | Keep. It admits non-ASCII names; the ASCII default is unchanged. |
| 4.1 | `Source.maxConcurrent` | Keep (c080 "per source default 4"). |
| 4.7 | `welcome`, `resync.reason`, `ApiError.requestId`, `EMBED_PROTOCOL_VERSION`, `SOURCE_ADAPTER_API_VERSION` | Keep. Contract glue. |
| 6.9 | postMessage `identity`, `context`, `error`; context `unitId`, `recordId`; `resultSelected.severity` | Keep. All optional; `recordId` serves the `records` persona. |
| 5.9 | HSTS, `Permissions-Policy`, `Referrer-Policy`, `X-Requested-With: querymodule` | Keep. v1 already had "security headers". |
| 8.4 | `promote.yml` also pushes a git milestone tag | Keep (x6 "milestone = release tag"). |
| 8.5 | Non-admin `smoke` user | Keep. The smoke run needs a login. |
| 8.6 | `age` plus `rclone`, 30-day retention | Keep (c028 "encrypted off-box, retention stated"). |
| 9.1 | Ruleset also requires `ci`, linear history, no bypass | Keep. Cheap and consistent with c025. |
| 9.3 | Committed `ws-events.schema.json` | Keep. It makes WebSocket contract drift show up in diffs (x5). |
| 9.3 | `.github/licence-exceptions.json` | Keep (BR-006 needs an escape hatch). |
| 10.2 | `docs/testing/stories.json` | Keep (x1 gate input). |
| 10.4 | Concurrency test sizes (20 submits, 5 users) | Keep. |
| 12.1 | "Backend leads by half a milestone" | Keep. Compress (F). |
| 6.2 | "default" text tag on `isDefault` fields | Keep. It is the rendering of c107. |
| A2, A3, A8, A12, A21 | Sweeper, `X-Background`, `IDENTITY_MODES`, `request_key.scope`, `ClientPlatform` | New glue this critic introduces; each is the smallest fix for a combined conflict. |

Cut:

| § | Item | Ruling |
|---|---|---|
| 4.1 | `site.defaultLocale` | Cut. `locales[0]` is the default (A.2 item 4). |
| 4.5 | `KeywordStyle.style` per-keyword override and its contrast check | Cut (checker D001; c103 styles per severity). |
| 5.8, 9.2 | `features.embedded` | Cut. Replaced by `IDENTITY_MODES` (A8). |
| 5.5 | "sized for tens of concurrent users" | Cut. Unmeasured; 11 says no number. |
| 5.5 | `audit_event.source_id`, `audit_event.delegation_id` | Cut (A.2 item 8). |
| 9.1 | "The v1 'no rulesets' decision is withdrawn." | Cut. That is history, and it belongs in the decisions log. |

No new user-facing feature, route family or table was invented beyond the above. Scope creep is low; the size problem is repetition (F), not invention.

## C. Dropped from v1 without a decision

1. **Default-site content.** v1 traced FR-020 (person: Last, First, DOB, Sex, Race) and FR-030 (property: serial, type, description) to the shipped default site. v2 never names the shipped query types, so the FR-020 and FR-030 traces point at a generic model with no shipped instance. Restore: a short "Shipped default site" table in 7 listing query types `VEH` (plate, state, year, VIN, plateType, `allowPlateOnly`), `PER` (last, first, DOB with `century: "past"`, sex, race; `alsoRun` a wanted check), `PRO` (serial, `propertyType` type field, description; B7) and the wanted type, with their commands and the two default sources. Update the 13 rows for FR-020 and FR-030 to cite it.
2. **"Source selection stays in the panel UI in Phase 1; the command string does not name sources"** (v1 4.4). Restore it as one line in 4.4.
3. **"EAS builds only when Phase 3 needs camera, background execution and push"** (v1 6.7). Restore it as one line in 6.10.
4. **"Sensitive areas are implemented and reviewed on Opus seats"** (v1 5.7). v2 keeps the critic (12.1) and the review gate (9.1) but drops the implementation seat. Restore it in the 12.1 rules as "implemented on Opus per CLAUDE.md".
5. **Per-keyword `style`** (v1 4.1). Its removal is confirmed (B), but 4.1 must say "styling is per severity; there is no per-keyword override" so the drop is recorded.

Everything else from v1 is either carried forward or superseded by a named decision.

## D. Ruling on every [open] tag (79)

| # | Line | § | Open question | Ruling | Rationale |
|---|---|---|---|---|---|
| 1 | 52 | 3 | client API lib | `openapi-fetch` | typed, tiny, reads committed `openapi.json` |
| 2 | 57 | 3 | JWT/JWKS lib | `jose` | standard, dependency-free |
| 3 | 58 | 3 | web router | `react-router` | Expo keeps `expo-router`; no shared routing |
| 4 | 141 | 4.1 | `records` layout | `dispatch` | desk users; layouts are a fixed set |
| 5 | 188 | 4.1 | `printable` charset | any Unicode except `\p{Cc}` and `\p{Cf}` | admits names; ASCII stays default |
| 6 | 237 | 4.1 | severity colours | token names, resolved per mode | modes need per-mode values |
| 7 | 258 | 4.1 | overlay depth | one level; base may not `extends` | simplest merge and diff |
| 8 | 288 | 4.1 | rule reads a field set by a later `setDefault` | validation error | one pass equals a fixed point |
| 9 | 290 | 4.1 | `allowPlateOnly` preconditions | field keyed `plate` and at least one `plateOnly` source | 4.3 keys on `plate` |
| 10 | 292 | 4.1 | required field with no position | exempt when preset or configured default exists | effective value never null |
| 11 | 294 | 4.1 | `global` collisions | `global` collides with every context; delete 6.4 override sentence | one meaning per key (A22) |
| 12 | 386 | 4.3 | hidden values satisfy conditions | yes, pre-prune effective values | order-independent; sites add visibility clause |
| 13 | 388 | 4.3 | later-`setDefault` read | same as #8; state once in 4.1 | duplicate |
| 14 | 425 | 4.4 | named tokens after `rest` | not recognised; remainder verbatim | `rest` means remainder |
| 15 | 427 | 4.4 | position/preset plus named token | `terminal.duplicateField` | no silent precedence |
| 16 | 437 | 4.4 | boolean output | `Y`/`N` | shortest accepted token |
| 17 | 440 | 4.4 | delimiter in `outputFormat`; decimal with `.` | both validation errors; close tag | no alternative exists (checker D009) |
| 18 | 462 | 4.4 | code switches query type | per-type drafts in memory, cleared on logout | nothing lost; c115 no persistence |
| 19 | 464 | 4.4 | toggle tie | config order | deterministic |
| 20 | 487 | 4.5 | equal-score mappings | earlier in config order | deterministic |
| 21 | 498 | 4.5 | empty table | omit plus dev diagnostic | same as unresolved path |
| 22 | 525 | 4.5 | NFC | normalise payload text and keywords to NFC | cheap; avoids combining-mark misses |
| 23 | 555 | 4.6 | nested plate-only | narrowing applies; empty intersection skips the part with `plan.noPlateOnlySource` | child never fails parent (c042) |
| 24 | 558 | 4.6 | part ids | `partId = alsoRun index + 1`, stable, gaps allowed; false `when` = no part; skipped keep id; change "1..n" wording in 3.2/5.2 | stable and simplest |
| 25 | 560 | 4.6 | `alsoRun` cap | fixed constant 4 | no site needs the knob; c085 value |
| 26 | 581 | 4.7 | `minClientVersion` owner | deploy config `MIN_CLIENT_VERSION`, unset = none | only native lags; web ships in image |
| 27 | 603 | 4.7 | `stepUpRequired` status | 403 | 401 would reset client state (6.7) |
| 28 | 604 | 4.7 | `mfaEnrollmentRequired` status | 403 | same |
| 29 | 636 | 4.7 | officer reads | `adminViewed` with `viewerBasis: "admin" \| "credentialOwner"` | no new type; names the real basis (E3) |
| 30 | 647 | 4.7 | audit expiry | yes, `sessionRevoked { reason: "expired" }` from the sweeper | c052 needs expiry detected (A2) |
| 31 | 710 | 4.7 | one delegation event | `delegationChanged` only; fix 5.3 | one schema; client refetches |
| 32 | 711 | 4.7 | close codes | 4001 session ended, 4003 Origin rejected | private range, two cases |
| 33 | 722 | 5.1 | `/meta` public | yes | version check precedes login; no data |
| 34 | 724 | 5.1 | `/locales` public | yes, UI strings only | login screen needs strings |
| 35 | 755 | 5.2 | source cap scope | 8 across all parts; over cap = 400 `plan.tooManySources { max }`; `config:validate` warns when a type's worst case exceeds it | bounds fan-out per submit |
| 36 | 761 | 5.2 | `sourceDispatched` timing | T1; fix 3.2 step 5 | no extra transaction |
| 37 | 765 | 5.2 | T2 failure | log, exit non-zero; restart sweep marks `interrupted` | fail closed (c071); nothing lost (NFR-003) |
| 38 | 775 | 5.2 | officer read audit | as #29 | match 4.7 |
| 39 | 804 | 5.3 | `event_log` pruning | 24 h; startup, `purge.ts`, and hourly by the sweeper | a long-running process must also prune |
| 40 | 857 | 5.4 | fixture field detection | leaf key names, listed in `docs/site-config.md` | simplest |
| 41 | 879 | 5.5 | hash chain | deferred by c069; remove tag, keep in 12.6 | decided, not open |
| 42 | 910 | 5.5 | NFR-002 ceiling | caps only; cut "tens of users" | unmeasured |
| 43 | 920 | 5.6 | embedded session carrier | `__Host-` cookie, `SameSite=None; Secure; Partitioned`; 14 notes browser third-party-cookie risk | browsers cannot send an `Authorization` header on a WebSocket |
| 44 | 920 | 5.6 | embedded vs host `exp` | session ends at min(host `exp`, absolute, idle); refresh extends the same session | c032 holds (A4) |
| 45 | 935 | 5.6 | redemption limit | 5 failures per 15 min per officer; 15 min block | small code space |
| 46 | 937 | 5.6 | lockout audit | `loginFailed` with `lockoutUntil`; drop `lockoutStarted` | 4.7 name; no new type |
| 47 | 941 | 5.6 | MFA in embedded | not evaluated; host owns MFA | no local factor exists |
| 48 | 945 | 5.6 | embedded step-up | host token `iat` at most 5 min old, obtained by `identityRequest { reason: "stepUp" }` | parity with local rule (A5) |
| 49 | 947 | 5.6 | disable trigger | `scripts/ops/disable-user.ts` | no admin UI; like grant-role |
| 50 | 957 | 5.7 | canary storage | `key_canary`, one row per key (`credential`, `data`), in 5.5 | `DATA_KEY` also fails closed |
| 51 | 957 | 5.7 | lost key revokes delegations | yes, `keyLost` | a delegation without credentials is dead |
| 52 | 976 | 5.7 | retry | new submission, new correlation ID and key | status is write-once |
| 53 | 991 | 5.7 | delegation tables | parent `credential_delegation` plus child `credential_delegation_source`; 5.5 owns merged DDL (E1) | lifecycle in one row; index on child |
| 54 | 995 | 5.7 | older pending request | becomes `requestExpired` with `delegationRequestExpired` | no new status |
| 55 | 999 | 5.7 | overlap on approve | revoke overlapping active whole, `superseded` | c053 "new revokes old" |
| 56 | 1027 | 5.8 | `/locales` public | yes (as #34) | duplicate |
| 57 | 1029 | 5.8 | feature names | `credentials`, `delegation`, `resultHide`, `adminAudit` | embedded is a deployment property (A8) |
| 58 | 1079 | 6.1 | Mobile Field Reporting | picks an existing persona via host context; none shipped | PLT-006 met |
| 59 | 1126 | 6.2 | retry from nested part | new primary query of that part's type, values, one source | no partial-plan resubmit |
| 60 | 1165 | 6.4 | chord timeout | 1000 ms | common default |
| 61 | 1167 | 6.4 | delimiter vs key layout | US layout | `KeyboardEvent.code` is US-positional |
| 62 | 1202 | 6.5 | `time` auto | night 19:00 to 07:00 local | fixed; `os` covers the rest |
| 63 | 1216 | 6.6 | coalesce window | 1500 ms; a `critical` message is never delayed by it | the alert path must be immediate |
| 64 | 1250 | 6.8 | poll while socket down | yes, pending entries at the backoff interval with `X-Background: 1` | events are references anyway (A3) |
| 65 | 1276 | 6.9 | `error` message | keep, with `identityRejected` and `unsupportedVersion`; replace `identityExpired` with `identityRequest` | A5 |
| 66 | 1280 | 6.9 | host simulator on the live demo | **RULING: ESCALATE.** Choice: (a) dev and CI only (lead fix #4 as written), or (b) also a static page on a second demo origin (c110 says "Playwright + demo"). Recommend (b) with the A7 guard (demo `roleClaims` never grants `admin` or `trainingOfficer`); never in the app image either way | portfolio value vs a publicly mintable demo key |
| 67 | 1371 | 8.2 | key escrow | offline copies off the laptop, never with backups | the only recovery path |
| 68 | 1381 | 8.3 | grace period | 30 s; rule documented, not enforced | c072 asks only for > bound |
| 69 | 1407 | 8.6 | off-box target | one `rclone` remote, R2 | already on Cloudflare |
| 70 | 1452 | 9.1 | review artifact format | front matter as written plus a findings body | CI-checkable |
| 71 | 1475 | 9.3 | licence tool | `pnpm licenses list --prod --json` plus script | `license-checker` unmaintained |
| 72 | 1478 | 9.3 | breaking OpenAPI | `api-breaking` label; listed in release notes | x5 "unreviewed" |
| 73 | 1645 | 11 | two-digit default | 2000 plus | matches year fields |
| 74 | 1647 | 11 | NFR-004 e2e | measured per milestone, no pass/fail | requirement's own target is TBD |
| 75 | 1648 | 11 | NFR-002 | the caps are the ceiling | c116 |
| 76 | 1671 | 12.1 | config sites and locales owner | Core track | contract-first |
| 77 | 1690 | 12.2 | locales route timing | M0 P1 with the login screen | login needs strings (A16) |
| 78 | 1690 | 12.2 | `expo export` from M0 | yes, placeholder shell | x4 |
| 79 | 1719 | 12.5 | embedded milestone | M4 | shares host-embedding work with `rn-ui` |

Escalations: 1 (#66). Every other tag closes with the ruling above; the reviser deletes the `[open]` marker.

## E. Checker items overruled

- **E1. check-decisions D007 (single `credential_delegation` table): overruled.** Use parent plus child, as check-xref D001 prefers and writer notes 05 intended. Merged DDL for 5.5:
  - Parent `credential_delegation`: `id`, `purpose`, `trainee_user_id`, `session_id`, `officer_user_id` (nullable until redeemed), `code_hash`, `status` (`pending`|`active`|`revoked`|`expired`|`requestExpired`), `requested_source_ids` JSON, `requested_minutes`, `approved_minutes` (nullable), `created_at`, `redeemed_at`, `approved_at`, `expires_at`, `ended_at`, `ended_by` (nullable), `end_reason` (nullable, same enum as `delegationRevoked.reason`).
  - Child `credential_delegation_source`: (`delegation_id`, `source_id`) PK, `session_id`, `active` INTEGER.
  - Partial unique index on the child: (`session_id`, `source_id`) WHERE `active = 1`.
  - Delete the 5.7 DDL prose and point to 5.5.
- **E2. check-decisions D005 (cite 6.7 for FR-071 and FR-065): overruled.** The decisions log cites v1 numbering, and v1 6.7 was "Native specifics", which is v2 6.10. The v2 citations are already correct; add no note.
- **E3. check-xref D006: partly overruled.** Keep the field name `viewerBasis`. The value is `credentialOwner`, not `delegationOwner`, because the trainee is arguably the owner of the delegation while the officer is the owner of the credential.
- **E4. check-xref D010 (one row per ID): partly overruled.** Use the regenerated table, but split FR-065 (foreground M2 / background later) and NFR-002 (multi-source and nested M3 / volume ceiling) into two rows each, labelled, as c006+c015 and c011 require. Also apply C1 to the FR-020 and FR-030 rows.

Every other checker item stands.

## F. Tighten list

Target: about 1850 lines down to about 1250. Keep all schemas, catalogues, the acceptance matrix, phase grids and the security test list. Each cut below either points to its home section or merges repeated text into it.

| # | § | Cut or compress | Est. lines |
|---|---|---|---|
| F1 | 3.2 | Compress steps 1-7 to a 6-line summary pointing to 4.3, 4.6, 5.2, 5.3 and 6.7. It currently duplicates 5.2 and carries two errors (A.2 item 10). | -12 |
| F2 | 3.1 | Embedded bullet to 2 sentences pointing to 5.6 and 6.9; standalone bullet to 1. | -5 |
| F3 | 4.1 | "Features" paragraph becomes a pointer to 5.8. Retention sentence becomes a pointer to 5.5. | -3 |
| F4 | 4.4 | Delete the restated `CommandDef` block (defined in 4.1). Keep the Toggle paragraph; 6.7's copy goes (F13). Drop the `century: "past"` sentence (4.3 owns it). | -8 |
| F5 | 4.5 | Delete the restated `ResponseMapping`/`MappingElement`, `KeywordStyle` and `SeverityStyle` blocks and the Formats paragraph (4.1 owns them). Keep `mapResponse`, score, path language, `RenderElement`, dump, `assessResult`, highlighter rules. Drop the Playwright sentence (10.2 A7 owns it). | -20 |
| F6 | 4.6 | "Limits" paragraph: keep one line ("limits validated in 4.1; caps in 5.2"). | -4 |
| F7 | 5.2 | Step 2 to "run `evaluateForm` and `planRequest` server-side (4.3, 4.6); reject per 4.7". Step 4 audit bullet to "audit rows per 4.7 in this order". Keep T1/T2 mechanics, sweep, drain, policy, hide. | -10 |
| F8 | 5.3 | Replace the event block and the client-to-server sentence with "Messages: 4.7". Keep upgrade, replay mechanics and pruning. Drop "Client rules" (6.7 owns them). This also removes checker xref D004 and D005 at the source. | -12 |
| F9 | 5.5 | Scale-limit paragraph to one line pointing to 11 and 14. Retention paragraph keeps the mechanism; policy and GDPR move to 11. | -4 |
| F10 | 5.6 | Delete the `Principal` block (5.5 owns it) and the demo-users paragraph (8.5 owns it). | -8 |
| F11 | 5.7 | Delete the `SiteConfig.delegation` block (4.1 owns it); keep one sentence on the effective cap. Routes block becomes `CredentialStatus` only. Step 7 becomes a pointer to 5.2 step 3 plus the A1 sentence. Drop the B3-divergence paragraph (13 owns it). Key-custody runbook detail moves to 8.7. | -25 |
| F12 | 5.8 | Client-view paragraph to a pointer to 4.1 plus the 409 behaviour. The feature-flags paragraph is the single home: 4.1, 9.2 and the 12 intro point here. | -6 |
| F13 | 6.7 | Draft bullets become a pointer to 4.4. Submit paragraph keeps only client behaviour (key per attempt, `aria-disabled`, 409 refetch). Events paragraph becomes "per 4.7 client rules" plus the placeholder. | -10 |
| F14 | 6.2 | Results-list narrative about `assessResult` shortens to "badge from `assessResult` (4.5)". Credential-status paragraph to 2 lines pointing to 5.7. Delegation screens keep UI only; drop flow restatement. | -10 |
| F15 | 6.3, 6.6 | Drop the Playwright sentences; 10.6 owns them. | -3 |
| F16 | 7 | Release-notes paragraph becomes a pointer to 9.5; tooling list stays. | -4 |
| F17 | 2 | BR-004 row becomes a pointer to 9.5. | -1 |
| F18 | 8.3, 8.5 | SIGTERM paragraph to one line pointing to 5.2. Seed paragraph keeps the command and the `smoke` user; password derivation stays here and 5.6 points to it. | -5 |
| F19 | 9.2, 12 intro | Dark-merge text lives only in 5.8; each place gets one line. | -6 |
| F20 | 10.1 | Test-data paragraph becomes a pointer to 5.4. | -2 |
| F21 | 11 | Rows that restate a section (condition language, carry-over, two-digit year, retention, FR-050, session limits, touch target) become decision plus pointer, one line each. Keep the SEC-020/021/022 rows in full. | -10 |
| F22 | 13 | Replaced by the regenerated table (E4); drop the "Draft ... [check]" preamble. | -2 |
| F23 | 14 | "Single node" risk to 2 lines. Rationale narration ("so a second replica ... is a redesign") stays in the review report. | -2 |
| F24 | global | Drop inline decision IDs in prose (`(c048, 5.5)`, `(x6)`, `(x11)`), which belong to the decisions log, and "This closes the spec's first open question" style narration. Keep FR/UX/SEC/NFR IDs and "Covers" lines. | -5 |

Adding A1-A23, C1-C5 and the E1 DDL puts back about 60 lines. With F24 counted as sentence-level trimming, the net is about 1650 lines. To reach about 1250, the reviser must also hold every paragraph in 5.x and 6.x to one statement of each fact. The largest remaining repetition is between 4.7, 5.2, 5.7 and 10.3 on delegation and audit, so after these cuts a second pass should delete any sentence that restates a 4.7 table row.

## G. Verdict

v2 covers every decision and has no material scope creep. What stands between it and implementation planning is roughly thirty mechanical contradictions (the checkers' items plus A and A.2), each with a concrete edit above, plus one escalation (#66) that affects only M4. Once the reviser applies E, A, B, C and D and the section F tightening, v2 is ready for implementation planning of M0 and M1. M3 delegation and M4 embedded planning should wait for a re-read of 5.6, 5.7 and 6.9 as rewritten under A1-A8, because that is where most of the combined-decision risk sits.
