---
reviewer: "opus-5.5"
effort: "high"
synthesis: "medium"
reviewedSha: "c08a60220c96f95e5e8a254526d74f5167878340"
range: "3353678383d5875402dbe516f96fba37d9d30031..c08a60220c96f95e5e8a254526d74f5167878340"
date: "10-04-26"
verdict: "fixes"
---

# M1 whole-phase review (gate item 9)

Five read-only Opus slices (effort high) reviewed the M1 range. One synthesis pass (Opus, effort medium) merged duplicates and spot-checked every important finding against the code at the reviewed SHA. There were no critical findings. Slices cited some line numbers from older offsets. This report uses the lines confirmed at c08a602.

## Scope

| Slice | Coverage note |
|---|---|
| Audit completeness | Contracts audit.ts and audit-auth.ts; audit service, seams, db tx and migrate, deps startup trigger checks, startup.ts; drizzle 0001, 0004, 0005, 0007, 0008; auth routes, identity, auth, users; admin access, users, config activate/store/draft/publish; queries route, acknowledge, admission replay; ops grant-role, lost-key, check-triggers; seed; Better Auth 1.7.6 session route. Every insert, update and delete in packages/api/src grepped. Same-transaction audit writes checked on every audited path and found OK. Two scratch vitest probes. Not reached: ws/server.ts socket revalidation, http/session.ts, preferences route, dev mock routes. Known #511 items not re-reported. |
| Access control end to end | app.ts, http security/session/web, auth routes/identity/auth, ws/server.ts, events bus, admin access/users/config routes, draft validateDocument, queries route and policy, public routes, deps wiring, env origins; core contracts routes and admin, features; route-matrix test and related tests; web admin and client auth/session code; spec 5.1, 5.6, 5.8, 10.3; ADR-0011. Route map, CSRF guard, admin guard order, QUERY_ROLES, WS upgrade checks and endSession on disable/revoke/sign-out all found consistent. Not reached: e2e admin flows, openapi generator, Better Auth internals. No vitest run. |
| Config lifecycle | admin/config activate/store/draft/publish/routes, config/load.ts, deps, startup, config and public routes, queries prepare 409, session limits; core client-config, schema, features, resolve; client config-api, config-refresh, submit, retry, translator; web bootstrap, cached-config, query panel, requests pane, status checks, admin builder files; admin-config and config-refresh e2e lists; ADR-0011, docs/site-config.md, docs/releases/m1.md. Read-only tsx/node probes from scratch. No configChanged WS event by design (ADR-0011 item 3). Not reached: Undo/history drawer, GenericForm add/remove, users admin. No verify or e2e run. |
| Submit path | queries route, admission, prepare, acknowledge, policy, errors; core queries contract and planner; request keys and aead; client submit, retry, requests; core-draft; web use-query-panel, use-terminal, send-values, announce-outcome, RequestsPane; terminal submit-check and draft; detectMode; migrations 0003 and 0005; main.ts SIGTERM; submit-guards and related tests; spec 4.3 to 4.8, 5.1, 5.2, 6.2, 6.6 to 6.8, 10.3, 12.7; ADR-0012. Two scratch vitest probes. Hidden values never persisted or audited; idempotency race and replay sound. Not reached: parser internals beyond submit-check, WS ackReceipt (M2), Server-Timing (M2 P1). |
| Logs and secrets | log/logger.ts and every logger call in packages/api/src; Better Auth logger adapter; main.ts fatal and startup paths; throw sites in queries, admin users and config, keys, db; log-capture test; scripts/ops smoke, ws-soak, restore-test (with the 4e49cd7 ALLOW_MOCK_SOURCES fix), backup, deploy-pull, seed, login-stats, lost-key, grant-role, check-triggers; CI smoke-request-key and boot-smoke; dev e2e scripts; web console and storage grep; docs grep for printed secrets. One scratch probe with the real logger and drizzle-orm 0.45.3. Not reached: compose and Dockerfile secret wiring, full web tree. |

## Findings by severity

### Critical

None.

### Important

**AUD-1** (gate) `packages/api/src/auth/auth.ts:218-222` with `identity.ts:74-76`
- Summary: Better Auth getSession deletes any session past its absolute expiry. It writes no sessionRevoked or logout row and calls no EventBus.endSession. Every requireSession, adminGuard, WS upgrade and sign-out resolve goes through it, so expired sessions vanish unaudited and the M2 P2 sweeper (spec 5.2(c), the only writer of sessionRevoked expired) never sees them.
- Evidence: Better Auth 1.7.6 dist/api/routes/session.mjs:162 `if (!deferSessionRefresh || isPostRequest) await ctx.context.internalAdapter.deleteSession(session.session.token);` inside the expired branch (confirmed). auth.ts:220 `expiresIn: o.session.absoluteMinutes * 60`. identity.ts:76 calls getSession with `disableRefresh: true`, which does not skip the delete. Slice probe: status 401, sessionRowsLeft 0, auditTypes [loginSucceeded], endSessionCalls 0.
- Fix: Only the app ends sessions. Set Better Auth expiresIn well above the largest allowed absoluteMinutes (identity already enforces absolute and idle). Leave deletion to the sweeper, which deletes, writes sessionRevoked{expired} in one tx and calls endSession. Test: an absolute-expired row survives resolve(), is refused 401, and is ended by the sweeper with one audit row.
- reqIds: SEC-010, SEC-005; spec 4.7 sessionRevoked, 5.2 Sweeper (c), 5.6 Session limits; ADR-0011 item 3
- crossPr: yes

**LS-1** (gate) `packages/api/src/app.ts:68-71`
- Summary: app.onError logs the raw Error. A drizzle query failure on any route except submit writes the query params to the service log: new user email, name and password hash on admin user create, the whole config document on draft save, publish and rollback, and the session token and client IP on sign-in.
- Evidence: app.ts:69 `d.logger.error("unhandled", { err, method: c.req.method, path: c.req.path });` (confirmed). logger.ts:81-82 serializes an Error as `{ name, message }` with only fixed env secrets scrubbed (confirmed). drizzle-orm errors.js:11-13 builds the message as `Failed query: ${query}\nparams: ${params}` (confirmed). Only queries/errors.ts and the Better Auth adapter sanitize. Slice probe with the real logger printed `params: acc1,scrypt$hash-of-temp-pw` and `params: LIVE-SESSION-TOKEN-abc123`. log-capture admin cases cover success paths only.
- Fix: Sanitize at the sink. In onError log only the error name plus a SQLITE_* code walked from cause, never err.message; or have logger.ts reduce any Error whose message contains `Failed query` or `\nparams:` to its name. Add log-capture cases that force a DB failure in POST /admin/users and PUT /admin/config/draft and assert email, hash, document canary and token reach no sink.
- reqIds: SEC-006, SEC-001, spec 5.9, ADR-0011 item 8
- crossPr: yes

**CFG-3** (critical) `packages/api/src/admin/config/store.ts:135-138`
- Summary: Every boot compares the stored config_hash with a hash of the re-parsed document. The next additive schema change that adds a defaulted field (allowed under schema v1 per the release notes) makes every stored row hash differently, and the upgraded server refuses to start with config.hashMismatch. Published rows are trigger-frozen, so there is no in-app recovery.
- Evidence: store.ts:137-138 `if (published.configHash !== config.configHash) throw new ConfigLoadError(label, "", "config.hashMismatch");` (confirmed). load.ts:258 hashes the parsed siteConfig with schema defaults (confirmed). releases/m1.md:8 says every change is additive within v1. Slice probe: stored doc without the defaulted `terminal` key gives `stored hash == boot hash false`.
- Fix: Separate tamper detection from config identity: store and compare a digest of the stored document text, recompute configHash under the running schema and write configLoaded with it. Test: load a stored row lacking a defaulted key.
- reqIds: SEC-010, spec 5.8, ADR-0011 items 1-2
- crossPr: yes

**CFG-4** (gate) `packages/api/src/admin/config/store.ts:139-145`, `deps.ts:96`
- Summary: Site, mock and default changes shipped in a new image never reach an already-seeded deploy. The file is compared, logged as "site config file ignored", and dropped. No import path exists (builder has Export only, no import script). The M2 P0.5 plan regenerates packages/config/mock/default.json, but the server serves the stored document.mock, so the host keeps the old mock.
- Evidence: store.ts:139-144 computes fileIgnored and returns it; deps.ts:96 only warns (confirmed). `ls scripts/ops` has no import script (confirmed). load.ts readMock returns doc.mock. docs/site-config.md:18-19 says a site changes by publishing an exported document. Plan 2026-09-29-track-a-p3.md:276 Task 2 regenerates the mock.
- Fix: Add a committed operator path (scripts/ops/config-import.ts: validate, save draft, publish through activate() with configPublished) or a builder Import action. Document the upgrade step in docs/releases and docs/site-config.md. Decide whether the mock belongs in the store or is read from the image.
- reqIds: BR-001, BR-005, ADR-0011 item 1, spec 5.8
- crossPr: yes

**CFG-2** (ordinary) `apps/web/src/admin/admin-config.ts:158,192`
- Summary: The builder cannot publish a new query type or a new source on a mock-source site, and every M1 deploy is one. The server refuses with config.missingMockResponse. Browser checks never run mock coverage, the builder has no mock editor, and documentFrom carries the base mock unchanged, so the implementer cannot fix it in the app.
- Evidence: resolve.ts:134-145 pushes config.missingMockResponse for each query type on a mock source without a response (confirmed). admin-config.ts:192 returns `{ siteConfig, locales, ...(base.mock === undefined ? {} : { mock: base.mock }) }` and :158 forces `kind: "mock"` on sources (confirmed). Slice probe: browser errors [], server `missingMockResponse` on /sources/0/id and /sources/1/id. No e2e adds a query type.
- Fix: Design question: (a) mock coverage becomes a warning and the mock adapter answers a default no-record; (b) the builder adds a default mock response per new (source, queryType); (c) a builder mock section. In every case show coverage in browser checks. Add an e2e that adds and publishes a query type.
- reqIds: FR-060, BR-001, ADR-0011 items 4-5, spec 5.8
- crossPr: yes

**CFG-1** (ordinary) `packages/api/src/config/load.ts:258`
- Summary: Published label-overlay changes never reach open clients. configHash covers siteConfig only, and the web translator is built once at boot from a locale cache with infinite stale and gc time. A labels-only publish keeps the same hash, so config-refresh never fires; a field whose label lives only in the overlay shows its raw key to open dispatchers until reload, while the builder preview shows the text.
- Evidence: load.ts:258 hashes `canonicalJson(siteConfig)` only (confirmed). config-refresh.ts:75 swaps only on configHash change (confirmed). bootstrap.ts:37-50 caches ["locale"] with Infinity and builds the translator once (confirmed). Slice probe: `v3 (label only) ... configHash v2==v3 true`. admin-config e2e uses a pre-shipped label key, hiding the gap.
- Fix: Add a labels signal (labelsHash or live version id) to ClientSiteConfig or /meta; on change refetch ["locale", locale] and swap the translator. Do not fold locales into configHash (see CFG-3). Add an e2e for an overlay-only label publish.
- reqIds: BR-001, NFR-001, ADR-0011 items 3-4, spec 6.7
- crossPr: yes

**SUBMIT-1** (ordinary) `packages/client/src/query/submit.ts:120,179-189`; `retry.ts:5-13,44`
- Summary: The client loses the Idempotency-Key of a request the server may already hold. A Retry from the requests list can send a new key and create a second acknowledged request, contradicting the noResponse text that promises the same query is retried. One controller-wide keptKey is overwritten by any other submit and cleared by any HTTP answer; the original noResponse row stays retryable after its retry is acknowledged; a gateway 502/52x or a 429 reads as "not sent" and gets a new key.
- Evidence: submit.ts:120 `let keptKey ... = null;`, :180 `keptKey = null;` in settled(), :188 `const key = keptKey?.fingerprint === fingerprint ? keptKey.key : newKey();` (confirmed). retry.ts:9-13 retryable for every failed row except invalid, forbidden and configChanged; :44 resubmits with the current configHash (confirmed). Slice probe: (a) A drops, B sent, Retry A takes key-3; (b) after an acknowledged retry, the original row is still retryable and takes key-2; (c) 502 then retry takes key-2.
- Fix: Store the Idempotency-Key and original configHash on the request row; retryRequest passes them for noResponse, non-ApiError 5xx, 502 and 520-524, and 429. Mark the original row superseded once a retry is acknowledged. Say "may have been received" for gateway errors. Optionally move the replay lookup before the per-user limiter (critical tier, admission.ts). Add tests for (a) to (c).
- reqIds: FR-064, NFR-002, spec 5.2 step 1, spec 6.7, spec 6.8
- crossPr: yes

**SUBMIT-2** (ordinary) `packages/core/src/rules/visibility.ts:17-22`; `apps/web/src/query/send-values.ts:11-21`
- Summary: A stale hidden draft value turns a plate-only query into a normal one. After an out-of-state plate with Plate Type, the terminal command VEH.<plate> (or the form with State cleared) plans in normal mode and also goes to the national source, with no cue to the user. valuesToSend posts the hidden plateType so the server mode matches.
- Evidence: visibility.ts:19-21 plateOnly only if every raw input other than plate is empty, hidden fields included (confirmed). send-values.ts:21 `return evaluateForm(...).mode === state.mode ? kept : values;` sends the hidden value when pruning changes the mode (confirmed). Slice probe on default.json: fresh VEH.ZZ-0001 plans plateOnly; with a stale {state: OK, plateType: PC} draft it plans normal with sourceIds [stateSource, nationalSource]; pruned it plans plateOnly and drops nationalSource. Spec 10.2 A2 says a hidden Plate Type value is not submitted.
- Fix: Spec 4.3 step 6 ruling: judge plate-only emptiness ignoring values of fields hidden in the normal-mode evaluation, implemented in core rules so client and server agree, then remove the valuesToSend fallback. Interim: send the pruned values with the mode evaluated on them. Add a table test for the stale plateType terminal case.
- reqIds: FR-012, FR-010, A1, A2, spec 4.3 step 6, spec 4.4, spec 4.6 step 3
- crossPr: yes

**AC-1** (ordinary) `apps/web/src/admin/users-api.ts:105-119`
- Summary: Admin "Sign out everywhere" ends at most 100 sessions and reports success. The server list is capped at 100, newest first, and the client does one list-then-delete pass, so a user (or a stolen-password holder) with more than 100 live sessions keeps the oldest live, sockets included, with no cue to the admin.
- Evidence: admin/users/users.ts:285-287 `.orderBy(desc(session.createdAt)).limit(100)` (confirmed). contracts/admin.ts:147 `.max(100)` with no truncation flag. users-api.ts:107-119 one GET, deletes the non-current rows, returns `others.length` (confirmed). No per-user session cap in packages/api or core.
- Fix: Loop list-then-delete until no non-current session remains (bounded) and sum the count; or add a server revoke-all route (gate plus contract change) with one tx, one audit row and endSession per session. Add a test with more than 100 sessions.
- reqIds: spec 5.6, ADR-0011 item 8, SEC-005
- crossPr: yes

### Minor

**AUD-2** (gate) `packages/api/src/auth/routes.ts:147-162`. loginSucceeded is written in its own tx after Better Auth inserted the session and after the limiter reset; an audit failure returns 500 with no cookie but leaves a live session row that the admin list shows with no sign-in audit. Evidence: probe `status 500, setCookie 0, sessionRows 1, auditTypes [], adminListed 1`. Fix: delete the session row on audit failure, move limiter.reset after commit, add a test. reqIds: SEC-010; spec 4.7, 5.2, 5.6. crossPr: yes.

**AUD-3** (gate) `packages/api/src/admin/users/users.ts:125-158, 303-317`. createUser and revokeSession do not call actorStillAdmin(tx, actor) inside their tx, unlike disableUser (:183) and setUserRole (:240); a just-demoted admin can still create an admin and receive its password, with an audit row naming role admin. Fix: add the check and race tests. reqIds: SEC-010, SEC-005; ADR-0011 items 6, 8. crossPr: yes.

**AUD-4** (gate) `packages/api/src/ops/check-triggers.ts:22-25`. The ops trigger check claims to match startup but skips checkConfigVersionTriggers (deps.ts:72-74 runs three sets). Fix: add the call, update message and usage, extend boot-smoke. reqIds: SEC-010; spec 9.3 step 11; ADR-0011 item 1. crossPr: yes.

**AUD-5** (gate) `packages/api/src/ops/grant-role.ts:44-45`. Spec 4.7, ADR-0011 item 7 and code comments disagree with the shipped audit catalogue (roleChanged via adminConsole, configPublished, userCreated targetUserId, admin sessionRevoked); grant-role.ts and auth/users.ts say roles change only through grant-role. Fix: amend spec 4.7, correct ADR field names, reword comments. reqIds: SEC-010; spec 4.7, 5.6; ADR-0011 item 7. crossPr: yes.

**AC-2** (ordinary) `apps/web/src/admin/roles.ts:4-6`. The web admin console gates on role only, never features.adminConfig or adminUsers; with a flag absent or adminUsers published off, admins see the Admin link and Users nav and every call 404s. Fix: gate AdminLink and AdminLayout on role and flags; web tests with flags off. reqIds: spec 5.8, ADR-0011 item 6. crossPr: yes.

**AC-3 / CFG-7** (gate and critical; merged) `packages/api/src/deps.ts:104-110`, `auth/auth.ts:220`, `admin/config/draft.ts:413-443`. Better Auth expiresIn is fixed from the boot config, while ADR-0011 and identity.ts promise published session limits apply at the next request. Raising absoluteMinutes by publish has no effect until restart; lowering applies via identity but the admin list still filters and shows the boot expiresAt. validateDocument guards only auth.mfaRequired. Same root as the second half of AUD-1; the AUD-1 fix (fixed ceiling in Better Auth, live enforcement in identity) resolves it if the admin list's expiresAt is derived from createdAt plus the live limit. Otherwise refuse or warn on a /auth/session change (config.restartRequired) and document it in m1.md. reqIds: SEC-005, spec 5.6, ADR-0011 items 3, 6. crossPr: yes.

**CFG-5** (ordinary) `apps/web/src/admin/checks.tsx:150-160`. Browser label checks use the live-served bundle, which already includes the live overlay; the server checks shipped files plus the draft overlay, so removing a live-only overlay label shows clean in the browser and fails at Review with config.missingLabel. docs/site-config.md:485-486 overclaims parity. Fix: validate against shipped keys only; correct the doc. reqIds: UX-004, ADR-0011 item 5, spec 5.8. crossPr: yes.

**CFG-6** (ordinary) `packages/client/src/query/submit.ts:212`. A 409 configHashMismatch on a requests-list Retry calls invalidateQueries with the default refetchType "active", and nothing observes ["config"], so no refetch happens until the 15 s poll (spec 6.7). Comments at RequestsPane.tsx:101 and config-api.ts:46 are stale. Fix: `refetchType: "all"` as PublishFlow.tsx:263 does, fix comments, add a test. reqIds: spec 6.7, ADR-0011 item 3. crossPr: yes.

**CFG-8** (ordinary) `apps/web/src/admin/Preview.tsx:15-18`. The preview parses the raw draft with ClientSiteConfigSchema, which requires keys production fills from SiteConfigSchema defaults; a valid draft omitting a feature flag or a source timeoutMs pauses the preview. Fix: build through buildSiteConfig then toClientSiteConfig, as viewOf does. reqIds: ADR-0011 item 4, spec 4.1. crossPr: yes.

**SUBMIT-3** (ordinary) `docs/decisions/0012-m1-exit-v1-demo-and-m2-p0-5-dispatch.md:30`, `docs/releases/m1.md:71`. The M1 exit text and release notes say hidden values are "rejected"; the server accepts with 202 and prunes (submit-guards.test.ts:100-103), which matches spec 10.3 "neither persisted nor dispatched". Fix: reword both lines via a recorded controller ruling. reqIds: spec 10.3, spec 12.7. crossPr: yes.

**LS-2** (critical) `packages/api/src/startup.ts:84-92`. bootstrap's new catch says the error is not logged, then rethrows; main.ts's startup catch writes err.message unredacted to stderr, outside logger.ts, so a failed configLoaded write or seed insert prints drizzle params (current payloads hold no secret). Contradicts main.ts:8-9. Fix: write the message only for known fixed-text error classes, name only otherwise; or rethrow a fixed-text StartupRefusedError. reqIds: SEC-006, spec 5.9, spec 8.1. crossPr: yes.

## Dropped

None of the slice findings were dropped. Every important finding was confirmed at the cited code, with corrected line numbers for store.ts (135-145, not 239-248) and retry.ts (5-13, 44, not 274-313). Merged: AC-3 and CFG-7 are one defect (boot-fixed Better Auth expiresIn); the second half of AUD-1 states the same defect and is carried by the merged entry.

## Recommended disposition

| Finding | Disposition |
|---|---|
| LS-1 | Fix in M1. Small sink change plus log-capture failure cases; gate tier. |
| AC-1 | Fix in M1. Client loop in revokeUserSessions plus test; ordinary. |
| AUD-1 | File for M2 P2 (sweeper task). Needs the sweeper to own expiry; record on that task. |
| CFG-3 | File for M2 P0.5. Must land before the first additive config-schema change; critical tier. |
| CFG-4 | File for M2 P0.5. Blocks the planned mock regeneration reaching the host. |
| CFG-2 | File for M2 P0.5. Design question (mock coverage policy) with CFG-4. |
| CFG-1 | File for M2 P1. Labels signal and translator swap. |
| SUBMIT-1 | File for M2 P1. Per-row key storage and retry semantics. |
| SUBMIT-2 | File for M2 P1. Needs a spec 4.3 step 6 ruling first. |
| AUD-3 | Fix in M1. Two actorStillAdmin calls plus race tests. |
| AUD-4 | Fix in M1. One call plus message and usage text. |
| CFG-6 | Fix in M1. One-line refetchType change plus test and comments. |
| SUBMIT-3 | Fix in M1. Docs reword via controller ruling. |
| AUD-2 | File for M2 P2 (auth audit hardening, with #511). |
| AUD-5 | File for M2 P0.5 (docs pass on spec 4.7 and ADR-0011). |
| AC-2 | File for M2 P1. |
| AC-3 / CFG-7 | File for M2 P2, resolved with AUD-1. Note the restart requirement in docs/releases/m1.md now. |
| CFG-5 | File for M2 P1. |
| CFG-8 | File for M2 P1. |
| LS-2 | File for M2 P0.5 (critical tier, no current secret payload). |
