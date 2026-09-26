# Writer notes collected at assembly

## 01-sections-1-3.md

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

## 02-sections-4.1-4.3.md

(a) [open] tags
- 4.1 `records` persona maps to the `dispatch` layout.
- 4.1 `charset: "printable"` definition (any Unicode except control and format characters); two-value enum chosen as simplest way to admit non-ASCII names.
- 4.1 `SeverityStyle.color` / `background` are token names resolved per theme mode rather than literal hex.
- 4.1 overlay depth one level (base may not `extends`).
- 4.1 / 4.3 validation rejects a rule reading a field whose `setDefault` appears later in `rules` (makes one pass equal to a fixed point).
- 4.1 `allowPlateOnly` requires a field keyed literally `plate` and at least one `plateOnly` source.
- 4.1 unconditionally required field exempt from the "needs a position" error when it has a preset or configured default.
- 4.1 a `global` shortcut binding collides with the same sequence in any context.
- 4.3 conditions read pre-pruning effective values; hidden values can still satisfy conditions.

(b) Assumptions about other sections
- 4.4: parser uses `terminal.delimiter`, `CommandDef.presets`, positions with `{ field, rest: true }`, `DateFormat` / `outputFormat`, and `FormState.hiddenWithValue` to raise `valueForHiddenField`; error keys under `validation.*` shared with terminal. Toggle tie-break between commands with equally specific presets left to 4.4.
- 4.5: owns path syntax, mapping score (+4 when, +2 sourceId, +1 persona), runtime tie-break, generic dump, `assessResult`, Unicode boundary matching for `except`.
- 4.6: consumes `FormState.mode`, `FormState.sources`, `QueryTypeSource.plateOnly`, `NestedQuery.when`; runs `evaluateForm` per nested part; children cap 4 validated here too. Per-request source cap (8) and global concurrency cap (32) assumed core/API constants, not config.
- 4.7: submitted audit details include every `role: "type"` field value and `configHash`.
- 5.2: submit body carries `mode` and `configHash`; server 400 on mode mismatch or unknown key; `Source.maxConcurrent` is the per-source cap (default 4).
- 5.4: mocks in `packages/config/mock/<siteId>.json`; adapter registry exposes a settings schema used to validate `Source.server`; `kind` checked at API startup.
- 5.5 / 6.2 / 6.5: `user_preference` holds locale and theme mode; tokens package exposes token names and contrast pair metadata for validation.
- 5.6 / 5.7: consume `auth.mfaRequired`, `auth.session`, `auth.hostRoleClaims`, `delegation.purposes`, `delegation.maxDurationMinutes`.
- 5.8: owns `configHash` computation (over resolved config), `migrateConfig`, feature-flag 404s; route name `GET /api/v1/config`.
- 6.4: owns action key catalogue and default map; binding syntax here (space-separated strokes of `KeyboardEvent.code` with modifiers).
- 7: `config:validate --resolved --diff` flags.

(c) Decision lines not placed
- c122 "Intl formatting" and per-user locale storage belong to 6.2 / 5.5; only `locales[]` and `site.defaultLocale` placed here.
- c103 per-keyword `style` from v1 dropped in favour of `keywordSeverityStyles`; per-keyword override not kept (not in the decision).
- x19 audible cue placed as `SeverityStyle.audibleCue`; the cue sound itself is 6.6.

## 03-sections-4.4-4.7.md

(a) [open] tags:
- 4.4 named tokens are not recognised after a rest position has been reached.
- 4.4 `duplicateField` when a field is set by position or preset and by a named token.
- 4.4 `formatCommand` emits booleans as `Y`/`N`.
- 4.4 validation rejects date outputFormat containing the delimiter, and decimal number positions when delimiter is `.`.
- 4.4 a code for a different query type switches the draft to that type's stored user values (per-type drafts in 6.7).
- 4.4 toggle tie among equally specific commands goes to config order.
- 4.5 equal-score mappings with different matching `when` go to config order.
- 4.5 empty table arrays are omitted with a diagnostic.
- 4.5 highlighter matches on NFC-normalised text.
- 4.6 plate-only narrowing applied to nested parts in plateOnly mode, empty intersection skips the part.
- 4.6 part ids: only alsoRun entries whose `when` holds become parts; skipped parts keep ids.
- 4.6 alsoRun cap of 4 is fixed, not configurable.
- 4.7 `minClientVersion` owned by API deployment config.
- 4.7 HTTP status for `stepUpRequired` and `mfaEnrollmentRequired` (403).
- 4.7 `adminViewed` also covers delegating-officer reads via `viewerBasis`.
- 4.7 `sessionRevoked` reason `expired` depends on whether expiry is detectable/audited.
- 4.7 one `delegationChanged` WS event for all delegation transitions.
- 4.7 WS close codes 4001 / 4003.

(b) Assumptions about other sections:
- 4.1: `siteConfig.terminal.delimiter`; `CommandDef.presets` and `{field, rest:true}` positions; `FieldDef.role: "type"`, `inputFormats`, `outputFormat`, `century` (`"2000"` default | `"past"`), a number-kind attribute named here as `integer`/`decimal` (exact property name owned by 4.1); `KeywordStyle.except`; `SiteConfig.keywordSeverityStyles`; `ResponseMapping.when`; `MappingElement.highlight`; `QueryType.sources[].plateOnly` and `.when`; `alsoRun[].when` and `fieldMap`.
- 4.3: `FormState.mode`, canonicalisation function (`canon`), constraint error keys (`field.required`, `notInPicklist`, `invalidDate`, `minLength`, `maxLength`, `pattern`) and that `evaluateForm` returns `ValidationError[]`.
- 5.1/5.3: routes `GET /api/v1/queries/:correlationId`, `GET /api/v1/delegations`; replay caps 24 h / 500 in 5.3; per-request (part, source) cap default 8 in 5.2.
- 5.5: audit envelope columns `id`, `type`, `at`, `correlation_id`, `part_id`, actor snapshot, `credential_user_id`, `identity_source`, host subject; `source_result.result_id`; `event_log.seq`. Actor snapshot required by c068 in `submitted` is satisfied by the envelope, not repeated in details.
- 6.2/6.7/6.8: "n fields not shown" indicator, placeholder cache entry, stale-after-2-missed-pongs, per-query-type draft storage.
- 11: two-digit year rule per field kind matches `century` here.

(c) Decision lines not placed or adjusted:
- c070 lists `delegationCreated`; Chunk 6 (c049/c050) replaces the flow with request/approve. Catalogue uses `delegationRequested` + `delegationApproved` instead of `delegationCreated`, keeps `delegationVerifyFailed` for wrong code / missing credentials / step-up failure (x3 requires wrong-code audit rows), and adds `delegationRequestExpired`.
- c062 "lockout audited": no dedicated type in c070; carried as `loginFailed` with `lockoutUntil`.
- c093 "reject date formats containing the delimiter" is from the review recommendation, not the decision line; implemented only for `outputFormat` and tagged [open].
- c099 badge rendering, c100 config:validate mock path resolution and c103 contrast check are stated here as contracts; their UI, CLI and test detail belong to 6.2, 7 and 10.
- c102 "unknown format = validation error" removes v1's format registry; section 7's extension-point list must drop "response formats".

## 04-sections-5.1-5.5.md

(a) [open] tags
- 5.1 `GET /api/v1/meta` public: client must check version before login; exposes only versions and config hash.
- 5.1 `GET /api/v1/locales/:locale` public: login screen needs strings before a session exists.
- 5.2 step 2: source cap 8 counted across all parts' dispatched (part, source) pairs, not per part.
- 5.2 step 4: `sourceDispatched` written in T1 (plan commit), not at the actual adapter call, to avoid an extra transaction per source.
- 5.2 step 6: if T2 fails the row stays `pending` until the next startup sweep marks it `interrupted`; no in-process retry.
- 5.2 access policy: officer reads audited as `adminViewed` with `details.basis: "delegator"`; the catalogue (c070) has no dedicated event. 4.7 writer may prefer a new type.
- 5.3: `event_log` pruning at startup and in `purge.ts`, 24 h matching the replay window.
- 5.4: fixture validator detects fields by leaf key name.
- 5.5: request DEK wrapped by an HKDF-derived key from `CREDENTIAL_KEY` rather than a third secret.
- 5.5: audit hash chain deferred (c069 open item).
- 5.5: NFR-002 ceiling "tens of concurrent users" is a sizing statement, not measured.

(b) Assumptions about other sections
- 4.7 exports Zod schemas for `sourceStatus`, `resultHidden`, `resync`, delegation events, and audit types incl. `sourceDispatched`, `partSkipped`, `interrupted`, `credentialsInvalidated`, `adminViewed`, `auditViewed`, `auditExported`, `retentionPurged`, `deletedFromView`.
- 4.6 `planRequest` returns parts with `partId`, `droppedSourceIds`, `skipped` + reason.
- 4.1: `Source.kind` required, `Source.server` server-only, `SiteConfig.retention`, `features`, `ClientSiteConfig`; FieldDef `role:"type"`.
- 5.6: cookie is `__Host-` prefixed; `user.role` and `user.disabled_at` columns; session service publishes `sessionEnded` on EventBus; login/delegation-code rate thresholds live there using `rate_limit`.
- 5.7: owns delegation flow, `Secret<T>`, decryption in dispatch module, `credential_delegation` column semantics (I defined columns; 5.7 writer should reconcile, esp. one row per source + `request_id`, `code_hash`, `revoke_reason` incl. `sessionEnded`).
- 5.8: `configHash`, `features` gating 404, locale bundle.
- 5.9: `X-Requested-With` guard and `Cache-Control: no-store`.
- 6.7 / 6.8: client dedup, placeholder cache entry, heartbeat stale detection, resync handling.
- 8: Docker secret files named `DB_KEY` and `CREDENTIAL_KEY`; mock files and adapters on volumes; `stop_grace_period` > max `timeoutMs` + 5 s drain bound.
- 9: CI migration guard for `audit_event`, trigger check in image boot smoke.

(c) Decision lines not placed
- c071 "client reports ack receipt over WS, metric not audit": placed, but metric storage is a log line only; no metrics table invented.
- c122 per-user locale: placed as `user_preference.locale`; theme mode column added for Chunk 8 user preference (mode picked in preferences).
- c063 disable-user transaction and c062 limiter thresholds: owned by 5.6; only tables referenced here.
- c110 embedded host JWT details: only `identity_source` / `host_subject` columns and `Principal` fields here; flow in 5.6 / 6.9.

## 05-sections-5.6-5.9.md

(a) [open] tags
- 5.6 Embedded session cookie `SameSite=None; Partitioned` because the iframe is third-party to the host.
- 5.6 Embedded sessions never outlive host JWT `exp`; host re-sends token to continue.
- 5.6 Redemption limiter threshold 5 failures / 15 min per officer (decision says "rate-limited per officer", no number).
- 5.6 Lockout audited as `loginFailed` details `lockoutStarted: true`; catalogue has no lockout event.
- 5.6 `mfaRequired` not evaluated in embedded mode; host owns MFA.
- 5.6 Embedded step-up = host token `iat` within 5 min (no local password exists).
- 5.6 User disable runs from `scripts/ops/disable-user.ts` (decision names the transaction, not the trigger).
- 5.7 Canary stored in a `key_canary` table.
- 5.7 Lost-key script also revokes active delegations, reason `keyLost`.
- 5.7 "Retry this source" = new submission, new correlation ID and Idempotency-Key.
- 5.7 Delegation stored as parent `credential_delegation` plus child `credential_delegation_source` carrying the partial unique index.
- 5.7 New pending request from same session cancels older pending one.
- 5.7 New approval revokes any overlapping active delegation whole, reason `superseded`.
- 5.8 Locales route public (sign-in screen needs strings).
- 5.8 Initial feature flag names.

(b) Assumptions about other sections
- 4.1: `SiteConfig.auth { session {absoluteMinutes, idleMinutes}, mfaRequired, embedded { roleClaims map } }`, `SiteConfig.delegation { maxDurationMinutes, purposes[] }`, `SiteConfig.features`, `SiteConfig.locales[]`, `Source.server`, `version` integer, `extends` + `$remove`.
- 4.7: AuditEventType catalogue should use Chunk 6 names `delegationRequested`, `delegationApproved`, `delegationRequestExpired` (c070's `delegationCreated` superseded by c049/c050); `credentialsInvalidated` reason values include `decryptFailed`, `keyLost`; `delegationRevoked` reasons `revoked`, `superseded`, `sessionEnded`, `userDisabled`, `keyLost`. A reference-only WS delegation event exists (called "a delegation event" here).
- 5.1 routes used: `/api/v1/auth/*` (Better Auth basePath), `POST /api/v1/auth/embedded`, `POST /api/v1/me/step-up`, `GET/PUT/DELETE /api/v1/me/credentials[/:sourceId]`, `POST /api/v1/delegations`, `POST /api/v1/delegations/redeem`, `POST /api/v1/delegations/:id/approve`, `GET /api/v1/delegations`, `DELETE /api/v1/delegations/:id`, `GET /api/v1/me/delegated-queries`, `GET /api/v1/config`, `GET /api/v1/meta`, `GET /api/v1/locales/:locale`; admin audit user filter = actor OR credential owner; per-user locale in preferences.
- 5.5 tables/columns: `rate_limit`, `state_credential` columns as listed, `credential_delegation` (+ child table), `key_canary`, `query_request.config_hash`, `source_result.credential_user_id/delegation_id`, statuses `credentialsMissing`/`credentialsRejected`, pragmas `secure_delete=ON`, audit actor snapshot + `identity_source` + host subject, no FK to user.
- 5.3: Origin check, socket bound to session and closed on logout/expiry/revocation.
- 5.4: `mock_credential_state`, `ADAPTER_DIR`, `ALLOW_MOCK_SOURCES`, mock file path relative to config volume.
- 8: Docker secrets for CREDENTIAL_KEY, DB key, Better Auth secret, SEED_PASSWORD_SECRET; `CORS_ORIGINS`, `FRAME_ANCESTORS`, JWT issuer/audience/JWKS in deploy config; app port unpublished; backup retention bound.
- 11: audit retention basis (legal obligation) and session-limit row. 13: B3 divergence note.

(c) Decision lines not placed
- c069 hash chain deferral, c075 audit pagination/export, c076 envelope DEK encryption: 5.5/5.1, not mine; referenced only.
- c081 per-user POST /api/queries 30/min limit uses the same `rate_limit` table but is specified in 5.2.

## 06-sections-6-7.md

(a) [open] tags

- 6.1: Mobile Field Reporting host selects an existing persona via host context; no dedicated persona shipped.
- 6.2: "Retry this source" from a nested part resubmits as a new primary query.
- 6.4: chord timeout 1000 ms.
- 6.4: delimiter collision check resolves key codes on a US layout.
- 6.5: `time` auto switches to night 19:00 to 07:00 local.
- 6.6: coalescing window 1500 ms.
- 6.8: pending entries polled over HTTP at the backoff interval while the socket is down.
- 6.9: `error` message type and its three keys (not in the decision's message list; needed for token expiry and version mismatch).
- 6.9: host simulator built from `apps/web`, served on a second origin in dev, CI and demo only.

(b) Assumptions about other sections

- 3 (01): `apps/web` includes the host simulator; it needs a separate origin to exercise `frame-ancestors` and CORS.
- 4.1 (02): `PersonaDef`, `ShortcutMap` stroke syntax, `ThemeConfig { defaultMode, auto, tokens }`, `SeverityStyle.audibleCue`, `terminal.delimiter`, `features`, `locales`, `$remove` inside keyed arrays as `{ code, "$remove": true }`, `highlight` flag, `Format` set. Action keys in the 6.4 table (`focusTerminal`, `toggleMode`, `quickType1..9`, `submit`, `selectPrev`, `selectNext`, `toggleDetail`, `deleteFromView`, `dismiss`, `shortcutSheet`, `goPanel`, `goResults`) are the catalogue 4.1 refers to. Role claims map: 02 names it `auth.hostRoleClaims`, 05 names it `auth.embedded`; 6.9 says only "claims map in `SiteConfig.auth`". Assembler should reconcile.
- 4.3 (02): FormState field props `labelKey`, `dataType`, options, `order`, `sectionLabelKey`, `isDefault`, `userValue`, `effectiveValue`; `missingRequired`, `invalid` with `{key, params}`.
- 4.4 (03): `tokenize` always returns values; round-trip property owned there.
- 4.7 (03): WS messages `hello`, `ping`/`pong`, `ackReceipt`, `sourceStatus`, `resultHidden`, `delegationChanged` (status incl. `active`, `requestExpired`), `resync`.
- 5.1/5.7 (04, 05): `POST /api/v1/delegations`, `/redeem`, `/:id/approve`, `GET /api/v1/delegations`, `DELETE /api/v1/delegations/:id`, `GET /api/v1/me/delegated-queries`, `POST /api/v1/auth/embedded`, `POST /api/v1/me/step-up`, `GET /api/v1/meta`, `GET /api/v1/locales/:locale`, `GET /api/v1/health`; QR URL `https://<origin>/delegate#code=<code>` from 5.7.
- 5.2 (04): POST body `{ queryType, values (user values), sourceIds, mode, configHash }`; server derives visible effective values.
- 5.5 (04): `user_preference.layout` JSON (orientation, terminal), `persona_override`, `theme_mode`, `locale`. `source_result` statuses incl. `interrupted`, `credentialsMissing`, `credentialsRejected`; part `skipped`.
- 5.8/5.9 (05): volume paths `sites/`, `locales/`, `mock/`; `/embed` gets the allowlist `frame-ancestors`, other routes `'none'`.
- 12 (08): embedded mode in M4.

(c) Decision lines not placed

- c106 section 11 interpretation and x18 WCAG target (section 2) belong to other writers; 6.2 cross-references 11.
- c001 BR-003, BR-005, BR-006 belong to sections 2 and 9; only BR-004 placed here.
- x4 bearer-auth API tests (REST and WS from M2) belong to section 10; Maestro and the Expo fallback trigger placed in 6.10.
- 5.6 (05) leaves the embedded session cookie `SameSite=None; Partitioned` open; 6.9 avoids naming the carrier.

## 07-sections-8-10.md

(a) [open] tags
- 8.2: offline escrow of `DB_KEY`, `CREDENTIAL_KEY` and the age private key, not stored with backups.
- 8.3: `stop_grace_period: 30s`, with the "raise it when `timeoutMs` > 20 s" rule documented but not enforced.
- 8.6: off-box target is one rclone remote (R2 for the demo).
- 8.7: `lost-key.ts` also deletes `request_key` rows and writes `retentionPurged` (reason `keyLost`), because 5.5 derives the DEK wrapping key from `CREDENTIAL_KEY`; 5.7's lost-key text does not mention this. Alignment is needed at assembly.
- 9.1: format of the `docs/reviews/pr-<n>.md` review artifact.
- 9.3 step 4: licence tool is `pnpm licenses list` plus a script, in place of the `license-checker` package the decision names (unmaintained); allowlist unchanged.
- 9.3 step 7: `api-breaking` label bypass for breaking OpenAPI diffs.

(b) Assumptions about other sections
- Secret file names `DB_KEY`, `CREDENTIAL_KEY`, `SEED_PASSWORD_SECRET` (5.5, 5.6, 5.9). `BETTER_AUTH_SECRET` and `TUNNEL_TOKEN` are named here.
- `GET /api/v1/health` returns 200 only after migrations, trigger check, canary and config pass (5.1 calls it liveness).
- SIGTERM drain bound = max `timeoutMs` + 5 s and 503 on submit (5.2).
- Feature names `credentials`, `delegation`, `resultHide`, `adminAudit`, `embedded` (5.8).
- `X-Requested-With` missing returns 403 (5.9).
- WS event JSON Schema exported from 4.7 Zod schemas to `packages/core/contracts/ws-events.schema.json`.
- `scripts/ops/grant-role.ts`, `purge.ts`, `lost-key.ts`, `disable-user.ts` from 5.5 to 5.7. Seed password = HMAC-SHA256(email) per 5.6.
- Persona, announcer and viewport subsection numbers 6.1, 6.3 and 6.6 per the numbering plan.
- Fixture examples `ZZ-0001` (STOLEN), `ABC123` (clean), `TIMEOUT` on one of two default sources (5.4).
- Section 14 carries the independence-of-review and Expo plugin fallback risks referenced from 9.1 and 10.7.

(c) Decision lines not placed
- c069 hash chain is deferred per the decision; not placed.
- Length exceeds 2.5x v1 because the required acceptance matrix and the security test list are new content.

## 08-sections-11-14.md

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

