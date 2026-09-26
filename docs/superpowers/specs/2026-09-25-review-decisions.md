# Review triage decisions (09-25-26)

Status: accepted = user accepted proposed decision as written.

## Chunk 1: storage, durability, release (all accepted)

- c072: `pending` source_result per planned source in step-3 txn; startup sweep -> `interrupted` + audit + push; no auto re-dispatch; SIGTERM drain; compose stop_grace_period > max timeoutMs; kill-during-dispatch test.
- c047: whole-DB encryption via libSQL encryptionKey; DB key separate from CREDENTIAL_KEY; both Docker secret files, never on /data; keep column AES-GCM on credentials; test open-without-key fails.
- c068: Zod schema per audit event type for details. submitted = query type, subtype, selected + dispatched sources, plateOnly flag, actor snapshot (id,email,role), config hash. sourceResponded = source, status, latency, credential owner. query_request insert-once; acknowledged_at lives in audit row.
- c069: audit_event additive-only; CI check on migrations touching it (only CREATE / nullable ADD COLUMN / CREATE INDEX); startup verifies triggers exist else refuse to serve; hash chain deferred (open item).
- c028: WAL + synchronous=FULL; scripts/ops/backup.sh nightly off-box encrypted, retention stated, restore tested per milestone.
- c048: secure_delete=ON; wal_checkpoint(TRUNCATE) after credential change/delete; key_version column; backups documented as holding superseded ciphertext, bounded retention; raw-bytes scan test.
- c058: CREDENTIAL_KEY from Docker secret file; startup canary-row validation, fail closed; scripts/ops/lost-key runbook (wipe credentials, audit invalidation, force re-entry).
- c116: drop "cheap Postgres move"; single-node hard limit; NFR-002 ceiling stated; risk in §14.
- c025: GitHub ruleset on main: PR required + required status check `sensitive-review` (passes if no sensitive path touched, else requires Opus review artifact). Drop "no rulesets".
- c026: Watchtower tracks `release` tag; CI pushes sha + latest; manual promote workflow retags sha -> release; rollback = promote older sha.
- x6: `features` block in site config gates unfinished capabilities (404 + UI hidden); sensitive features merge dark until acceptance tests pass; expand-then-contract migrations; never remove/rename audit_event columns; milestone = release tag.
- x7: CI runs built image (temp volume, /api/health, triggers exist, Playwright smoke login/plate/ack) before GHCR push; scripts/ops/smoke.sh post-deploy.
- x11: M0 adds authenticated /api/ws heartbeat + health page exercising it through tunnel; exit check socket alive 10 min.

## Chunk 2: dispatch pipeline and result feed (all accepted)

- c036 + c078: one correlation ID per submit; part_id per plan part (0 primary, 1..n nested); source_result / result_visibility / event_log keyed (correlation_id, part_id, source_id); submitted audit row per part with origin "alsoRun", parent part, fieldMap applied; list response nests parts; FR-043 status per part per source.
- c061: WS upgrade rejects Origin != deployed origin (dev origins only in dev); missing Origin only with bearer in Authorization header, never query string; __Host- cookie; state-changing routes require X-Requested-With header (CSRF); socket bound to session id, closed on logout/expiry/revocation; tests for foreign Origin, missing Origin + cookie, push after logout.
- c040 + c079: event_log (user_id, seq, correlation_id, part_id, source_id, type, created_at); events reference-only, client fetches payload via authorized GET (filters hidden); replay cap 24h or 500 events else `resync`; TanStack cache never persisted.
- c074: one policy fn for all query routes + WS: owner allowed; admin allowed + audited (adminViewed); delegating officer read-only on requests under their creds, audited; non-owner 404; hide owner-only; correlation ID is identifier not capability; negative tests.
- c080: dispatcher owns deadline (Promise.race then abort); late settlements logged, never change status; status write-once from pending; sources in a part parallel; clock from acknowledged_at; caps per source (default 4) and global (default 32); no retries.
- c081: Idempotency-Key header; unique (user_id, key) returns original 202; submit disabled until 202 settles; retry reuses key; per-user rate limit POST /api/queries 30/min default; source cap per request default 8.
- c082: single sourceStatus event, forward-only; dedup by seq high-water mark; event before POST resolves creates placeholder cache entry; ack toast from 202 alone; drop WS `ack` event.
- c083: app ping/pong 20s, stale after 2 missed; reconnect backoff 1s..30s with jitter; refetch pending via HTTP on reconnect; submit gated on HTTP reachability.
- c084 + c105: persisted/dispatched values only from visible effectiveValues; unknown keys 400; raw body never persisted; FieldDef gains maxLength, pattern, default charset printable ASCII, enforced in core.
- c085: exactly one nesting level; config validation rejects nested alsoRun; fieldMap refs validated both ways; children cap default 4.
- c041: plate-only in 4.6 planner; intersect selected with plateOnly sources; non-empty narrows (response names dropped sources); empty rejects 400.
- c042: evaluateForm per nested part on mapped values; nested sources = type's selectedByDefault; nested validation failure -> part `skipped` with reason, audited, parent proceeds.
- c071: step 3 one txn, 202 after commit; each outcome source_result + audit in one txn, push after commit; audit write failure fails closed; WAL + busy_timeout=5000; Server-Timing; NFR-004 = server 200ms + measured e2e (client reports ack receipt over WS, metric not audit).
- c077: all timestamps epoch ms UTC ints; durations from monotonic clock in details; audit ordered by integer id; timed_out_at column; client ack-receipt per c071.

## Chunk 3: core semantics (all accepted; 3.7/3.17 replaced by type-fields model)

- c038: `$default` = configured default (FieldDef.defaultValue ?? defaults[key]), frozen before evaluation, untouched by setDefault. Vocabulary: configured default / user value / effective value.
- c086: FormState has userValue + effectiveValue per field. mode `plateOnly` when allowPlateOnly AND plate userValue non-empty AND all other userValues empty (defaults ignored). Defaulted State still sent. FormState.mode exposed. FR-010 form shows Plate/State/Year/VIN; FR-012 "without displaying other fields" = no expanded fields. Server recomputes mode, mismatch 400. Table tests A1, State changed, Year typed.
- c087: setDefault fills only empty userValue; never writes draft; one pass config order; formatCommand serializes user values only; validation rejects cyclic setDefault; typed-value-survives test.
- c088: QueryType.sections [{key,labelKey,when?}]; FieldDef.section refs key; last-match-wins per effect, show/hide independent of require; validation rejects require/setDefault on unreachable fields.
- c089: FieldDef minLength, maxLength (default 64), anchored pattern, transform (upper|none); API cap 4KB/value 32KB body; message-keyed violations; conditional constraints deferred.
- c016: no escape syntax; last position may be {field, rest:true} consuming remainder (free-text fields only); delimiter elsewhere = delimiterInValue error; formatCommand flags same.
- c091: validation error if unconditionally required field lacks position, warning if conditionally required; parser returns valueForHiddenField not silent drop; trailing named tokens key=value allowed (VEH.ABC123.OK.plateType=PC).
- c092: per-dataType canonicalisation in core before rules, both paths; picklist codes case-insensitive vs enabled codes else notInPicklist; strings transform + collapse whitespace; idempotency property test.
- c093: date FieldDef inputFormats (default MMDDYYYY, MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD), terminal outputFormat default MMDDYYYY; stored ISO; century:"past" for DOB; boolean tokens Y|N|1|0|true|false; number integer|decimal; NAM table tests; display MM-DD-YY.
- c094: drop per-command delimiter; site-level terminal.delimiter; duplicate codes rejected case-folded; trailing empties ignored.
- c095: tokenize (always returns values) separate from evaluateForm validation; all errors returned as {key, params}; toggle uses tokenize; add emptyInput, missingDelimiter, valueForHiddenField.
- c096: canonical draft = user values in Zustand; terminal derived view; parse merges, never erases unpositioned fields; "n fields not shown" indicator; property: format then parse preserves positioned user values.
- c097: validateSiteConfig(config, locales) referential pass with JSON paths; runs at startup, config:validate, per shipped site; JSON Schema documented shape-only.
- c098: Picklist {id, values:{code,labelKey,enabled,parent?}[]}; `extends` overlay keyed deep-merge + $remove; example-ok.json overlay; config:validate --resolved prints merged + diff.
- c104: ClientSiteConfig allowlist schema; server-only adapter settings under Source.server; GET /api/config requires session; configHash on submit (409 mismatch), stored on query_request + submitted audit.
- c107: FormState fields carry labelKey, dataType, filtered enabled options, order, section labelKey, isDefault; test disabled codes never appear.
- c108: in/notIn arrays; typed gt/gte/lt/lte; evaluate on canonicalised values; literal types validated at load.
- c109: defaults precedence FieldDef > QueryType.defaults > site defaults; validation flags unused site defaults.

### Type-fields model (replaces c017 / c044 decisions; answers site-dev tertiary-type need)
- No special subtype concept. Type levels = ordinary picklist FieldDefs with role:"type" and picklistFilter:{byField}. Picklist values carry optional parent code; filtered options = values whose parent == referenced field value. Arbitrary depth.
- Visibility/required via normal conditions; sections.when groups fields per type combo.
- Drop QueryType.subtypes and CommandDef.subtype. CommandDef.presets {[fieldKey]:value}; positions may include type fields. Toggle picks command whose presets match draft type-field values, most specific wins.
- Audit submitted logs queryType code + every role:"type" field value (SEC-010 type/subtype at any depth).
- `when: Condition` also allowed on QueryType.sources[], alsoRun[], ResponseMapping.

## Chunk 4: response mapping and highlighting (all accepted)

- c099: core assessResult(payload, keywords) scans every string leaf independent of mapping, returns max severity + matched terms; card/list row/notification always badge with icon + text + colour; no mapping match -> generic key/value dump; Playwright 1024x768 test STOLEN in detail-only path shows on card.
- c010 + c101: ResponseMapping.elements union: {kind:"value", path, labelKey, view, format} | {kind:"table", path, labelKey, view, columns:[{path, labelKey, format}]} (path -> array of records, column paths relative); [*].x = projection; bracket-quoted keys; RenderElement scalar|table; table = UX-016 grid.
- c100: mapping score: queryType required; when-condition match +4; sourceId match +2; persona match +1; highest wins; equal keys rejected at validation; fallback ends in generic dump; unresolved path omitted with dev diagnostic; config:validate resolves mapping paths against mock default + scenario payloads, warns unresolved.
- c103: SiteConfig.keywordSeverityStyles per severity {color, background, bold, icon, marker}; marker always rendered; per-element highlight flag default true (off for echoed-input fields); per-keyword except phrases; Unicode boundaries via \p{L} lookarounds; validation contrast check 4.5:1.

## Chunk 5: audit, retention, logging (all accepted)

User note: no formal CJIS / GDPR / EU CRA certification needed; design must be aimed "in the neighborhood" of them.

- c039: deletedFromView audit event per real insert (result ids, actor).
- c070 + c045: AuditEventType union in core, Zod details schema per type. Catalogue: query (submitted, acknowledged, sourceDispatched, sourceResponded, interrupted, partSkipped, deletedFromView, adminViewed); auth via Better Auth hooks (loginSucceeded, loginFailed, logout, sessionRevoked, mfaEnrolled, mfaDisabled); credentials (credentialsCreated, credentialsChanged, credentialsDeleted, credentialsInvalidated); delegation (delegationCreated, delegationVerifyFailed, delegationRevoked, delegationExpired); admin/ops (roleChanged, auditViewed, auditExported, configLoaded, retentionPurged, userDisabled).
- c073: source_result.result_id UUIDv7 PK; result_visibility (result_id, user_id, hidden_at) UNIQUE + ON CONFLICT DO NOTHING; audit only real inserts; POST /api/results/hide {resultIds[]} one txn owner-only; all read paths filter hidden; resultHidden event.
- c075: cursor pagination limit<=200, required window<=31d; indexes (at), (actor_user_id,at), (correlation_id), (type,at); auditViewed per call w/ filters; roles only via scripts/ops/grant-role.ts (roleChanged); audited NDJSON export; audited GET /api/admin/queries/:id?includeHidden=true.
- c076: details schemas = identifiers, metadata, role:"type" values only; envelope encryption: per-request DEK wraps query_request.values + source_result.payload, DEK in request_key table wrapped by master; purge = delete DEK (crypto-shred); SiteConfig.retention {payloadDays, valuesDays} present now, null for prototype; scripts/ops/purge.ts writes retentionPurged; schema M2, shredding M3; GDPR position in §11.
- c029: logger redacts FieldDef keys + values/payload/body objects; error reporter never captures bodies; test values absent from logs.
- c063: audit_event no FK to user; actor snapshot (id,email,role); disable user = one txn (revoke delegations both directions, delete state_credentials, revoke sessions, userDisabled event); hard delete only via ops script after retention; audit retention basis legal obligation in §11.
- c002: §11 SEC-020 (no CJIS data in prototype; architecture targets CJIS Security Policy control areas; certification out of scope), SEC-021 (minimisation, retention mechanism, crypto-shred erasure, audit under legal obligation); all three IDs in §13; §14 risk line.

## Chunk 6: credentials, delegation, auth (all accepted)

- c043: credential owner must hold delegator role for the purpose (default trainingOfficer); trainee needs no role.
- c049 + c050: NO in-session password entry. Flow: trainee requests (sourceIds, duration) -> pending row w/ 6-char code + QR, expires 5 min -> officer approves in own session on own device (enters code / scans; sees trainee, sources, duration) -> active. Officer approval needs fresh auth <=5 min or TOTP if enrolled. Code redemption rate-limited per officer. Events: delegationRequested, delegationApproved, delegationRequestExpired, delegationRevoked, delegationExpired.
- c051: use officer's stored credentials; approval rejected if officer lacks state_credential for any requested source (error names them; officer can add in same flow). §13 notes divergence from B3 wording + reason.
- c052: credential_delegation.session_id = trainee session; resolve only on matching session; auto-revoke reason sessionEnded on sign-out/expiry/revocation, audited.
- c053: request carries sourceIds[], durationMinutes; officer confirms/narrows; SiteConfig.delegation.maxDurationMinutes default 480; partial unique index active (session_id, source_id); new revokes old (audited); active delegation overrides trainee's own credential; banner + dialog list sources.
- c054: resolve creds per (part, source) in step-3 txn; persist credential_user_id + delegation_id on each pending source_result; sourceDispatched audit per source records owner; step-3 snapshot authoritative, later revocation doesn't affect that submit; drop query_request.credential_user_id.
- c055 + c056: GET /api/delegations both parties (active + 24h); DELETE either party or admin, audited; persistent trainee banner; audit user filter = actor OR credential owner; GET /api/me/delegated-queries officer view; hide records actor only; dispatch/response events copy owner from snapshot.
- c057: encrypt {username, secret} as one AES-GCM blob; AAD = user_id|source_id|key_version; columns ciphertext, iv, auth_tag, key_version, username_hint (last 2 chars); decrypt failure -> credentialsInvalidated audit + status credentialsMissing; swapped-row test.
- c058: see chunk 1 (1.7).
- c059: API never returns secret; GET {sourceId, usernameHint, hasSecret, updatedAt, lastVerifiedAt, lastStatus}; GET /api/me/credentials list; decryption confined to dispatch module; PUT/DELETE step-up (password re-entry <=5 min or TOTP); audited.
- c060: statuses credentialsMissing, credentialsRejected; state_credential.last_verified_at, last_status; card deep-links to own credential editor or shows officer name; "retry this source" resubmits that source only; mock_credential_state table (user, source, valid|expired|rejected) via seed/admin dev route replaces "password equals expired".
- c062: client IP from CF-Connecting-IP (cloudflared sole ingress, app port unpublished); limiter keyed IP + target account, SQLite-backed; 10 fails/15min per account -> 15 min lockout; 100/15min per IP; lockout audited; tests.
- c007: SiteConfig.auth.mfaRequired: boolean | {roles[]}; middleware blocks non-auth routes until enrolled; §13 updated.
- c032: absolute 12h, idle 30 min, SiteConfig.auth.session, same for native bearer; §11.
- c034: seed derives demo passwords from SEED_PASSWORD_SECRET (Docker secret), printed once; docs/demo.md usernames only.
- c064: SiteConfig.delegation.purposes[{key, labelKey, delegatorRoles[], maxDurationMinutes}] default training; credential_delegation.purpose; in events; generic dialog title.
- c065: Secret<T> wrapper (toJSON/toString/inspect redact, .reveal() only at adapter wire boundary); logger redact paths; test adapter error log has no plaintext.

## Chunk 7: host integration and architecture (all accepted; user likes portfolio bonuses)

- c110 + c111 + c112: two modes. standalone = demo app w/ Better Auth login. embedded = host embeds web module in iframe + versioned postMessage protocol v1 (host->module: identity token, persona, context e.g. incident id; module->host: ready, resize, resultSelected, writeBackRequest for FR-061 later). frame-ancestors + CORS allowlists from deploy config. IdentityService embedded mode validates host JWT (issuer, audience, JWKS URL from deploy config), maps subject to local principal w/o password, roles from claims map in site config. Audit rows carry identity_source + host subject. Native host: packages/rn-ui RN library; Expo app = demo shell. PORTFOLIO: host-simulator page (Playwright + demo) issuing test JWTs and embedding iframe. Persona: host context first, device heuristic fallback; SiteConfig.personas open list; `records` shipped; CAD Records in §1.
- c102: declarative formats w/ params (date{pattern}, phone, upper, template), fixed set, unknown = validation error; server adapters loaded from ADAPTER_DIR volume vs SourceAdapter API v1 (mock built in); config/locales/mock by volume; one image for all sites.
- c114: /api/v1; GET /api/v1/meta {apiVersion, coreVersion, configSchemaVersion, configHash, minClientVersion}; client refuses below min; forward-tolerant config parse (z.catch); migrateConfig fns + config:migrate.
- c113: DECIDED NOW: web (dispatch, mobile unit) = Vite + React DOM; native (mobile) = Expo RN; shared packages/client (API client, WS client, replay cursor, Zustand stores, TanStack hooks, selectors, tests) + shared design tokens. Machine split: web on Windows, API on Linux.
- c115: no query data in persistent client storage; Cache-Control: no-store on /api; TanStack + Zustand reset on logout/401/user change; SecureStore token only; no service worker Phase 1.
- c117: §5.5 specifies AuditService.record(tx, event), IdentityService.resolve(req)->Principal, EntityStore (FR-061 later), EventBus.publish/subscribe; all code through them; contract test suite per interface.
- c124: push = opaque correlation ID + generic text; content fetched after unlock; §11.
- c037: §2 reworded "web form factors (dispatch, mobile unit) from M1, native by M4".
- c030: CSP: nonce script-src 'strict-dynamic'; style-src 'self'; connect-src 'self' wss://<origin>; frame-ancestors from allowlist; object-src 'none'; base-uri 'self'. M0 Playwright asserts zero CSP violations.
- c011: §13 NFR-002 row split: multi-source/nested via 5.2; volume = single-node prototype scale, cross-ref §14.

## Chunk 8: UX, keyboard, accessibility (all accepted, with user additions)

USER ADDITIONS:
- Dispatch needs single-key AND multi-key shortcuts. ShortcutMap supports single keys, modifier combos (Ctrl/Alt/Shift+key) and chord sequences (e.g. "g r"), each scoped to a context (global | panel | results | terminal). Single-key inert in text inputs; modifier combos and chords may fire anywhere unless a text input consumes them. Validation rejects collisions within a context and delimiter collisions.
- UI fully tokenized (packages/tokens: colour, spacing, type, radius, motion), consumed as CSS variables on web and RN theme on native. Switchable modes: day, night, plus a third fun mode (proposal: "red-shift" low-blue dim amber/red for in-vehicle night ops). Site may override token values (SiteConfig.theme); user picks mode in preferences; optional auto by OS scheme/time. Every mode must meet contrast targets (8.6 7:1 body on mobile unit, WCAG AA elsewhere); validation checks token pairs per mode.

- c014: single-char shortcuts inert while input/textarea/terminal focused; shortcuts by KeyboardEvent.code; validation rejects delimiter colliding w/ single-key shortcut.
- c106: M1 toggle in panel; M2 user_preference.layout.terminal "toggle"|"pane" (terminal beside results, same draft store); §11 interpretation; §13 FR-050 partial until M2.
- c122: picklist labelKeys (3.15); errors {key, params} (3.12); Intl formatting; SiteConfig.locales[] + per-user locale; GET /api/v1/locales/:locale; ships en only.
- c009: label + asterisk + hidden "required" + aria-required; never colour alone; style token.
- c005: 6.7 OS autocomplete hints per dataType; NO recent-values cache (regulated data); §13 row.
- c023: mobile-unit theme body contrast 7:1; manual daylight check M4 exit.
- x18: §2 WCAG 2.2 AA web, platform guidelines native; @axe-core/playwright every scenario from M1, CI fails serious/critical; NVDA+Chrome pass M2/M3 exits; VoiceOver+TalkBack M4 exit; §14 risk.
- x19: "Announcements and focus" subsection; one announcer: polite role=status (ack/status/timeout), assertive role=alert only for critical severity; coalesced per correlation ID; native announceForAccessibility; events never move focus; append w/o remounting focused row; optional audible cue per severity (site config); Playwright type-while-result-arrives test.
- x20: generic field renderer: label from labelKey, aria-required, blocked submit -> aria-describedby messages, focus first invalid, announce count; terminal errors via describedby; rule-revealed fields announced; offline submit focusable aria-disabled + visible reason; Playwright + axe for A2, A3.
- x21: web native elements (checkbox, listbox, table w/ headers, button aria-expanded, ul + section aria-labelledby); semantics table §6.2; packages/web-ui primitives; RN role/state props.
- x22: persona from platform + pointer + override, not width; override disables re-eval; keyboard map all web personas; 200% zoom + 320px reflow; tables scroll own container; Playwright 1920x1080 @200%.
- x23: native delete = labelled button/menu item (swipe optional w/ a11y action); focus-correct confirm; OS font scaling to 2x, targets grow; reduced motion; VO/TalkBack at largest text M4 exit.
- x24: toast supplementary; correlation ID + ack time copyable on each request entry; toast >=10s, pause on hover/focus, dismissible; polite announcer.

## Chunk 9: testing, release, mock data, traceability (all accepted; user likes red-shift)

- x1: acceptance-test matrix §10 (A1-A9, B1-B5, C1, C2: GWT, test file, layer, milestone); tests tagged w/ story ID; CI fails if shipped-milestone story has no tagged test; exit = all stories green + live smoke; A9/B3/B5 as API tests reading audit_event fields.
- x3: §10 "Security tests (API)" from milestone introducing each route: route x caller matrix (401/404/403); WS upgrade rejections (no session, expired, foreign Origin), no cross-user events; credential responses never contain secret/ciphertext; log-capture for secrets/keys; delegation wrong-code/expired/revoked w/ audit rows; auth rate limit + lockout.
- x4: expo export ios,android in CI from M0; bearer auth API tests REST + WS from M2; Maestro flow vs Expo Go for M4 (manual per release, results in docs/releases/); Expo auth fallback trigger = token not restored after cold start.
- x5: responses validated vs response schemas in tests; openapi.json committed, CI fails on unreviewed/breaking diff; Zod schemas for every WS event in core, tested.
- x9: API tests: socket close mid-dispatch + reconnect = exactly missed events once; fake-timer per-source timeout w/ sibling (B1), nested part (B2); concurrency test (every submission gets audit rows + 202); Playwright setOffline.
- x10: per-dir thresholds: 100% branches audit/credentials/delegation/dispatch; core 95; API 85; packages/client 85; assertion-level audit field tests; Stryker nightly non-blocking on sensitive dirs.
- x12: fixture policy §5.4 + docs/site-config.md: plates ZZ-#### reserved format; VINs fail ISO 3779 check digit; DOBs 1901-01-01 family; synthetic names (Testerson, Sampleworth); Example Ave addresses; scripts/mock-data/generate.ts; config:validate rejects violations; ABC123 stays for A4 parse = clean no-record; STOLEN moves to ZZ-0001.
- x14: mock keyed (sourceId, queryType, type-field values); `when` may include queryType + any field; nested parts match mapped values under nested type; TIMEOUT on exactly one of two default sources; config:validate checks every (queryType, source) has mock default resolving vs ResponseMapping.
- x13: kind required no default, validated vs registry at startup; mock block iff kind=mock; ALLOW_MOCK_SOURCES=true only dev/CI/demo; adapter_kind on source_result + sourceResponded details; test no-kind fails.
- x16: mocks -> packages/config/mock/<siteId>.json, loaded only when mocks allowed; site configs fixture-free; example-ok gets own mock file; missing mock spec for mock source = validation error.
- c046: Playwright in CI at M1 w/ keyboard-only plate + terminal flows.
- c125: §14 adds correlated AI authorship/review (mitigation: independent human security review before handoff, docs/threat-model.md), solo bus factor, provenance note in README, config schema churn, mock-shape drift, Expo Go single-SDK.
- c012: B7 property picklist -> M3; B6 write-back later w/ rationale (depends on embedding contract 7.1 + EntityStore).
- c001: §2: BR-003 no new licensing (host licence); BR-004 docs/releases/<tag>.md per milestone from config:validate --diff; BR-005 docs refresh per milestone exit; BR-006 license-checker allowlist (MIT/BSD/Apache/ISC) in CI. All four in §13.
- c006 + c015: FR-071 cited §11/§6.7/§13; FR-065 row split (foreground WS M2; background push partial, deferred, 6.7).
