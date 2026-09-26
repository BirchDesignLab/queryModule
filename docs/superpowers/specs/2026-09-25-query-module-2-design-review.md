# Query Module 2.0 Design: Adversarial Review

- **Date:** 09-25-26
- **Reviewed document:** `docs/superpowers/specs/2026-09-25-query-module-2-design.md` (Query Module 2.0 Design, dated 09-25-26, status "approved in brainstorming, pending adversarial review")
- **Method:** 9 finders in 2 waves (traceability, UX, deploy, consistency in wave 1; credentials, audit, dispatch, parser, architecture in wave 2), duplicate clustering, 2-lens adversarial verification of every cluster (lens A: misread; lens B: materiality) with a tiebreak verifier on split verdicts, then an Opus critic pass over the report and the verdicts. The critic corrected three final severities (c009, c012, c054), reinstated two refuted clusters (c015, c111), folded two refuted clusters into confirmed ones (c021 into c060, c067 into c075), and drove an extra finder round on three lenses the first pass lacked (testing strategy and release sequencing; mock data and the fixture-realism rule; accessibility beyond keyboard). The extra round's 24 findings (x1 to x24) went through the same 2-lens verification and tiebreak.
- **Counts:** 169 raw findings (145 plus 24 from the extra round), 147 clusters (125 less 2 folded, plus 24), 123 confirmed, 24 refuted.
- **Confirmed by final severity:** 12 blocker, 85 major, 26 minor. 15 confirmed clusters were downgraded from their claimed severity.

## Verdict

The design is not ready to implement as written, though its skeleton is sound: pure core, structured JSON conditions, server-side re-validation, soft delete through a separate table and append-only audit triggers all survived review. Before M0, fix the process and storage foundations that are hard to retrofit: an enforced review gate on sensitive paths (c025), a rollback procedure Watchtower cannot undo (c026), a database-level encryption decision for query data (c047), and a persisted `pending` state plus startup recovery for dispatch (c072), since each shapes the first migrations. The release path needs the same treatment before M0: a way to merge sensitive work dark (x6) and a CI step that boots and smoke-tests the image it pushes (x7). Before M1, settle the rules and parser semantics that the forms and terminal milestone builds on: what `$default` means (c038), how plate-only is detected (c086), what `setDefault` does to typed values (c087), referential config validation (c097), override and picklist semantics (c098), and the terminal grammar gaps (c016, c017, c093, c094, c096). Also before M1, decide the host embedding contract and host identity handoff (c110, c111), because it decides whether `apps/app` is an app or a library plus a demo shell, and name an accessibility conformance target (x18), because the generic field renderer and results list are built in M1 and M2. Before M2, the audit record must stand alone (c068), delete-from-view must be audited (c039), nested parts need their own keys (c036), the WebSocket needs an Origin check and a real replay table (c061, c040), and result severity must be computed over the whole payload so a keyword hit always reaches the summary card (c099), since highlighting (A7) ships in M2. Before M3, the delegation model needs a rewrite: per-source credential ownership (c054), role checks (c043), a throttled and audited verification path (c049), session binding, bounded scope and a listing route (c052, c053, c055). Across every milestone, the exit criterion should be green story-tagged acceptance tests plus security negative tests, not "live on the URL" (x1, x3).

## Top issues

1. **c072 [blocker]: An acknowledged query is lost if the process dies before dispatch finishes.** Step 3 returns 202 and only then enqueues work on an in-memory queue. No `source_result` row exists until an outcome, the status set has no `pending`, and nothing sweeps on startup. Watchtower restarts the container on every merge to `main`, so this is routine, not rare: the user sees a query that never resolves, FR-044's timeout never fires, and the audit shows `submitted` and `acknowledged` with no `sourceResponded`. Persist `pending` rows in the step-3 transaction, mark them `interrupted` at startup, and drain on SIGTERM.

2. **c047 [blocker]: SEC-006 encryption at rest covers only the credential secret.** `query_request.values`, `source_result.payload` and `audit_event.details` are plaintext JSON in a SQLite file on a laptop, with `CREDENTIAL_KEY` in `.env` on the same disk. Section 13 maps SEC-006 to 5.7 and 5.9, neither of which encrypts query data. Choose a database-level mechanism (libSQL `encryptionKey` or SQLCipher) with a separate key now, because it changes how the file and its backups are created.

3. **c068 [blocker]: An `audit_event` row cannot stand alone.** Query type, subtype and target sources exist only in `query_request`, which the lifecycle itself updates, and actor identity is a bare foreign key into Better Auth's editable `user` table. No immutable record holds every SEC-010 and SEC-012 field. Define a Zod schema per event type for `details` and make `query_request` insert-once.

4. **c025 [blocker]: Sensitive-code review has no enforcement.** Section 5.7 says credentials, audit and the query pipeline are reviewed on Opus seats, but section 9 self-merges on green CI with "No rulesets by decision", and every merge ships to the public URL within five minutes. A change to delegation or the audit triggers can reach production with no review on record. Add a required-review rule or CI check scoped to the sensitive paths.

5. **c061 [blocker]: The WebSocket upgrade has no Origin check.** CORS does not apply to WebSocket handshakes, and SameSite=Lax cookies are sent from any `*.birchdesignlab.com` page, so a sibling page can open `/api/ws` as the victim and read hit payloads. Sockets also outlive logout. Reject foreign Origins before upgrade, keep bearer tokens out of the URL, and bind each socket to its session.

6. **c039 [blocker]: Delete-from-view writes no audit event.** Every other state change names its `audit_event`; the hide route only inserts into `result_visibility`. SEC-013 requires the deletion to be in the audit log, yet section 13 lists it as covered. Add `audit_event(deletedFromView)`.

7. **c036 [blocker]: Nested parts collide with their parent.** The design says all plan parts share one correlation ID, while `source_result` and `result_visibility` are keyed on (correlation_id, source_id) and `query_request` makes correlation_id a primary key with a `parent_correlation_id`. When parent and child hit the same source, results overwrite each other, one hide conceals both, and the child gets no `submitted` audit row. Add a `part_id`.

8. **c086 [blocker]: The plate-only predicate cannot work.** FormState keeps only effective values and State is always defaulted, so tested on effective values plate-only never fires, and tested on raw input it fires on the common A1 path and silently replaces the user's source selection. Add `userValue` and an explicit `FormState.mode`.

9. **c038 [blocker]: `$default` is not disambiguated from the mutable `effectiveValue`.** If `$default` reads the same value `setDefault` mutates, the flagship "State is not the site default" rule compares a field to itself and never fires. State that `$default` is the static configured default, frozen before evaluation.

10. **c099 [blocker]: Keyword hits in detail-only or unmapped fields never reach the summary card.** Highlighting runs only on rendered values and mobile-unit cards show summary elements only, so a STOLEN or WANTED flag in a detail element or an unmapped path is invisible until a tap, or forever. Compute result severity over every payload leaf and always badge it.

11. **c110 [blocker]: No embedding path exists.** The design ships a separate Expo app, forbids iframes with `frame-ancestors none`, locks CORS to its own origin, and has no host context channel for FR-061 write-back, while section 13 claims BR-002 and PLT-006 as a "standalone add-on". Add a host embedding contract.

12. **c026 [blocker]: Watchtower undoes the documented rollback.** Compose pins `:latest` and Watchtower polls every five minutes, so `docker compose pull` of a sha tag lasts until the next poll puts the broken image back. Document pausing Watchtower and repinning `compose.yml`.

The extra round produced no blockers, but four of its majors rank just below this list because they decide whether any fix above stays fixed: every merge ships half-built sensitive work to the public URL with no flags (x6), CI pushes an image it never booted (x7), no security negative test would catch an authorization regression (x3), and no Appendix A story is tied to a named acceptance test, which is how c039 went unnoticed (x1). The host identity gap (c111, reinstated by the critic) belongs with c110.

## Confirmed findings by theme

### Credentials and delegation

#### [MAJOR] c043: The `trainingOfficer` role is defined but never checked in the delegation flow
- **Requirement IDs:** SEC-003, SEC-004
- **Design section:** 5.6, 5.7
- **Design quote:** "Roles: `user`, `trainingOfficer`, `admin`, stored on the user row and checked by route middleware." / "The officer's email and password are POSTed to `/api/delegations`, verified through Better Auth's server API with no session cookie or token issued"
- **Argument:** 5.6 implies delegation is role-gated, but 5.7 only verifies the second user's password. Any authenticated user can lend credentials into another user's session, in code the design itself names as sensitive.
- **Recommendation:** Require the credential owner to hold `trainingOfficer` (or a configured delegator role) on `POST /api/delegations`, enforced by the 5.6 middleware, and say so in 5.7.

#### [MAJOR] c049: `POST /api/delegations` is an unthrottled, unaudited password oracle
- **Requirement IDs:** SEC-003, SEC-005, SEC-011, SEC-020
- **Design section:** 5.6, 5.7
- **Design quote:** "verified through Better Auth's server API with no session cookie or token issued" / "Rate limiting on auth routes."
- **Argument:** The route is custom, outside Better Auth's `/api/auth/*` limiter and outside the two-factor sign-in hook. Any logged-in user can guess any officer's password at full speed, and an officer with TOTP enrolled is authenticated by password alone. No failed-attempt audit event exists. Finders note Better Auth has no public "verify another user's password without a session" endpoint, so the likely implementation calls the hasher directly (reasoning beyond the doc).
- **Recommendation:** Name the verification mechanism. Rate-limit keyed on caller and target, lock after N failures, require the officer's TOTP when enrolled, and write `delegationFailed` and `delegationCreated` audit events.

#### [MAJOR] c050: The officer types their full account password on a device the trainee controls
- **Requirement IDs:** SEC-003, SEC-001
- **Design section:** 5.7, 6.2
- **Design quote:** "inside the trainee's session the app opens a \"training officer sign-in\" dialog. The officer's email and password are POSTed to `/api/delegations`"
- **Argument:** Capturing that password is full account takeover, including the officer's stored state credentials. The trainee's device is untrusted from the officer's view and the dialog cannot prove it is genuine. The password also persists in React state and the TanStack mutation cache.
- **Recommendation:** Make the primary flow an approval from the officer's own session (short code or QR). If in-session entry stays as a fallback, require TOTP, show the trainee identity and scope, set `gcTime: 0` and clear mutation variables, and keep `/api/delegations` bodies out of logs.

#### [MAJOR] c051: The officer authenticates to the Query Module, not to the state system; officers with no stored credential are unhandled
- **Requirement IDs:** SEC-003, SEC-001
- **Design section:** 5.7
- **Design quote:** "While active, dispatch resolves credentials from the officer for that source"
- **Argument:** B3 has the officer enter state credentials. The design verifies the officer's app password and reuses whatever state credential the officer stored earlier. If none exists, delegation succeeds and every trainee query returns `badCredentials` with no explanation.
- **Recommendation:** Reject the delegation when the officer has no `state_credential` for a requested source, or accept officer-entered, never-persisted credentials scoped to the delegation. Say which satisfies B3 in section 13.

#### [MAJOR] c052: Delegation is bound to the trainee's user, not their session
- **Requirement IDs:** SEC-003
- **Design section:** 5.5, 5.7
- **Design quote:** "`credential_delegation` (id, session_user_id, credential_user_id, source_id, created_at, expires_at, revoked_at)."
- **Argument:** `session_user_id` is a user id and dispatch resolves by trainee plus source, so a delegation granted at one console also works on the trainee's phone for 8 hours and survives sign-out. SEC-003 scopes delegation to a session.
- **Recommendation:** Add `session_id`, resolve only when the query's session matches, and auto-revoke (with an audit event) on sign-out, expiry or session revocation.

#### [MAJOR] c053: Delegation scope, multiplicity and lifetime are undefined
- **Requirement IDs:** SEC-003, SEC-004
- **Design section:** 5.7, 5.1
- **Design quote:** "a `credential_delegation` row is created with a default expiry of 8 hours."
- **Argument:** A row holds one `source_id`, but the POST body never names sources, so a multi-source plate query either needs N rows or leaves sources on the trainee's absent credentials. No uniqueness rule governs concurrent delegations, precedence between own and delegated credentials is unstated, "default" implies a client-set expiry with no cap, and admins cannot manage delegations.
- **Recommendation:** Define the body as `{ officerEmail, password, sourceIds[], durationMinutes }` with a site-config cap. Add a partial unique index on active (session_id, source_id), let a new delegation revoke the old one with an audit event, state that an active delegation overrides the trainee's own credential, and list covered sources in the dialog.

#### [MAJOR] c054: Per-source delegation mixes two credential owners in one request, but `query_request.credential_user_id` is stored once (severity corrected by critic)
- **Requirement IDs:** SEC-011, SEC-003, SEC-010, SEC-014, FR-040
- **Design section:** 5.2, 5.5, 5.7
- **Design quote:** "While active, dispatch resolves credentials from the officer for that source, and `query_request.credential_user_id` and every audit row record both identities."
- **Argument:** Delegation is per source and credentials resolve per source in step 4, after the 202 and after the `submitted` and `acknowledged` rows are written. A request can run source A on the officer's credentials and source B on the trainee's, which the single request-level `query_request.credential_user_id` cannot represent. The audit schema itself can: `audit_event` has its own `credential_user_id` column (5.5) and 5.7 says every audit row records both identities, so each per-source `sourceResponded` row can carry that source's credential owner. The defect is that the design never says `sourceResponded` records the owner resolved at dispatch, never says when that owner is resolved, and keeps a request-level column that will disagree with it. A delegation revoked or expiring while the job waits in the queue changes whose credentials are used, and nothing states which owner the audit records in that case. Lens B made the per-row point; the critic moved the final severity from blocker to major because SEC-011 attribution is representable at audit-event granularity.
- **Recommendation:** Resolve credentials for every (part, source) in the step-3 transaction and persist the snapshot. Put `credential_user_id` and `delegation_id` on each `source_result`, write `audit_event(sourceDispatched)` per source, define in-flight behaviour on revocation, and test a two-source request with delegation on one source.

#### [MAJOR] c055: Delegation grant, revoke and failed-verification events are not audited, and nobody can list delegations
- **Requirement IDs:** SEC-011, SEC-003
- **Design section:** 5.1, 5.5, 5.7
- **Design quote:** "`POST /api/delegations`, `DELETE /api/delegations/:id`" / "Either user can revoke."
- **Argument:** Nothing records that an officer lent credentials, to whom, for which sources, or who revoked it. With no GET route, the officer, who is not on the trainee's device, cannot discover the id needed to revoke, and the trainee's UI cannot show "querying as Officer X".
- **Recommendation:** Add `delegationCreated`, `delegationRevoked`, `delegationExpired` and `delegationVerifyFailed` events, a `GET /api/delegations` for both parties, an ownership check on DELETE, and a persistent banner in the trainee's panel.

#### [MAJOR] c056: SEC-011 audit is not queryable by credential owner, and "every audit row records both identities" is ambiguous for later actions
- **Requirement IDs:** SEC-011, SEC-013
- **Design section:** 5.1, 5.7
- **Design quote:** "`query_request.credential_user_id` and every audit row record both identities."
- **Argument:** `GET /api/audit` filters "by user" without saying which column, and `GET /api/queries` returns only the caller's requests, so an officer cannot see queries run under their credential. It is unspecified whether a later hide by the trainee copies the credential owner or leaves it null.
- **Recommendation:** Define the user filter as actor OR credential owner, add a credential-owner view for officers, and state which events copy the credential owner from the per-source snapshot and which record the actor only.

#### [MAJOR] c057: Credential ciphertext has no AAD binding and no key version; the username is plaintext
- **Requirement IDs:** SEC-006, SEC-011
- **Design section:** 5.5, 5.7
- **Design quote:** "`state_credential` (user_id, source_id, username, secret_ciphertext, iv, updated_at)."
- **Argument:** AES-GCM without additional authenticated data authenticates bytes, not their owner, so a row copied from an officer to a trainee decrypts cleanly and silently bypasses delegation and its audit. No auth-tag column is named, no `key_version` exists for a future rotation, and the username half of the credential is plaintext.
- **Recommendation:** Use AAD over user_id, source_id and username, treat decrypt failure as "credential unusable" plus an audit event, add `auth_tag` and `key_version`, encrypt or justify the username, and test that a swapped row fails.

#### [MAJOR] c058: `CREDENTIAL_KEY` custody, loss and compromise are undesigned
- **Requirement IDs:** SEC-006
- **Design section:** 5.7, 8, 2
- **Design quote:** "key from `CREDENTIAL_KEY` (32 bytes, base64) in the environment, never logged (SEC-006)."
- **Argument:** The key sits in `.env` on the same disk as `/data` and is readable through `docker inspect`, `/proc/1/environ` and Watchtower's Docker socket. A missing, malformed or mismatched key (restored backup, regenerated `.env`) has no defined behaviour; likely implementations crash or pass null credentials. Key rotation is a non-goal, but this is recovery, not rotation.
- **Recommendation:** Load the key from a Docker secret file, validate it at startup against a canary row and fail closed, and add a lost-key runbook under `scripts/ops/` that wipes credentials, audits the invalidation and forces re-entry.

#### [MAJOR] c059: `GET /api/me/credentials/:sourceId` has no defined response shape
- **Requirement IDs:** SEC-006, SEC-001
- **Design section:** 5.1, 5.7
- **Design quote:** "`GET/PUT/DELETE /api/me/credentials/:sourceId` | State-system credentials"
- **Argument:** Nothing rules out returning the decrypted secret, after which any XSS, stolen session or cached response yields a state password. There is no list route, and PUT and DELETE need no re-authentication, so a stolen session can swap in an attacker-controlled credential.
- **Recommendation:** State that the API never returns a secret; GET returns masked username, `hasSecret`, `updatedAt` and last result. Add a list route, confine decryption to the dispatch path, require step-up on PUT and DELETE, and audit both.

#### [MAJOR] c060: The SEC-002 expiry path has no status, no link to the failing query and no delegated case
- **Requirement IDs:** SEC-002, FR-043
- **Design section:** 5.2, 5.4
- **Design quote:** "If `requiresCredentials` and none are attached, the adapter returns `badCredentials`; a stored password equal to `expired` does the same, to exercise SEC-002."
- **Argument:** `source_result.status` allows only `returned`, `failed` or `timedOut`, so "change your password" is indistinguishable from "source broken". Missing and expired map to one behaviour though the user action differs. A delegated officer's failing credential cannot be fixed by the trainee. The mock keys on the stored secret, so "expired today" and "old password rejected after change" cannot be modelled. Folded in by the critic: c021 (previously refuted) made the same point from the UX side. The mock is built to produce `badCredentials`, but the persisted status set has only `failed` plus free-text `error`, and nothing in section 6 surfaces that error distinctly or links a failed source to the Credentials settings screen, so SEC-002's credential change is never reached from the failure that should prompt it. Its earlier refutation ("the status set matches the spec's own enum") contradicted this confirmed recommendation.
- **Recommendation:** Add `credentialsMissing` and `credentialsRejected` statuses, `last_verified_at` on `state_credential`, a deep link to the credential editor (or the officer's name) with "retry this source", and a mock credential-state table a seed script can flip.

#### [MAJOR] c062: Auth rate limiting keyed by IP sees only cloudflared's container IP
- **Requirement IDs:** SEC-005
- **Design section:** 5.6, 8
- **Design quote:** "Rate limiting on auth routes."
- **Argument:** Every request arrives from the `cloudflared` service, so an IP-keyed limiter is either global (one attacker locks everyone out) or useless. Better Auth's default in-memory, IP-keyed store also resets on every Watchtower redeploy (reasoning beyond the doc).
- **Recommendation:** Take client IP from `CF-Connecting-IP` (trusted only because cloudflared is the sole ingress and the port is unpublished), key by IP and target account, use database-backed limiter storage, and state thresholds and lockout behaviour with tests.

#### [MAJOR] c063: User deactivation and deletion are undefined for credentials, delegations and append-only audit
- **Requirement IDs:** SEC-021, SEC-003, SEC-010
- **Design section:** 5.5, 5.6, 5.7
- **Design quote:** "Append-only: no UPDATE or DELETE statements exist in code, and SQLite triggers `RAISE(ABORT)` on both"
- **Argument:** A departing officer's delegations keep resolving for up to 8 hours and their `state_credential` rows remain. Better Auth user deletion either aborts on the audit trigger (with a cascading foreign key) or orphans audit rows (without one); neither is chosen. Audit rows are personal data, so SEC-021 needs a stated retention basis.
- **Recommendation:** Give `audit_event` no foreign key to `user` and a display-name snapshot. On disable or delete, in one transaction, revoke delegations, delete credentials, revoke sessions and write audit events. State the audit retention basis and map SEC-021 in section 13.

#### [MAJOR] c007: MFA is opt-in per user only; SEC-005's site-level requirement is not met
- **Requirement IDs:** SEC-005
- **Design section:** 5.6, 12 (M3)
- **Design quote:** "TOTP MFA through the Better Auth two-factor plugin is Phase 2 (SEC-005), opt-in per user."
- **Argument:** SEC-005 says MFA shall be supported "where required by the site or remote system", which implies site-mandated enforcement. `SiteConfig` has no such flag, so a site cannot require MFA. The section 2 non-goal excludes MFA beyond TOTP, not site-level enforcement.
- **Recommendation:** Add a site-level (or per-role) `mfaRequired` flag to `SiteConfig` in 4.1, enforce it in auth middleware in 5.6, and update section 13.

#### [MAJOR] c032: Session lifetime and idle timeout are unspecified and not carried as a TBD
- **Requirement IDs:** none cited
- **Design section:** 5.6, 11
- **Design quote:** None (absent).
- **Argument:** 5.6 specifies cookie flags, token storage, roles, hashing and rate limiting but no session or idle timeout, and section 11's decision table omits it. For a public login gate meant to carry into a CJIS-adjacent product, this is a decidable parameter left unstated. One verifier noted Better Auth's defaults would be used absent a decision.
- **Recommendation:** Add an absolute session lifetime and an idle timeout to 5.6, and record the decision in section 11.

#### [MINOR] c034: Documented demo-user passwords are committed to the repository
- **Requirement IDs:** SEC-006
- **Design section:** 5.6
- **Design quote:** "Seeded demo users live in `packages/api/src/seed/users.ts` and are documented in `docs/demo.md`; they are demo accounts on mock data."
- **Argument:** These are the only access control on a public URL, and section 1 says this codebase becomes the real product. Committed working credentials are a habit that carries forward.
- **Recommendation:** Generate demo passwords at seed time from env or randomness (printed once, not committed), or mark `docs/demo.md` as must-rotate before any non-mock deployment.

#### [MINOR] c064: Delegation UI and schema are training-only; SEC-004's broader workflows have no purpose field
- **Requirement IDs:** SEC-004
- **Design section:** 5.7, 13
- **Design quote:** "inside the trainee's session the app opens a \"training officer sign-in\" dialog."
- **Argument:** SEC-004 extends delegation beyond training, but `credential_delegation` has no purpose or type, so an auditor cannot tell kinds apart and eligibility cannot vary by workflow.
- **Recommendation:** Add a config-defined `purpose` (default `training`) to the table and audit events, name the dialog generically, and list purposes with maximum durations in site config.

#### [MINOR] c065: Nothing enforces "never logged" for decrypted credentials in adapters and error paths
- **Requirement IDs:** SEC-006
- **Design section:** 5.4, 5.9
- **Design quote:** "structured logs without secrets or credential values"
- **Argument:** `SourceAdapter.query` receives a plain `Credentials` object; the first real adapter that throws an HTTP error carrying request config serialises the password, and structured loggers serialise whole errors.
- **Recommendation:** Wrap the secret in a `Secret` type whose serialisers redact, with an explicit `.reveal()` at the wire boundary; add logger redact paths and a test that logs an adapter error and asserts the plaintext is absent.

#### [MAJOR] c048: "The old ciphertext is gone" is false for SQLite
- **Requirement IDs:** SEC-002
- **Design section:** 5.7
- **Design quote:** "Change replaces the record and writes `audit_event(credentialsChanged)`; the old ciphertext is gone."
- **Argument:** Without `PRAGMA secure_delete`, old row bytes survive in freelist pages, in the WAL until checkpoint, and in every earlier backup. With no key rotation the same key still decrypts them, so B4's "the old ones are no longer stored" fails at the storage layer.
- **Recommendation:** Enable `secure_delete`, checkpoint with `TRUNCATE` after a credential change, document that backups hold superseded ciphertext and bound their retention, add `key_version`, and test by scanning raw DB and WAL bytes.

### Audit and retention

#### [BLOCKER] c068: An `audit_event` row cannot stand alone
- **Requirement IDs:** SEC-010, SEC-012
- **Design section:** 5.2, 5.5
- **Design quote:** "`audit_event` (id, correlation_id nullable, type, actor_user_id, credential_user_id nullable, at, details JSON). Append-only: no UPDATE or DELETE statements exist in code, and SQLite triggers `RAISE(ABORT)` on both (SEC-013 and the audit rows generally)."
- **Argument:** Query type, subtype and target sources have no column and `details` is not said to carry them. They live only in `query_request`, which step 3 updates ("set `acknowledged_at`") and which has no trigger protection. `actor_user_id` points into Better Auth's editable, deletable `user` table. A9 asks for one audit record holding user, timestamp, query type, sources, ack time and response times; none exists. Plate-only planning changes the source set and the audited set is unstated.
- **Recommendation:** Define a Zod schema per event type for `details`, validated on write. `submitted` carries query type, subtype, selected and dispatched source ids, the plate-only flag, an actor snapshot and a config hash; `acknowledged` carries ack latency; `sourceResponded` carries source, status, latency and credential owner. Make `query_request` insert-once.

#### [BLOCKER] c039: Delete-from-view writes no audit event, yet SEC-013 is claimed as covered
- **Requirement IDs:** SEC-013, FR-062, FR-063
- **Design section:** 5.1, 5.5, 13
- **Design quote:** "`result_visibility` (correlation_id, source_id, user_id, hidden_at). Delete from view inserts here; rows in `source_result` are never deleted (FR-062, FR-063)."
- **Argument:** Submit, acknowledge, source response and credential change each write a named `audit_event`. The hide route only inserts into `result_visibility`. SEC-013 requires the deletion to be recorded in the audit log, and section 13 lists "FR-062, FR-063, SEC-013 | 5.5" as covered.
- **Recommendation:** Write `audit_event(deletedFromView)` alongside the `result_visibility` insert and add the type to 5.5.

#### [MAJOR] c069: Audit append-only rests on triggers that drizzle-kit's table rebuild drops
- **Requirement IDs:** SEC-010, SEC-011, SEC-012, SEC-013, PLT-005
- **Design section:** 5.5, 8, 10
- **Design quote:** "Append-only: no UPDATE or DELETE statements exist in code, and SQLite triggers `RAISE(ABORT)` on both (SEC-013 and the audit rows generally)."
- **Argument:** drizzle-kit does not model triggers, so they live in a hand-written migration. For changes SQLite's ALTER TABLE cannot express, drizzle-kit generates create-copy-drop-rename; DROP TABLE removes the triggers and the copy rewrites every audit row, which the project forbids (reasoning beyond the doc: drizzle-kit and SQLite trigger semantics). The section 10 test runs on a fresh in-memory schema and may never see the real migration chain. Nothing detects tampering by anyone with the `/data` volume.
- **Recommendation:** Make `audit_event` additive-only and fail CI on any migration touching it beyond CREATE, nullable ADD COLUMN or CREATE INDEX. Check trigger presence at startup and refuse to serve if missing. Add a per-row hash chain (HMAC under a separate key) verified by a `scripts/ops/` script, and test the full migration chain against a populated copy.

#### [MAJOR] c070: Most security-relevant and data-access events are never audited
- **Requirement IDs:** SEC-010, SEC-011, SEC-013, SEC-020, PLT-005
- **Design section:** 5.1, 5.5, 5.6, 5.7
- **Design quote:** "Change replaces the record and writes `audit_event(credentialsChanged)`; the old ciphertext is gone."
- **Argument:** The only non-query event named is `credentialsChanged`. Login success and failure, logout, MFA changes, credential create and delete, delegation lifecycle, role grants, config load, result views, replay and admin audit reads are all unaudited. The requirements' platform principles ask for consistent audit of data access, and CJIS-style audit generally expects logon and privilege events (reasoning beyond the doc).
- **Recommendation:** Publish an audit event catalogue in 5.5 with a `details` schema per type, and hook Better Auth lifecycle callbacks for the auth events.

#### [MAJOR] c071: The NFR-004 target covers part of the path, and the transaction boundary is not stated
- **Requirement IDs:** NFR-004, FR-064, SEC-010, SEC-012, SEC-013, NFR-002, NFR-003
- **Design section:** 5.2, 10, 11
- **Design quote:** "Server-side target for this step is 200ms (NFR-004 decision)."
- **Argument:** Step 3's four writes are not declared one transaction, and whether `acknowledged_at` precedes commit is unstated, so a failure can leave a submitted row with no ack or an audited ack the user never received. Step 4 pushes a WebSocket event without saying it follows the audit commit, so a user can see data the audit never recorded. The ack transaction queues behind dispatch writes on SQLite's single writer. NFR-004 says "reach the user" but only server time is budgeted, and nothing measures it.
- **Recommendation:** One transaction for step 3, 202 only after commit; each outcome writes `source_result` and its audit row in one transaction and pushes only after commit; fail closed when an audit write fails. Configure WAL and `busy_timeout`, emit `Server-Timing`, split NFR-004 into a server target and a measured end-to-end target, and add a concurrency test.

#### [MAJOR] c073: Delete-from-view is underspecified
- **Requirement IDs:** FR-062, FR-063, SEC-013, SEC-014
- **Design section:** 5.1, 5.3, 5.5
- **Design quote:** "`GET /api/queries` | Caller's requests, paged, with per-source status, hidden results excluded"
- **Argument:** Only the list route excludes hidden results; the single GET and the 5.3 replay do not, so hidden results reappear after reconnect or on a second device. No `resultHidden` event tells other devices. Who may hide is unstated. FR-062 says "one or more" but the route takes one source. No unique key prevents duplicate rows from a double press. `source_result` has no primary key, so the hide route cannot name one response when nested parts share a source.
- **Recommendation:** Give `source_result` a surrogate `result_id`, key `result_visibility` on (result_id, user_id) with UNIQUE and ON CONFLICT DO NOTHING, audit only real inserts, accept `resultIds[]` in one transaction, owner-only, filter hidden rows on every read path, and emit `resultHidden`.

#### [MAJOR] c075: The admin audit viewer has no audit-of-the-auditor, bounds, indexes, export or path to retained responses
- **Requirement IDs:** FR-063, SEC-010, SEC-013, SEC-021
- **Design section:** 5.1, 5.5, 6.2
- **Design quote:** "`GET /api/audit` | Admin only, filter by user, correlation ID, type, time range"
- **Argument:** An admin check exists, but the admin role has no audited grant path, admin reads of `details` (which may hold names, DOB, plates) are unaudited, and there is no page-size cap, time window or index on an ever-growing table. FR-063 keeps hidden responses "for audit and compliance", yet no route returns them to an auditor, and there is no export. Folded in by the critic: the role-grant half of c067 (previously refuted). No route or script assigns roles, so granting `admin` or `trainingOfficer` means editing the database or re-seeding, with no `roleChanged` audit event (SEC-010, SEC-003). c067's other half, stale role checks through Better Auth's session cookie cache, stays unconfirmed as speculative.
- **Recommendation:** Cursor pagination with a limit and a required time window; indexes on (at), (actor_user_id, at), (correlation_id) and (type, at); `auditViewed` per call; role grants only through an audited script; an audited NDJSON export; and an audited admin route returning results including hidden ones.

#### [MAJOR] c076: Indefinite retention plus append-only storage leaves no lawful erasure or retention path
- **Requirement IDs:** SEC-021, FR-063, SEC-013
- **Design section:** 5.5, 11
- **Design quote:** "Retention of responses deleted from view | Indefinite; a site config knob later"
- **Argument:** `source_result` rows are "never deleted", `audit_event` aborts DELETE, and `details` is free JSON with no rule against query values. Any future retention knob needs a schema change and a trigger drop, which is the immutability hole. The decision covers only hidden responses, not visible ones, `query_request.values` or audit details. GDPR storage limitation and erasure conflict with indefinite, undeletable personal data (reasoning beyond the doc). Unbounded payload growth on a laptop disk is also a disk-full failure mode.
- **Recommendation:** Keep `details` to identifiers and metadata. Make payload columns nullable or crypto-shreddable (per-request data keys), add `retention` to `SiteConfig` now with a purge job under `scripts/ops/` that writes its own audit event, and record the GDPR position in section 11.

#### [MAJOR] c077: Timestamp source, resolution and meaning are unspecified
- **Requirement IDs:** SEC-012, NFR-004
- **Design section:** 5.2, 5.5, 11
- **Design quote:** "Server-side target for this step is 200ms (NFR-004 decision)."
- **Argument:** No timestamp column has a declared type; Drizzle's SQLite `timestamp` mode stores whole seconds (reasoning beyond the doc), so submitted and acknowledged collapse and 200ms cannot be measured. Stamps come from a laptop wall clock that sleeps and NTP-steps, so ordering by `at` can be wrong. `received_at` for `timedOut` rows is undefined, and nothing records when the client received the ack.
- **Recommendation:** Store epoch milliseconds UTC, record durations from a monotonic clock in `details`, order audit rows by an integer sequence, add `timed_out_at`, and record client-observed ack delivery.

#### [MAJOR] c078: Nested sub-queries get no `submitted` audit row
- **Requirement IDs:** SEC-010, FR-042, SEC-014
- **Design section:** 4.6, 5.2
- **Design quote:** "Nested sub-requests run the same way under the same correlation ID."
- **Argument:** Step 3 writes one `submitted` row for the primary. A nested `alsoRun` part is a different query type, sent to different sources, with values the user never typed, and SEC-010 requires every query logged with type, subtype and sources. An auditor cannot see that the nested query ran.
- **Recommendation:** Write one `submitted` row per plan part with query type, subtype, sources, `origin: "alsoRun"`, parent id and the fieldMap applied, and carry `part_id` on every downstream row.

#### [BLOCKER] c047: SEC-006 encryption at rest covers only the credential secret
- **Requirement IDs:** SEC-006, SEC-020, SEC-021
- **Design section:** 5.5, 5.7, 5.9, 8, 13
- **Design quote:** "Secret encrypted with AES-256-GCM, random 12-byte IV per record, key from `CREDENTIAL_KEY` (32 bytes, base64) in the environment, never logged (SEC-006)."
- **Argument:** `query_request.values`, `source_result.payload` and `audit_event.details` are plaintext JSON in a SQLite file on a laptop, and the keys sit in `.env` on the same disk. Section 13 maps SEC-006 to 5.7 and 5.9, neither of which encrypts query data. Backups (c028) would copy the plaintext, and retention is indefinite. Mock data makes the demo harmless; the gap is in the storage architecture the design says it will carry forward.
- **Recommendation:** Encrypt the whole database (libSQL `encryptionKey` or SQLCipher) with a key separate from `CREDENTIAL_KEY`, supplied as a Docker secret and never on the data volume; keep column-level AES-GCM on credentials as a second layer; require encrypted backups; fix the section 13 row; test that opening the file without the key fails.

#### [MAJOR] c028: No backup strategy or WAL/durability configuration for the single-copy audit database
- **Requirement IDs:** SEC-010, SEC-012, NFR-003
- **Design section:** 5.5, 8
- **Design quote:** "SQLite lives on a mounted volume at `/data`."
- **Argument:** No journal mode, `synchronous` pragma or off-box backup is stated. Section 14's laptop risk covers restarts, not disk loss or a power cut. This is the sole copy of tables SEC-010 and SEC-012 require to be complete.
- **Recommendation:** Enable WAL with `synchronous=NORMAL` or `FULL`, and add a scheduled off-box backup script under `scripts/ops/` with stated retention and verification (encrypted, per c047).

#### [MAJOR] c029: Logging redaction covers credentials but not the regulated query values
- **Requirement IDs:** SEC-006
- **Design section:** 5.9
- **Design quote:** "structured logs without secrets or credential values"
- **Argument:** SEC-006 names query data alongside credentials. Plates, names and DOBs can land in request logs and stack traces, outside the protected datastore.
- **Recommendation:** Redact configured field values (driven by the `FieldDef` list) from every log sink, and test that submitted values never appear in captured logs.

#### [MINOR] c045: `audit_event.type` has no defined set of values
- **Requirement IDs:** SEC-010, SEC-011, SEC-012, SEC-013
- **Design section:** 5.5
- **Design quote:** "`audit_event` (id, correlation_id nullable, type, actor_user_id, credential_user_id nullable, at, details JSON)."
- **Argument:** Type values appear only as scattered literals, so call sites can drift and the audit viewer's type filter has no canonical list.
- **Recommendation:** Add an `AuditEventType` union (extended per c070) and reference it at every write.

### Dispatch pipeline and result feed

#### [BLOCKER] c072: An acknowledged request is lost if the process dies before dispatch finishes
- **Requirement IDs:** NFR-003, FR-043, FR-044, SEC-012
- **Design section:** 5.2, 5.5, 5.8, 8
- **Design quote:** "Enqueue dispatch on an in-process queue."
- **Argument:** Step 3 commits and returns 202 before work is queued in memory. No `source_result` exists until an outcome, and the status set drops Appendix B's `pending`. Watchtower restarts on every merge, config edits require a restart, and nothing sweeps at startup, so orphaned requests stay acknowledged forever with no `sourceResponded` row and FR-044's timer dead. Compose's default 10s stop grace equals the default 10s `timeoutMs`, so even graceful stops cut sources mid-flight.
- **Recommendation:** Insert a `pending` `source_result` per planned source (nested parts included) in the step-3 transaction. At startup, mark orphans `interrupted`, audit and push them; do not auto re-dispatch. On SIGTERM, stop accepting submits and drain; set `stop_grace_period` above the maximum `timeoutMs`. Test a kill during dispatch.

#### [BLOCKER] c036: A nested child can share (correlation_id, source_id) with its parent
- **Requirement IDs:** FR-042, SEC-014, SEC-010, FR-062
- **Design section:** 4.6, 5.2, 5.5
- **Design quote:** "All parts of a plan share one correlation ID at the API." / "`query_request` (correlation_id PK, user_id, credential_user_id nullable, query_type, subtype, values JSON, source_ids JSON, submitted_at, acknowledged_at, parent_correlation_id nullable for nested parts)."
- **Argument:** A primary key cannot repeat, so `parent_correlation_id` implies distinct IDs, contradicting 4.6. Under the shared-ID reading, the spec's own nested example (license plus wanted person) hits the same source twice, so the parent's and child's results share a key: one overwrites the other, one hide conceals both, and `sourceResponded` rows cannot be told apart. Children get no `submitted` row, and `GET /api/queries` does not say how parts are listed.
- **Recommendation:** Give each plan part a `part_id` under one correlation ID. Key `source_result` and `result_visibility` on (correlation_id, part_id, source_id), write a `submitted` row per part, nest parts in the list response, and report FR-043 status per part per source.

#### [BLOCKER] c061: The WebSocket upgrade has no Origin check
- **Requirement IDs:** SEC-006, SEC-003, SEC-020
- **Design section:** 5.3, 5.6, 5.9
- **Design quote:** "WebSocket at `/api/ws`, authenticated by session cookie or bearer token on upgrade." / "CORS locked to the deployed origin and localhost"
- **Argument:** Browsers do not apply CORS to WebSocket handshakes. SameSite=Lax counts by registrable domain, so any `*.birchdesignlab.com` page carries the session cookie and can read the victim's result feed (cross-site WebSocket hijacking). Cookie-authenticated POSTs to non-auth routes have no stated CSRF defence. Bearer placement is unstated and a query string would land in tunnel logs. Sockets authenticated only at upgrade keep pushing after logout or revocation.
- **Recommendation:** Reject upgrades whose Origin is not the deployed origin (dev origin in dev only); allow missing Origin only with a bearer token in a header. Bind each socket to its session and close it on revocation or expiry. Use a `__Host-` cookie, add a CSRF token or custom header on state-changing non-auth routes, and test foreign Origin, missing Origin with cookie, and delivery after logout.

#### [MAJOR] c040: The WebSocket replay references a per-user event log with no backing table
- **Requirement IDs:** NFR-003
- **Design section:** 5.3, 5.5
- **Design quote:** "Events: `ack`, `sourceStatus`, `sourceResult`, each carrying a monotonically increasing per-user event id. On reconnect the client sends its last seen id and the server replays from the database."
- **Argument:** No table in 5.5 carries a per-user sequence, and `source_result` has no `user_id`. 6.6 calls replay "the Phase 1 answer to NFR-003", so the claim is unsupported by the schema.
- **Recommendation:** Add an `event_log` table (user_id, seq, correlation_id, event_type, payload reference, created_at) populated with every event, and replay by `user_id, seq > lastSeenId`.

#### [MAJOR] c079: Replay can resend hidden results and full payloads with no bound
- **Requirement IDs:** FR-062, SEC-013, NFR-003, SEC-006
- **Design section:** 5.3, 5.5
- **Design quote:** "On reconnect the client sends its last seen id and the server replays from the database."
- **Argument:** The id is client-controlled, so a fresh install or `lastId=0` replays all history, and nothing filters `result_visibility`, which defeats delete-from-view. Full payloads are re-sent on every flaky reconnect with no size or count cap, and per-event inserts add contention to the single writer.
- **Recommendation:** Events carry references only; payloads come through the ownership- and visibility-checked GET. Cap replay by age and count and send `resync` beyond it, exclude hidden rows server-side, never persist the query cache, and test hide then reconnect with `lastId=0`.

#### [MAJOR] c074: `GET /api/queries/:correlationId` and the hide route define no authorization rule
- **Requirement IDs:** SEC-003, SEC-011, SEC-014, SEC-020, FR-062
- **Design section:** 5.1, 5.2
- **Design quote:** "`GET /api/queries/:correlationId` | One request with results"
- **Argument:** Only the list route says "Caller's requests". Correlation IDs are meant to be shared for troubleshooting (SEC-014) and appear in toasts, logs and the admin viewer, so leakage, not guessing, is the risk. Whether the delegating officer or an admin may read payloads, and whether such reads are audited, is undecided, and hide by a non-owner is undefined.
- **Recommendation:** One shared policy function for every query route and the WebSocket: owner allowed; admin allowed and audited; delegating officer per an explicit rule. Return 404 to non-owners, owner-only hide, state that the correlation ID is not a capability, and add negative tests.

#### [MAJOR] c080: The timeout depends on each adapter honouring AbortSignal
- **Requirement IDs:** FR-044, FR-043, NFR-002, SEC-012
- **Design section:** 5.2, 5.4
- **Design quote:** "call the adapter with an `AbortSignal` that fires at `timeoutMs`."
- **Argument:** An adapter blocked in a socket read can ignore the signal, so `timedOut` is never written and FR-044's notice never arrives. Late results after `timedOut`, parallel versus sequential dispatch, when the clock starts (queue wait is unbounded), concurrency caps and retries are all undefined. Real state systems often cap sessions per credential (reasoning beyond the doc).
- **Recommendation:** The dispatcher owns the deadline with `Promise.race`, then aborts; late settlements are logged, never change status. Status is write-once from `pending`. Dispatch a part's sources in parallel, measure from `acknowledged_at`, add per-source and global concurrency caps, no automatic retries, and test an adapter that ignores the signal.

#### [MAJOR] c081: No idempotency key, so a double press or a retry after a lost 202 duplicates queries
- **Requirement IDs:** NFR-003, FR-064, FR-006, SEC-010
- **Design section:** 5.1, 5.2, 6.4, 6.6
- **Design quote:** "`POST /api/queries` | Submit. Returns 202 `{ correlationId, acknowledgedAt }`"
- **Argument:** Enter and Ctrl+Enter both submit, so a gloved double press sends two. On a flaky link the POST can arrive while the 202 is lost; retrying creates a second correlation ID and, with real adapters, a second query to a state system under the officer's identity. `POST /api/queries` has no rate limit and no cap on total sources per request.
- **Recommendation:** Client `Idempotency-Key` per submit intent with a unique (user_id, key) index returning the original 202; disable submit until the 202 settles; retry with the same key; add a per-user rate limit and a per-request source cap; test that the same key twice yields one request.

#### [MAJOR] c082: The client cannot reliably correlate events with its submission
- **Requirement IDs:** FR-043, FR-064, FR-065, SEC-014
- **Design section:** 5.2, 5.3, 6.5
- **Design quote:** "TanStack Query for server state with the WebSocket feed invalidating and patching the query cache."
- **Argument:** With near-zero mock latency a result event can beat the 202, find no cache entry, and be dropped. The relation between `sourceStatus` and `sourceResult`, the purpose of the `ack` event, and a dedup rule for at-least-once delivery are all undefined, so a replayed `pending` can regress a `returned`.
- **Recommendation:** One `sourceStatus` event type with forward-only status, dedup by event id with a high-water mark, a placeholder cache entry created on WebSocket receipt, the ack toast driven by the 202 alone, and a test with the event delivered before the POST resolves.

#### [MAJOR] c083: The connection indicator trusts WebSocket readyState; reconnect has no backoff
- **Requirement IDs:** NFR-003, FR-065, FR-043
- **Design section:** 6.6, 5.3
- **Design quote:** "A connection indicator reflects WebSocket state. When offline the submit button is disabled with a reason; there is no offline queue in scope."
- **Argument:** Cellular and modem links drop without a FIN, so readyState stays OPEN, the indicator stays green, and hits never arrive. No heartbeat, backoff or jitter is named, so after a redeploy every client reconnects and replays at once against a single writer. Gating submit on WebSocket state is the wrong signal.
- **Recommendation:** App-level heartbeat with stale detection, exponential backoff with jitter, refetch pending requests on reconnect, gate submit on HTTP results, and a Playwright test that blackholes the socket.

#### [MAJOR] c084: Server rules for hidden, unknown and malformed field values are undefined
- **Requirement IDs:** FR-001, FR-005, FR-011, SEC-010
- **Design section:** 3, 4.3, 5.2
- **Design quote:** "The API re-validates with core (never trust the client)" / "Hidden fields are never required and their values are dropped from the submitted payload."
- **Argument:** 5.2 runs `evaluateForm` server-side but never says the persisted and dispatched values are its output rather than the posted body. Generic Zod body validation cannot know per-query-type keys, so hidden-field values and unknown keys can reach `query_request.values`, mock matching and a future adapter. `FieldDef` has no length or charset limits; delimiter and control characters could inject into fixed-field state message formats (reasoning beyond the doc).
- **Recommendation:** Build persisted and dispatched values only from visible `effectiveValue`s, reject unknown keys with 400, never persist the raw body, and add `maxLength`, `pattern` and a default charset to `FieldDef` enforced in core.

#### [MAJOR] c085: `alsoRun` allows recursion and cycles, so nested fan-out has no bound
- **Requirement IDs:** FR-042, NFR-002, BR-001
- **Design section:** 4.1, 4.6
- **Design quote:** "Nested sub-requests come from `QueryType.alsoRun` with `fieldMap` copying values."
- **Argument:** A nested query type may declare its own `alsoRun`. Whether the planner recurses is unstated: if yes, PERSON-to-WANTED-to-PERSON loops; if no, the depth-1 rule is silent and site developers will write chains. Startup validation checks no cycles or fieldMap references.
- **Recommendation:** State exactly one level of nesting, fail config validation when a nested type declares `alsoRun`, validate fieldMap references both ways, and cap children per query type.

#### [MAJOR] c041: Plate-only source selection is inconsistent with the planner's subset rule
- **Requirement IDs:** FR-012
- **Design section:** 4.3, 4.6
- **Design quote:** "the planner selects only sources flagged for plate-only." / "Selected sources must be a subset of the query type's configured sources or the plan is rejected."
- **Argument:** 4.3 has the planner replace the user's selection with plate-only sources; 4.6, which owns `planRequest`, never mentions plate-only and validates against the full source list. The two describe different behaviour for the same call.
- **Recommendation:** Put plate-only handling in 4.6: intersect `selectedSourceIds` with `plateOnly` sources, and state whether a mismatch rejects or narrows.

#### [MAJOR] c042: Nested-query source selection and required-field validation are unspecified
- **Requirement IDs:** FR-042
- **Design section:** 4.6, 5.2
- **Design quote:** "`evaluateForm` and `planRequest` from core. Reject 400 with the core error shape on failure."
- **Argument:** Nested `sourceIds` could come from the parent's selection or the nested type's defaults. `evaluateForm` runs once for the parent, so the nested type's other required fields are never checked; a nested query with missing fields could be sent incomplete, dropped, or fail the whole plan.
- **Recommendation:** Run `evaluateForm` per nested type on mapped values, default nested sources to that type's `selectedByDefault`, and define plan behaviour on nested validation failure.

#### [MINOR] c105: The API does not state that it persists and dispatches only the core-pruned payload
- **Requirement IDs:** SEC-010, FR-001
- **Design section:** 3, 5.2
- **Design quote:** "Hidden fields are never required and their values are dropped from the submitted payload."
- **Argument:** A narrower statement of c084: a modified client can post unknown keys, hidden values or an unconfigured subtype, which would sit in the append-only store and go to sources. Downgraded because `evaluateForm` does run server-side.
- **Recommendation:** In 5.2, reject non-FieldDef keys and use only the pruned object for `query_request.values`, audit details and the adapter request; test with a hidden `plateType` and an unknown key.

### Config, rules and parser

#### [BLOCKER] c038: `$default` is not disambiguated from the mutable `effectiveValue`
- **Requirement IDs:** FR-002, FR-011
- **Design section:** 4.2, 4.3
- **Design quote:** "`{ \"$default\": \"state\" }` resolves to the effective default of that field" / "`setDefault` updates the effective value used by later rules, so order matters and is documented."
- **Argument:** 4.3's only mutable per-evaluation quantity is `effectiveValue`. 4.2 introduces "effective default" without saying whether it is the static configured default or that same value. If the latter, the worked example compares a field to itself and the FR-011 rule never fires. The natural reading is the static default, but the text leaves it open.
- **Recommendation:** State that `$default` resolves to `FieldDef.defaultValue` ?? `defaults[fieldKey]`, frozen before evaluation and unaffected by `setDefault`, and stop using "effective" for two concepts.

#### [BLOCKER] c086: The plate-only predicate is either never true or almost always true
- **Requirement IDs:** FR-012, FR-004, FR-010, FR-041
- **Design section:** 4.3
- **Design quote:** "Plate-only (FR-012): when `allowPlateOnly` and only `plate` is non-empty, required checks are skipped and the planner selects only sources flagged for plate-only."
- **Argument:** FormState holds only effective values and State is pre-populated, so on effective values plate-only is dead code. On raw input it fires on the common A1 path and silently overrides the user's source selection (FR-041). The engine has no raw-versus-effective distinction to implement either, and client and server can disagree on the mode. FR-012's "without displaying other fields" also conflicts with FR-010's initial display.
- **Recommendation:** Add `userValue` to FormState, define plate-only in terms of user values and defaults, expose `FormState.mode`, state that defaulted State is sent, pick one source rule, reconcile FR-010 and FR-012, have the server recompute and reject mismatches, and table-test the A1, State-changed and Year-typed paths.

#### [MAJOR] c087: The effect of `setDefault` on a user-typed value is undefined
- **Requirement IDs:** FR-004, FR-056
- **Design section:** 4.3, 4.4, 6.5
- **Design quote:** "`setDefault` updates the effective value used by later rules, so order matters and is documented."
- **Argument:** If `setDefault` overwrites, each keystroke's re-evaluation clobbers input. If it fills only empties, FormState cannot say which values are defaults. `formatCommand` is fed effective values, so one toggle turns every default into a literal that no longer tracks its rule. Mutually dependent rules writing to the draft can oscillate.
- **Recommendation:** `setDefault` applies only when `userValue` is empty, never writes to the draft, runs in one pass; `formatCommand` serialises user values only; config validation rejects cyclic `setDefault` dependencies; add a typed-value-survives test.

#### [MAJOR] c088: Rule conflict semantics are undefined and the expanded section has no section-level rule
- **Requirement IDs:** FR-008, FR-011, FR-001
- **Design section:** 4.1, 4.3
- **Design quote:** "Apply rules in config order; each rule whose condition holds against current effective values applies its effect"
- **Argument:** Which of a matching `show` and `hide` wins, whether `require` on a never-visible field is an error, and forward references are unstated. `section: "expanded"` is only a label, so an FR-008 custom field that should appear with Plate Type must copy the condition, and copies drift.
- **Recommendation:** Add `sections: [{ key, labelKey, when? }]` to `QueryType`, document last-match-wins per effect, and have config validation reject unreachable `require` and `setDefault` targets.

#### [MAJOR] c089: No per-field validation rules (length, pattern, character set)
- **Requirement IDs:** BR-001
- **Design section:** 4.1, 4.3
- **Design quote:** "FieldDef  { key, labelKey, dataType: \"string\"|\"number\"|\"year\"|\"date\"|\"boolean\"|\"picklist\","
- **Argument:** The requirements' Dynamic Field Management scenario says validation rules adapt by query type and jurisdiction. Plate, VIN and serial accept any string of any length, which a site cannot constrain without code, and a pasted 1 MB value would land in the append-only audit table.
- **Recommendation:** Add `minLength`, `maxLength`, anchored `pattern` and `transform` to `FieldDef`, a conditional constraint effect, a hard cap in the API body schema, and message-keyed violations.

#### [MAJOR] c016: The terminal parser has no escape or quote rule for delimiters inside values
- **Requirement IDs:** FR-052, FR-054, FR-056
- **Design section:** 4.4
- **Design quote:** "Input is `CODE<delim>v1<delim>v2...`. Code match is case-insensitive. Trailing positions may be omitted; empty interior positions take the field's effective default; more positions than defined is an error. Values are trimmed."
- **Argument:** A free-text value (FR-030 description, an FR-008 custom field) containing the site-chosen delimiter splits wrongly, and `formatCommand`/`parseCommand` are claimed to round-trip, so toggling silently corrupts data.
- **Recommendation:** Define an escape rule (or restrict free text to the trailing position) and add a round-trip property test with delimiter-bearing values.

#### [MAJOR] c017: The form/terminal toggle picks a command by query type only and drops subtype
- **Requirement IDs:** FR-052, FR-056
- **Design section:** 4.4
- **Design quote:** "Toggling to terminal uses the first command whose `queryType` matches the selected query type; if none exists the terminal starts empty."
- **Argument:** FR-052 maps commands to query type, subtype and fields, and `CommandDef` has a `subtype`. The toggle ignores it and neither function takes a subtype, so a subtyped form can switch to the wrong command or lose the subtype, contradicting the "values carry over both ways" decision.
- **Recommendation:** Match on (queryType, subtype) and thread subtype through `formatCommand`, `parseCommand` and the draft store.

#### [MAJOR] c091: A conditionally required field with no command position makes the command unsatisfiable
- **Requirement IDs:** FR-011, FR-053, FR-054, FR-055
- **Design section:** 4.4, 4.3
- **Design quote:** "The result is passed through `evaluateForm`, so required-field errors come from the same engine as the form."
- **Argument:** With Appendix B's VEH positions [plate, state, year] and `plateType` required when State is not the default, `VEH.ABC123.OK` always fails and the terminal has no syntax to supply it. Adding a fourth position then lets a user type into a hidden field whose value 4.3 drops silently.
- **Recommendation:** Config validation fails or warns when a reachable required field has no position; return `valueForHiddenField` instead of dropping; optionally add named-field syntax; test `VEH.ABC123.OK`.

#### [MAJOR] c092: No canonicalisation of values; the terminal bypasses FR-031 narrowing
- **Requirement IDs:** FR-031, FR-052, FR-055, BR-001
- **Design section:** 4.2, 4.4
- **Design quote:** "Values are trimmed."
- **Argument:** `VEH.abc123.ok` submits lowercase values, misses the mock scenario, never maps `ok` to the canonical `OK`, and can submit a site-disabled picklist code. Internal whitespace is neither rejected nor collapsed.
- **Recommendation:** Per-dataType canonicalisation in core before rules, on both paths: picklists match enabled codes case-insensitively or fail `notInPicklist`; strings apply the field `transform` and whitespace rules; property-test idempotency.

#### [MAJOR] c093: No command syntax for date, boolean or number fields
- **Requirement IDs:** FR-020, FR-052, FR-054
- **Design section:** 4.4
- **Design quote:** "Input is `CODE<delim>v1<delim>v2...`."
- **Argument:** The spec's NAM example ends in DOB, but no date formats are accepted or emitted, two-digit DOB years would hit the "2000 plus" rule, and `/` or `-` delimiters collide with date separators. Boolean and number syntax are unspecified, so two implementers would ship incompatible parsers.
- **Recommendation:** Add `inputFormats` and `outputFormat` for date fields with a past-only century window for DOB, reject date formats containing the delimiter, define boolean tokens, store ISO, and add NAM table tests.

#### [MAJOR] c094: Per-command delimiter makes code lookup ambiguous; uniqueness and trailing delimiters are undefined
- **Requirement IDs:** FR-051, FR-052, FR-055
- **Design section:** 4.1, 4.4, 7
- **Design quote:** "CommandDef { code, queryType, subtype?, delimiter = \".\", positions: fieldKey[] }"
- **Argument:** The parser cannot split off the code without knowing the command's delimiter. Duplicate codes under case folding and prefix collisions are not rejected. `VEH.ABC123...` returns `tooManyPositions` although every extra value is empty. Section 7 promises a site-level delimiter the schema does not have.
- **Recommendation:** Add a site-level `terminal.delimiter`; if per-command overrides stay, specify longest-code lookup; reject duplicate and colliding codes; ignore trailing empty values.

#### [MAJOR] c095: ParseError cannot explain why, and toggling a failing command loses the draft
- **Requirement IDs:** FR-055, FR-056, NFR-001
- **Design section:** 4.4
- **Design quote:** "ParseError = { kind: \"unknownCommand\", code }"
- **Argument:** One error is returned though several may apply, `reason` is free text rather than a message key, and no error names the position, label or missing default FR-055 asks for. ParseError carries no values, so toggling to form mid-entry (the normal case) loses everything.
- **Recommendation:** Split into a `tokenize` step that always returns parsed values plus validation through `evaluateForm`; every error carries a message key and params; return all errors; use `tokenize` for the toggle; add `emptyInput`, `missingDelimiter` and `valueForHiddenField`.

#### [MAJOR] c096: The claimed lossless round trip does not hold
- **Requirement IDs:** FR-056, FR-008
- **Design section:** 4.4, 6.5, 10
- **Design quote:** "The draft survives toggling because `formatCommand` and `parseCommand` translate it in both directions."
- **Argument:** `formatCommand` serialises only positioned fields, so VIN, `plateType` and custom fields vanish on a round trip; years and defaults are also rewritten. A property test written to the stated claim will fail or be weakened.
- **Recommendation:** Keep the canonical draft as user values in the store; the terminal is a derived view and a parse merges without erasing unpositioned fields; show an "n fields not shown" indicator; state the property precisely.

#### [MAJOR] c097: Zod validates config shape but not references
- **Requirement IDs:** BR-001, NFR-001
- **Design section:** 4.1, 5.8, 7
- **Design quote:** "Invalid config fails startup with the Zod error path."
- **Argument:** Picklist ids, rule and condition field keys, `$default` targets, command positions, source ids, fieldMap keys, quickAccess codes, mapping references, duplicates and labelKeys are unchecked. A typo such as `"sate"` silently makes a field always or never required. The generated JSON Schema cannot express these checks, so editors show green while runtime misbehaves.
- **Recommendation:** Add `validateSiteConfig(config, locales)` with a referential pass and exact JSON paths, run it at startup, in `config:validate` (usable on external files) and per shipped site, and document that the JSON Schema covers shape only.

#### [MAJOR] c098: Site override semantics and the `Picklist` shape are undefined
- **Requirement IDs:** FR-031, BR-001, BR-004
- **Design section:** 4.1, 5.8, 7
- **Design quote:** "`packages/config/sites/example-ok.json`: a second site showing overrides (different default state, narrowed property picklist, extra custom field, different delimiter)."
- **Argument:** `Picklist` is never defined, so Appendix B's `enabled` narrowing is lost. `SITE_CONFIG` names one file, so an override is either a full copy that must be hand-merged on every upgrade or an overlay with undefined merge rules. BR-004's "required configuration changes" cannot be computed.
- **Recommendation:** Define `Picklist { id, values: { code, labelKey, enabled }[] }`; add `extends` with keyed deep-merge and `$remove`; make example-ok.json an overlay; have `config:validate` print the resolved config and a diff for BR-004 notes.

#### [MAJOR] c104: `GET /api/config` strips by denylist, with no auth stated and no config version on submissions
- **Requirement IDs:** SEC-006, SEC-010
- **Design section:** 5.1, 4.1, 5.8
- **Design quote:** "`GET /api/config` | Site config for clients, with `mock` specs and secrets stripped"
- **Argument:** "Secrets" has no schema meaning, so future adapter endpoints and IDs under an untyped `kind` would fail open to browsers. The route is not stated to need a session on an open URL. A client holding a stale config gets unexplained 400s, and audit cannot tell which rule set applied.
- **Recommendation:** A separate `ClientSiteConfig` allowlist schema, typed server-only adapter settings, a required session, and a `configHash` sent on submit (409 on mismatch) and stored on `query_request`.

#### [MINOR] c044: Subtypes are declared but never threaded through the rules engine
- **Requirement IDs:** FR-052, SEC-010
- **Design section:** 4.1, 4.3
- **Design quote:** "`evaluateForm(queryType, siteConfig, values) -> FormState`"
- **Argument:** `QueryType` has `subtypes` and `CommandDef` a `subtype`, but `evaluateForm` takes none and rules are not subtype-scoped. Whether subtype is metadata or selects fields is undecided, while 4.3 claims FR-031 and FR-032 (property-type-driven fields).
- **Recommendation:** State whether subtype is metadata only or a rule input, and if the latter, add it to `evaluateForm` and conditions.

#### [MINOR] c107: FormState cannot drive the "entirely from FormState" form
- **Requirement IDs:** BR-001, UX-004, FR-031
- **Design section:** 4.3, 6.2
- **Design quote:** "Forms render entirely from core's `FormState`; there is no per-query-type UI code (BR-001)."
- **Argument:** Field entries lack labelKey, dataType, filtered picklist options, order, section labels and a user-versus-default flag, so the app must re-read config and reapply narrowing.
- **Recommendation:** Extend FormState fields with those properties and test that disabled picklist codes never appear.

#### [MINOR] c108: Condition grammar gaps
- **Requirement IDs:** FR-002, FR-032
- **Design section:** 4.2
- **Design quote:** "{ field, op: \"eq\"|\"neq\"|\"in\"|\"notIn\", value: Literal | { \"$default\": fieldKey } }"
- **Argument:** `in` and `notIn` take a scalar, there are no ordering operators, and whether conditions see raw or normalised values (for example `26` versus `2026`) is unstated.
- **Recommendation:** Make `in`/`notIn` take arrays, add typed `gt`/`gte`/`lt`/`lte`, evaluate against canonicalised values, and validate literal types at load.

#### [MINOR] c109: Site-wide `defaults` are keyed by bare fieldKey across all query types
- **Requirement IDs:** FR-004
- **Design section:** 4.1
- **Design quote:** "defaults: { [fieldKey]: value }            // site-wide defaults, e.g. state: \"TX\""
- **Argument:** `state` can mean plate state, DL state or jurisdiction, and generic keys like `type` collide. The only escape is per-field defaults, which removes the site-wide benefit.
- **Recommendation:** Allow per-query-type defaults with precedence FieldDef > query type > site, and flag unused defaults in validation.

### Response mapping

#### [BLOCKER] c099: Keyword hits in detail-only or unmapped fields never reach the summary card
- **Requirement IDs:** UX-010, UX-015, FR-060
- **Design section:** 4.5, 6.3
- **Design quote:** "Applied by the app to every rendered text value." / "Condensed result cards showing summary elements only, with detail behind one tap."
- **Argument:** A STOLEN or WANTED flag mapped `view: "detail"` is invisible on a mobile-unit card, a flag in an unmapped path is never shown, and the no-mapping case is unspecified. An officer-safety hit hidden behind a tap or a config gap is the worst failure this module can have (reasoning beyond the doc).
- **Recommendation:** Core computes result severity over every string leaf of the payload, independent of mapping; the card and notification always badge it with text as well as colour; render a generic dump when no mapping matches; add an e2e test at 1024x768.

#### [MAJOR] c010: UX-016's grid layout is never designed despite being claimed
- **Requirement IDs:** UX-016
- **Design section:** 4.5, 13
- **Design quote:** "Covers FR-060, UX-010, UX-011, UX-015, UX-016."
- **Argument:** UX-016 requires at least grid and summary formats. 4.5 defines only `view: "summary"|"detail"|"both"`, which is UX-015's toggle, and nothing in `RenderElement`, `ResponseMapping` or 6.2 expresses a grid.
- **Recommendation:** Add a layout property and describe grid rendering (see c101), or drop UX-016 from the Covers line and track it as a gap.

#### [MAJOR] c101: The path language flattens arrays of records
- **Requirement IDs:** UX-016, FR-060
- **Design section:** 4.5
- **Design quote:** "resolves each `path` (dot path, `[n]` array index, `[*]` joins array values with `\", \"`) into `{ labelKey, value, view, format }`."
- **Argument:** Multi-hit returns are lists of records. `[*]` over objects yields junk, and `warrants[*].offense` and `warrants[*].date` become two unrelated strings, breaking the pairing a grid needs. `RenderElement` is scalar and cannot express rows.
- **Recommendation:** Add a table element kind with columns yielding rows, define `[*].x` as projection, support bracket-quoted keys, and make `RenderElement` a scalar-or-table union.

#### [MAJOR] c100: Response-mapping fallback order is ambiguous and the no-match case unspecified
- **Requirement IDs:** FR-060, UX-012
- **Design section:** 4.5
- **Design quote:** "selects the most specific `ResponseMapping` (queryType plus sourceId plus persona, falling back to `default` persona, then to no sourceId)"
- **Argument:** Whether (queryType, source, default) beats (queryType, any source, persona) is unstated; duplicates are not rejected; an unresolved path could be skipped, empty or an error, and an empty row hides a wrong mapping.
- **Recommendation:** Specify the full precedence ending in a generic dump, reject duplicate keys, omit unresolved elements with a dev diagnostic, and resolve paths against mock payloads in `config:validate`.

#### [MAJOR] c103: The keyword highlighter misfires on negations and echoed input, fails on non-ASCII text, and cannot style by severity
- **Requirement IDs:** UX-010, UX-011, NFR-001
- **Design section:** 4.1, 4.5, 6.3
- **Design quote:** "KeywordStyle { keyword, severity: \"critical\"|\"warning\"|\"info\", style?: { color?, background?, bold? } }"
- **Argument:** Echoed inputs and negations ("NO WANTS", "NOT STOLEN") are marked critical, eroding attention. JS `\b` is ASCII-only. Severity styles live nowhere in config, so UX-011's per-severity styling needs code, and colour-only styles conflict with 6.3.
- **Recommendation:** Add `keywordSeverityStyles` to `SiteConfig`, always render a text or icon marker, a per-element `highlight` flag, per-keyword `except` phrases, Unicode-aware boundaries, and contrast checks at validation.

### UX, personas and keyboard

#### [MAJOR] c014: Global single-key shortcuts have no scoping against focused text inputs
- **Requirement IDs:** FR-030, FR-051, FR-053, FR-006
- **Design section:** 6.4
- **Design quote:** "| `/` | Focus terminal input |"
- **Argument:** The shortcut table scopes only Enter ("in a form field"); `/`, `?` and `Delete` read as global. Free-text values contain `/` and `?`, and a site that picks `/` as its delimiter would have every delimiter keystroke refocus the terminal. The pattern is common, but the design, which is otherwise precise about keyboard behaviour, does not state it.
- **Recommendation:** State that single-character shortcuts are inert while a text input, textarea or the terminal has focus, and reject a delimiter that collides with a single-key shortcut in config validation.

#### [MAJOR] c106: FR-050 "addable to a user layout" is claimed but not designed
- **Requirement IDs:** FR-050, UX-014
- **Design section:** 4.4, 6.2, 13
- **Design quote:** "Covers FR-050 to FR-056."
- **Argument:** 4.4 is a parser, 6.2 is one panel with a toggle, and `user_preference` has no layout model. A dispatcher wanting the terminal beside results has nothing to build against.
- **Recommendation:** Add a minimal pane layout in `user_preference` sharing the draft store, or record the toggle as the M1 interpretation in section 11 and mark FR-050 partial.

#### [MAJOR] c112: Records, Records-only and Mobile Field Reporting hosts have no persona, and the enum is closed
- **Requirement IDs:** BR-002, PLT-006, UX-001, UX-012, BR-001
- **Design section:** 1, 4.1, 6.1
- **Design quote:** "Persona is resolved at startup and re-evaluated on resize: native platform means `mobile`; web with width 1024 or more and a fine pointer means `dispatch`; otherwise `mobileUnit`."
- **Argument:** Persona comes from the device, so a Records clerk on a desktop gets the dispatch layout and mappings. `ResponseMapping.persona` is a closed Zod enum, so adding `records` means editing core, contradicting section 7. Section 1 omits CAD Records.
- **Recommendation:** Take persona from host context first with the device heuristic as fallback, make persona an open key validated against a `personas` list in site config, ship a `records` persona, and list the missing hosts in section 1.

#### [MAJOR] c122: NFR-001 is reduced to labelKeys
- **Requirement IDs:** NFR-001, FR-031
- **Design section:** 4.1, 4.3, 4.4, 5.8, 6.4
- **Design quote:** "Locale strings load from `packages/config/locales/<locale>.json` (NFR-001, `en` only for now)."
- **Argument:** Picklist value labels are not guaranteed, core and API errors carry free text, formats are not locale-aware, locale is site-wide only, delivery of locale files to clients is unstated, and the default shortcuts assume a US layout. Retrofitting message keys later changes a public API.
- **Recommendation:** Define picklist values with labelKeys, make every error `{ messageKey, params }`, use `Intl` formatting, add site `locales` and a per-user locale, serve locale bundles, and define shortcuts by `KeyboardEvent.code`.

#### [MINOR] c009: UX-004 is claimed but no visual treatment is specified (severity corrected by critic)
- **Requirement IDs:** UX-004
- **Design section:** 4.3, 6.2, 13
- **Design quote:** "Covers FR-001 to FR-005, FR-010 to FR-012, FR-031, FR-032, UX-004."
- **Argument:** 4.3 computes a boolean `required`; neither 6.2 nor 6.3 says how required fields look. The tiebreak verifier confirmed the gap and downgraded it from major to minor as a low-risk convention; the verdict table had kept the claimed major, and the critic corrected it.
- **Recommendation:** Add one rule to 6.2 or 6.3 (for example filled label plus asterisk, not colour alone), optionally as a site-configurable style token.

#### [MINOR] c005: UX-003 (mobile auto-fill and predictive text) has no design coverage
- **Requirement IDs:** UX-003
- **Design section:** absent (belongs in 6.7 and 13)
- **Design quote:** None (absent).
- **Argument:** UX-003 is a firm requirement tied to the Person Lookup (Mobile App) use case, yet it is not in 6.7, not a non-goal, and missing from section 13, which lists every other UX ID. Largely platform-default behaviour, hence minor.
- **Recommendation:** Add a note to 6.7 (TextInput `autoComplete`/`textContentType`, optional per-field recent-value cache) and a section 13 row, or list it as a non-goal.

#### [MINOR] c023: Sunlight legibility has no measurable target or verification path
- **Requirement IDs:** none cited
- **Design section:** 6.3
- **Design quote:** "high-contrast theme with no reliance on hover, focus or colour alone"
- **Argument:** Section 2 names sunlight as a Toughbook constraint, but there is no contrast target and Playwright viewport checks cannot assess glare.
- **Recommendation:** Set a numeric contrast target (for example 7:1 body text) and add a manual daylight check to M4.

### Deployment, CI and process

#### [BLOCKER] c025: Sensitive-code review has no enforcement in the repository process
- **Requirement IDs:** SEC-001, SEC-003, SEC-010, SEC-011
- **Design section:** 5.7, 9
- **Design quote:** "This area, audit, and the query pipeline are the sensitive code named in `CLAUDE.md` and are implemented and reviewed on Opus seats." / "squash merge when CI is green, self-merged. No rulesets by decision."
- **Argument:** Nothing requires or records a review before merge, so a change to credentials, delegation or the audit triggers can be self-merged on green CI with no review. That contradicts the stated commitment and the project's own mandate of an Opus critic on sensitive work.
- **Recommendation:** Add a required-review rule or a CI check scoped to the sensitive paths (credentials, delegations, audit, their migrations, the terminal parser, the CI workflow), and drop "no rulesets" for those paths.

#### [BLOCKER] c026: Watchtower auto-pulling `latest` undoes the documented rollback
- **Requirement IDs:** none cited
- **Design section:** 8
- **Design quote:** "`watchtower`: polls GHCR every five minutes, label-scoped to `app`" / "Rolling back is `docker compose pull` of a sha tag."
- **Argument:** `compose.yml` names `:latest`. After a sha rollback, the next poll sees `latest` differs and restores the broken image.
- **Recommendation:** Document the real procedure: stop Watchtower or remove the label, repin `app.image` to the sha, `docker compose up -d app`, and re-enable only after a fixed `latest` ships.

#### [MAJOR] c030: CSP is asserted without checking it against the Expo/react-native-web/NativeWind stack
- **Requirement IDs:** SEC-007
- **Design section:** 5.9
- **Design quote:** "Security headers (CSP, frame-ancestors none, nosniff, referrer policy)"
- **Argument:** React Native Web and NativeWind commonly emit inline styles that a strict CSP blocks (reasoning beyond the doc), and no directives or verification are given, so the baseline is unverified against the stack chosen in section 3. One verifier judged directive choice an implementation task; the tiebreak held that the stack compatibility is a design-level question.
- **Recommendation:** Specify the intended directives (nonce-based `script-src`, whether `style-src 'unsafe-inline'` is needed) and add an M0 or M1 check that the deployed export reports no CSP violations.

#### [MAJOR] c037: "Three form factors from the first working version" contradicts the milestones
- **Requirement IDs:** PLT-006, UX-001
- **Design section:** 2, 12
- **Design quote:** "Three form factors from the first working version: desktop browser (dispatch), vehicle laptop browser (mobile unit), smartphone native (mobile)." / "M4 Mobile: C1, C2. Mobile unit and mobile layouts, Expo Go on a phone, orientation preference, home-screen quick queries."
- **Argument:** Every milestone ends live on the URL, yet M0 to M3 are dispatch-web only, and Appendix A puts C1 in Phase 3.
- **Recommendation:** Relax the constraint to "three form factors by M4", or pull minimal mobile-unit and mobile shells into M0 or M1.

#### [MINOR] c046: M1's "keyboard-only path works" is not backed by CI until M2
- **Requirement IDs:** none cited
- **Design section:** 9, 12, 6.4
- **Design quote:** "Playwright e2e against the export plus a test API (from M2)." / "Keyboard-only path works."
- **Argument:** 6.4 says Playwright verifies keyboard-only completion, but the suite enters CI at M2, so M1's claim rests on manual checking.
- **Recommendation:** Add a keyboard-only Playwright smoke test at M1, or reword the M1 bullet as manually verified.

#### [MINOR] c125: The risk register omits correlated AI authorship and review, bus factor and provenance
- **Requirement IDs:** SEC-020
- **Design section:** 2, 5.7, 14
- **Design quote:** "Solo developer plus agents. Subagent tiering per `CLAUDE.md`."
- **Argument:** The same model family writes and reviews credential, audit and dispatch code and one developer self-merges, so shared blind spots have no independent check before handoff to a company that will certify it. Config schema churn, mock-shape drift and the Expo Go single-SDK constraint are also absent from section 14.
- **Recommendation:** Add these risks with mitigations: an independent human security review before handoff, `docs/threat-model.md`, and a provenance note in the README.

### Architecture and platform

#### [BLOCKER] c110: No embedding path exists
- **Requirement IDs:** BR-002, FR-050, PLT-006, FR-061
- **Design section:** 1, 3, 5.9, 13
- **Design quote:** "with its own API, so a host CAD suite of unknown stack can integrate over HTTP and a JSON config format"
- **Argument:** Over HTTP a host gets only data and config and would have to rebuild the UI, defeating BR-001. `frame-ancestors none` blocks iframes, CORS blocks host origins, CAD Mobile would become two apps, and FR-061 write-back has no channel for host context. Section 13's "standalone add-on" row claims coverage the design does not deliver. One verifier read BR-002 as satisfiable by HTTP plus config and argued major.
- **Recommendation:** Add a host embedding contract: embed routes with configurable `frame-ancestors` and CORS allowlists and a versioned postMessage protocol (or custom elements) for web hosts, and a React Native library package for CAD Mobile, with the Expo app as a demo shell. Fix section 1 and the section 13 row.

#### [MAJOR] c111 (reinstated by critic): A host CAD product cannot hand the module its logged-in user
- **Requirement IDs:** BR-002, PLT-006
- **Design section:** 5.1, 5.6
- **Design quote:** "Better Auth with email plus password."
- **Argument:** Every route and the WebSocket upgrade are authenticated by a Better Auth session cookie or bearer token, and the only way to get one is a Query Module password. A host CAD product has its own logged-in user, but it cannot hand the module that identity: there is no token exchange, SSO or trusted-host assertion. Every dispatcher would therefore need a second Query Module password on top of their CAD login and their state-system credentials. The OpenAPI reference will document routes that no integrating system can authenticate against. This is the identity half of the host-integration gap in c110. Section 1 promises that "a host CAD suite of unknown stack can integrate over HTTP", and no section 2 non-goal covers host integration.
- **Recommendation:** Add an "embedded" auth mode behind `IdentityService` that validates a host-issued JWT (issuer, audience and JWKS URL from deploy config) and maps it to a principal with no local password, record the host identity in audit rows, document the mode in `docs/api.md`, and keep email and password as the standalone demo mode.
- **Critic note:** Both lenses and the tiebreak refuted the original cluster by citing the section 2 non-goal "Shared Platform integration (PLT-001 to PLT-008)". That non-goal covers the finding's secondary claim, service principals for Shared Platform consumers (BR-007, PLT-001), which stays out of scope. It does not cover the primary claim about host CAD products, which is BR-002 and PLT-006 territory that section 1 and section 13 explicitly claim. Reinstated at its claimed major for the host half only.

#### [MAJOR] c102: Site extension points require editing core and rebuilding the image
- **Requirement IDs:** BR-001, BR-004, FR-060, NFR-001
- **Design section:** 4.5, 5.4, 7, 8
- **Design quote:** "Documented extension points, each one file plus one registry line: source adapters (5.4), response formats (4.5), shortcut map (6.4), locales (5.8)." / "Nothing a site needs for BR-001 requires touching `packages/core` or `apps/app`."
- **Argument:** The adapter registry is in `packages/api`, formats are code inside core that runs in the app, and section 8 bakes config into one image, so every site forks and hand-merges upgrades, the cost BR-004 exists to control. Unknown formats silently fall back to text.
- **Recommendation:** Make formats declarative in config, load server-side adapters from a mounted plugin directory against a versioned API, supply config and locales by volume, never rebuild the image per site, and make unknown format names a validation error.

#### [MAJOR] c113: The Expo/react-native-web bet has no decision gate, and "swap costs only `apps/app`" understates the cost
- **Requirement IDs:** UX-001, UX-012, FR-050, FR-006
- **Design section:** 3, 6.4, 6.5, 14
- **Design quote:** "core and API are UI-agnostic, so a swap to a Vite web app costs only `apps/app`."
- **Argument:** `apps/app` holds all client state, the WebSocket client, tests and selectors, so a swap rewrites everything but core and leaves two UI codebases. FlatList virtualisation drops focus during arrow navigation, RN has no table primitive, and no milestone sets pass criteria, so the bet becomes permanent by default.
- **Recommendation:** Extract `packages/client` now and add an end-of-M1 gate with measurable criteria (keyboard flows, focus retention over 200 rows, bundle and interactivity budgets) that triggers a DOM web app on failure.

#### [MAJOR] c114: Client/server version skew and config schema evolution are unhandled
- **Requirement IDs:** BR-004, PLT-007, BR-001
- **Design section:** 3, 4.1, 5.1, 5.8
- **Design quote:** "Core is shared by app and API, so the same rules engine that drives the form also guards the API."
- **Argument:** Each client embeds its own core; a new enum value in config breaks an older client's strict parse, and native clients cannot be forced to update. `version: 1` has no migration path and invalid config fails startup. No API versioning or minimum-client check exists. One verifier noted the single-deployment prototype softens the impact.
- **Recommendation:** Version the API, return schema, core and config hashes, reject stale submits with 409, add a minimum client version, parse forward-tolerantly, and add `migrateConfig` functions with a `config:migrate` command.

#### [MAJOR] c115: Client-side handling of regulated data is unspecified
- **Requirement IDs:** SEC-006, NFR-003
- **Design section:** 6.5, 6.6, 5.9
- **Design quote:** "TanStack Query for server state with the WebSocket feed invalidating and patching the query cache."
- **Argument:** Without `no-store`, browsers may cache payloads on a shared Toughbook. Nothing forbids a persister or unencrypted AsyncStorage, and nothing clears the cache and drafts on logout or 401, so the next user on a shared console can see prior results.
- **Recommendation:** No query data in persistent client storage, `Cache-Control: no-store` on `/api`, cache and store reset on logout, 401 or user change, SecureStore for the token only, and an explicit decision on an app-shell service worker.

#### [MAJOR] c116: The "cheap Postgres move" and scale-out claims do not hold
- **Requirement IDs:** NFR-002, NFR-003
- **Design section:** 5.3, 5.5, 14
- **Design quote:** "Drizzle keeps a Postgres move cheap if volume ever demands it."
- **Argument:** Drizzle schemas are per dialect, the triggers are SQLite-specific, and JSON and timestamp types change. The replay cursor depends on a single writer (concurrent commits make sequence ids arrive out of order), and the in-process queue and EventBus fail with a second replica.
- **Recommendation:** Either declare single-node a hard limit with an NFR-002 ceiling and drop "cheap", or design for the move now (commit-ordered outbox, external pub/sub, a DB-backed queue, API tests on Postgres).

#### [MINOR] c117: Platform seam interfaces are named but never specified, and the audit write bypasses them
- **Requirement IDs:** PLT-003, PLT-004, PLT-005, PLT-007, PLT-008
- **Design section:** 5.2, 5.5, 13
- **Design quote:** "`AuditService`, `IdentityService`, `EntityStore` and `EventBus` are interfaces per Appendix B with local implementations, so Shared Platform services can replace them"
- **Argument:** No signatures, schemas or failure contracts exist, and 5.2 writes audit rows directly rather than through `AuditService`. Downgraded because the Shared Platform migration is deferred, but the claimed seam does not exist in the described flow.
- **Recommendation:** Specify each interface in 5.5 (with a transactional outbox for `AuditService.record`), route existing code through them, and ship a shared contract-test suite.

#### [MINOR] c124: Background notifications via Expo push carry no constraint on regulated content
- **Requirement IDs:** FR-065, SEC-006, SEC-020
- **Design section:** 6.7, 11
- **Design quote:** "Expo push notifications are the intended mechanism for FR-065 in the background; not built in Phase 1."
- **Argument:** Expo push relays through Expo, APNs and FCM and can render on the lock screen, so "ABC123: STOLEN" would leave the system through three third parties (reasoning beyond the doc).
- **Recommendation:** Record a rule now that push payloads carry only an opaque ID and generic text, with content fetched after unlock.

### Testing strategy and release sequencing (extra round)

#### [MAJOR] x1: Appendix A Given/When/Then criteria are not mapped to tests, and milestone exits are "live on the URL"
- **Requirement IDs:** A1, A3, A5, A6, A8, A9, B1 to B5, C1, C2, SEC-010, SEC-011, SEC-012, SEC-013
- **Design section:** 10, 12, 13
- **Design quote:** "Each milestone ends live on the URL." / "Playwright on the web export for login, plate query with conditional fields, terminal query, keyboard-only completion, highlighting, delete from view, and the three Toughbook viewports."
- **Argument:** Section 13 maps requirements to design sections, not to tests, and deployment is section 12's only exit criterion. A1's negative assertion (only Plate, State, Year and VIN shown) is not named. A3, A5, A6 and A8 have no named test. A9 has no test asserting the audit row's fields; the only audit test is the trigger test. B1 to B4 have no named test at any layer. B5's Playwright test covers "leave my view" only, not "stay in the database" or "audited", which is why c039 went unnoticed. C1's persisted orientation and all of C2 are untested. The "one describe per requirement ID" convention covers core only, not the API or app layers where A6, A9 and B1 to B5 live.
- **Recommendation:** Add an acceptance-test matrix to section 10, one row per story (A1 to A9, B1 to B5, C1, C2) with its Given/When/Then, test file, layer and milestone. Tag tests with the story ID and fail CI when a story in a shipped milestone has no tagged test. Make each milestone's exit "every story has a green tagged acceptance test" plus a smoke run against the live URL. Write A9, B3 and B5 as API tests that read `audit_event` and assert each field.

#### [MAJOR] x3: No security negative tests for authorization, admin-only audit, WebSocket auth, credential non-disclosure or delegation failures
- **Requirement IDs:** SEC-003, SEC-006, SEC-010, SEC-011, SEC-013
- **Design section:** 10, 5.1, 5.3, 5.6, 5.7, 5.9
- **Design quote:** "Audit immutability has a test that attempts UPDATE and DELETE and expects the trigger abort."
- **Argument:** That is section 10's only security test. The design makes testable security claims with no test: `GET /api/audit` is admin only; the WebSocket is authenticated on upgrade; auth routes are rate limited; the credential key and values are never logged; expired delegations are ignored; either user can revoke. Nothing checks cross-user access to `/api/queries/:correlationId` or the hide route (the defect is c074; here the point is that no test would catch it), that credential GETs never return the secret (c059), or that a wrong officer password creates no delegation. TDD tests the behaviour a task specifies, and negative security properties are rarely in a task's spec unless the test plan names them.
- **Recommendation:** Add a "Security tests (API)" bullet to section 10, required from the milestone that introduces each route: a route by caller matrix (401 unauthenticated, 404 for another user's correlation ID, 403 for non-admin audit); WebSocket upgrades with no session, an expired session or a foreign Origin rejected, with no events crossing users; credential responses never containing secret or ciphertext; a log-capture test for secrets and `CREDENTIAL_KEY`; wrong-password, expired and revoked delegation cases with their audit rows; and the auth rate limit.

#### [MAJOR] x4: The native mobile persona has no automated verification at M4
- **Requirement IDs:** C1, C2, FR-070, UX-001, UX-002, SEC-006
- **Design section:** 9, 10, 12, 14, 5.6, 6.7
- **Design quote:** "Better Auth's Expo plugin is younger than its web path; native auth is exercised at M4, with a fallback to a plain bearer session if it misbehaves." / "4. Expo web export."
- **Argument:** CI builds only the web export, Playwright runs only against it, and RNTL is component-level. Native-only code (`.native.tsx` files, secure-store token storage, bearer auth on the WebSocket upgrade, the "native platform means mobile" branch of 6.1) never runs in CI. Section 14 calls the Expo plugin risky, yet "exercised at M4" has no method, and "if it misbehaves" has no test to detect misbehaviour. C2 has no test at any layer, and M4's "Expo Go on a phone" is a manual demo. Tools such as Maestro can drive Expo Go, and `expo export --platform android` catches native bundle breakage cheaply (reasoning beyond the doc).
- **Recommendation:** Add `expo export --platform ios,android` to CI from M0, API tests for bearer auth on REST and the WebSocket upgrade from M2, a Maestro flow or a written manual test script for M4 with results recorded per release, and a concrete fallback trigger for the Expo plugin (for example "token not restored after cold start").

#### [MAJOR] x5: Contract tests are largely tautological, and the WebSocket event contract has no schema or test
- **Requirement IDs:** BR-007, FR-064, SEC-014
- **Design section:** 5.1, 5.3, 10
- **Design quote:** "Every body and query string is validated with Zod; OpenAPI is generated from the same schemas" / "Contract tests assert the OpenAPI document matches route behaviour."
- **Argument:** Request validation and the OpenAPI document come from one Zod object, so on the request side the contract test cannot fail. The informative checks are unstated: whether actual responses (the 202, the core error shape, bodies) are validated against declared response schemas, which Hono's zod-openapi does not do by default (reasoning beyond the doc); whether the published contract changed in a breaking way between releases; and the `ack`, `sourceStatus` and `sourceResult` WebSocket events, which are the result channel an integrator consumes but sit outside OpenAPI with no schema or test.
- **Recommendation:** Validate every response against its route's response schema in tests, commit the generated `openapi.json` and fail CI on an unreviewed diff (or run a breaking-change diff against `main`), and define, publish and test Zod schemas for every WebSocket event.

#### [MAJOR] x6: "Every merge ships" with no feature flags puts half-built delegation, credential and migration work on the public URL
- **Requirement IDs:** SEC-001, SEC-002, SEC-003, SEC-010, SEC-011
- **Design section:** 9, 12, 8, 5.5
- **Design quote:** "Trunk-based: short-lived `feat/`, `fix/`, `docs/` branches, one PR each, squash merge when CI is green, self-merged. No rulesets by decision. `main` is always deployable because every merge ships."
- **Argument:** No mechanism keeps incomplete work dark. M3 alone spans delegation, credential change, nested dispatch, delete-from-view and TOTP, which is many PRs. A natural first PR adds `POST /api/delegations` and credential resolution, and a later one adds the SEC-011 dual-identity audit. Each goes live within five minutes through Watchtower, and migrations applied at process start make each intermediate schema permanent, which for the append-only `audit_event` cannot be cleanly undone. "Always deployable because every merge ships" is circular, and "Each milestone ends live on the URL" is an empty exit criterion when every intermediate state is already live.
- **Recommendation:** Add a flag mechanism (a `features` block in site config or an env var) that returns 404 and hides the UI for unfinished capabilities, require sensitive features to merge dark until their acceptance tests (x1) pass, adopt expand-then-contract migrations with no removal or rename of `audit_event` columns, and cut a release tag per milestone (consider pointing Watchtower at a tag rather than every `main` commit).

#### [MAJOR] x7: CI never runs the image it ships
- **Requirement IDs:** SEC-010, SEC-013
- **Design section:** 9, 8, 5.5
- **Design quote:** "6. Docker build. On `main`, log in to GHCR and push `latest` and the commit sha." / "5. Playwright e2e against the export plus a test API (from M2)."
- **Argument:** Playwright runs against the export and a test API, not the production image. Nothing starts the container, applies the migration chain as production does, checks `/api/health`, or confirms the audit triggers exist before `latest` is pushed and Watchtower deploys it. Image-specific failures (the multi-stage copy, the non-root user's permissions on `/data`, a missing locale or site file, native modules on `node:22-alpine`) go straight to production; `@libsql/client` ships platform-specific native bindings, and musl mismatches are a known failure class (reasoning beyond the doc). This differs from c069 (table-rebuild semantics) and c026 (rollback).
- **Recommendation:** Before pushing to GHCR, run the built image with a temp volume, wait for `/api/health`, run a short Playwright smoke (login, plate query, ack), and check that the audit triggers exist; push only on success. Run the same smoke after each Watchtower deploy from a `scripts/ops/` probe and name it in each milestone's exit.

#### [MAJOR] x9: NFR-003's reconnect replay and the multi-source and nested behaviour claimed for NFR-002 are exercised by no test
- **Requirement IDs:** NFR-002, NFR-003, FR-042, FR-043, FR-044
- **Design section:** 10, 5.3, 6.6, 13
- **Design quote:** "On reconnect the client sends its last seen id and the server replays from the database. This gives at-least-once delivery over intermittent links without an external broker."
- **Argument:** Section 10 names no test for a WebSocket drop and replay from the last seen id, for missed events arriving exactly once after dedup, for the offline-disabled submit (6.6), for a per-source timeout while a sibling returns (B1), for a nested part (B2), or for concurrent submissions. Intermittent connectivity is the Toughbook's defining constraint, and the replay cursor logic runs on both client and server. NFR-004 measurement is c071 and is not repeated here.
- **Recommendation:** Add API tests that close the socket mid-dispatch and assert exactly the missed events on reconnect, a Playwright test using `context.setOffline`, dispatch tests with fake timers for per-source timeout and nested parts, and a small concurrency test asserting every submission gets its audit rows and ack.

#### [MINOR] x10: Coverage thresholds exclude `apps/app` and measure line execution, not assertions on audit and credential fields
- **Requirement IDs:** SEC-010, SEC-011, SEC-006
- **Design section:** 9, 10
- **Design quote:** "`vitest run --coverage` with thresholds (core 95% lines and branches, API 85%)."
- **Argument:** No threshold covers `apps/app`, which holds persona resolution, the keyboard model, draft carry-over, cache patching and the replay cursor client. On the API side a happy-path submit test executes the audit insert without asserting its contents, so 85% can be met while SEC-010 and SEC-011 fields go unchecked, and one API-wide number lets boilerplate mask low coverage in the credential and audit modules.
- **Recommendation:** Per-directory thresholds (100% branches for audit, credentials and delegation; a stated floor for `apps/app` logic), assertion-level tests that read each audit type's row and check every SEC-010, SEC-011 and SEC-012 field, and optional nightly mutation testing on those modules.

#### [MINOR] x11: M0's WebSocket-through-tunnel check has no WebSocket to verify
- **Requirement IDs:** FR-064, FR-065, NFR-003
- **Design section:** 14, 12, 5.1
- **Design quote:** "WebSocket through Cloudflare Tunnel is supported but must be verified at M0 with the health page."
- **Argument:** `GET /api/health` is plain HTTP liveness, and `WS /api/ws` is an M2 deliverable, so the M0 check proves only that HTTP passes the tunnel and the risk stays open until the result feed is built on it. Cloudflare closes idle WebSockets after a timeout, so a heartbeat interval is a tunnel-dependent parameter worth pinning early (reasoning beyond the doc).
- **Recommendation:** Add a minimal authenticated `/api/ws` heartbeat endpoint and a health page that exercises it through the tunnel at M0, with a "WS stays open for 10 minutes with heartbeats" exit check.

### Mock data and fixtures (extra round)

#### [MAJOR] x12: Nothing makes canned payloads unmistakably fictitious, and the seeded STOLEN hit uses a real-format plate
- **Requirement IDs:** none cited (Appendix A scope statement and the CLAUDE.md fixture rule)
- **Design section:** 1, 5.4, 3 (`scripts/`), 4.1 (`config:validate`)
- **Design quote:** "Fixtures must not resemble real person, vehicle or property records." / "Examples seeded for the default site: plate `ABC123` returns a STOLEN hit, plate `TIMEOUT` never responds, plate `FAIL1` errors, a person with last name `WANTED` returns a WANTED hit."
- **Argument:** Section 1 restates the CLAUDE.md rule but nothing implements it. Mock `default` and `respond` payloads are hand-written inline in site JSON, no convention says how names, DOBs, addresses, VINs, plates or serials are made fictitious, `config:validate` checks shape only, and no generator exists under `scripts/mock-data/`, which CLAUDE.md names for this. `ABC123` is a plausible plate format; the design pairs it with the site default TX and makes it return STOLEN, while the spec uses ABC123 only as terminal input (A4, FR-054). The WANTED person payload will need a first name, DOB and address, left to whoever writes the JSON. Whether ABC123 is a live TX registration is not established; the format is what the rule forbids (reasoning beyond the doc).
- **Recommendation:** Add a fixture policy to 5.4 and `docs/site-config.md` (reserved or impossible plate and serial formats, VINs that fail the ISO 3779 check digit, impossible DOBs, a fictitious street corpus, obviously synthetic names), generate payloads with a committed `scripts/mock-data/` generator, have `config:validate` reject violations, and keep ABC123 for A4 parsing with a clean no-record result while moving the STOLEN hit to a reserved-format plate.

#### [MAJOR] x14: MockSpec has no query-type dimension, so a shared source returns the same default and scenario hits for every query type
- **Requirement IDs:** FR-042, FR-060, FR-040, FR-043
- **Design section:** 5.4, 4.6, 4.1
- **Design quote:** "MockSpec { latencyMs: [min, max], default: SourcePayload, scenarios: { when: { [field]: value }, respond?: SourcePayload, behavior?: \"timeout\"|\"error\"|\"badCredentials\" }[] }" / "Scenarios match on submitted values, first match wins."
- **Argument:** MockSpec is attached to `Source`, while sources are shared across query types. `when` matches only field values, and `default` is one payload per source, so a state source serving VEH, PERSON and the nested WANTED check returns one shape for all of them, which maps to nothing under the other query types' ResponseMappings. For B2, a `lastName: WANTED` scenario matches both the person query and the nested wanted query, so both parts return the same payload, and "submitted values" is undefined for nested parts. For B1, the design does not say whether `TIMEOUT` is seeded on one source or all; on all, B1 cannot be demonstrated.
- **Recommendation:** Key mock behaviour by (sourceId, queryType[, subtype]), either through `MockSpec.byQueryType` or `queryType` in `when`; define that nested parts match on their mapped values under the nested type; state that TIMEOUT is seeded on exactly one of two sources; and have `config:validate` check that every (queryType, source) pair has a mock default whose paths resolve against its ResponseMapping.

#### [MINOR] x13: `kind` defaults to "mock" and nothing forbids the mock adapter outside a demo
- **Requirement IDs:** FR-043, SEC-010
- **Design section:** 4.1, 5.4, 5.5, 5.8
- **Design quote:** "Source { id, name, scope: \"state\"|\"national\"|\"local\", timeoutMs = 10000, requiresCredentials: boolean, kind: string = \"mock\", mock?: MockSpec }"
- **Argument:** Section 1 says this code becomes the real product's foundation, and a real adapter is a new file plus a registry line. From then on, a source definition that omits `kind` fails open to MockSourceAdapter, and `mock` is optional. No startup check ties the environment to allowed adapter kinds, and `source_result` and `audit_event` do not record which adapter produced a payload, so a canned result is indistinguishable from a real one after the fact. In the real product, a canned "no record" for a stolen vehicle is an officer-safety failure (reasoning beyond the doc).
- **Recommendation:** Make `kind` required with no default and validate it against the adapter registry at startup, require `mock` if and only if `kind` is "mock", gate mock sources behind an explicit env flag set only in dev, CI and the demo, record `adapter_kind` on `source_result` and in `sourceResponded` details, and test that a config with no `kind` fails to load.
- **Severity:** The tiebreak confirmed the textual reading but held that no real adapter exists in this phase, which "nudges it down from major to a minor, forward-looking hardening recommendation". The extra round's verdict table recorded major (the same inheritance bug the critic found on c009 and c012); this report applies the tiebreak's minor.

#### [MINOR] x16: Mock scenarios are embedded in deployable site config, section 3 contradicts that, and example-ok.json's mock behaviour is undefined
- **Requirement IDs:** BR-001
- **Design section:** 3, 5.4, 7, 5.8
- **Design quote:** "`packages/config` | Site config JSON (default site plus one example override site), mock-data scenarios, locale files, generated JSON Schema." / "`MockSourceAdapter` is the only implementation. Behaviour comes from `Source.mock` in config"
- **Argument:** Section 3 lists mock scenarios as a separate artifact, while 5.4 puts them inline in the site config that section 7 hands to site developers and 5.8 loads in production, so every site config carries canned payloads and `GET /api/config` must strip them (c104 covers only the stripping). The design does not say whether example-ok.json defines its own mock blocks or inherits the default's, nor what a mock source with no `mock` block does. With override semantics also undefined (c098), B1 and B2 behaviour under example-ok.json is unspecified.
- **Recommendation:** Move mock scenarios to a separate file keyed by site and source (for example `packages/config/mock/<siteId>.json`), loaded only when mock sources are allowed (x13), keep site configs free of fixtures, state what example-ok.json uses, and make a missing mock spec on a mock source a validation error.

### Accessibility beyond keyboard (extra round)

#### [MAJOR] x18: No accessibility conformance target and no automated or manual accessibility verification
- **Requirement IDs:** none cited (the requirements doc is silent on accessibility)
- **Design section:** 2, 6.3, 6.4, 10, 12
- **Design quote:** "high-contrast theme with no reliance on hover, focus or colour alone" (6.3, mobile unit only)
- **Argument:** The design's only accessibility statements are keyboard operability (6.4) and a colour and hover rule scoped to the Toughbook layout (6.3). Section 10 has no axe scan or screen-reader pass, and no milestone exit mentions assistive technology. Section 1 says the code becomes the real product's foundation, handed to a real company. US public-safety procurement routinely asks for a Section 508 / WCAG 2.1 AA conformance report, and react-native-web emits generic divs unless roles, labels and states are set on purpose (reasoning beyond the doc). Retrofitting semantics into the shared FormState renderer and results list after M2 costs far more than setting the rule before M1.
- **Recommendation:** Add a section 2 constraint (WCAG 2.2 AA for dispatch and mobile-unit web; platform guidelines for native), run `@axe-core/playwright` in every Playwright scenario from M1 and fail CI on serious or critical violations, add an NVDA plus Chrome pass to the M2 and M3 exits and a VoiceOver/TalkBack pass to M4, and add accessibility to section 14 and to any Expo web decision gate (c113).

#### [MAJOR] x19: Asynchronous ack, per-source status, timeout and result events have no assistive-technology announcement or focus policy
- **Requirement IDs:** FR-043, FR-044, FR-064, FR-065
- **Design section:** 5.2, 5.3, 6.2, 6.5
- **Design quote:** "Acknowledgment toast and result notifications." / "TanStack Query for server state with the WebSocket feed invalidating and patching the query cache."
- **Argument:** FR-044, FR-064 and FR-065 require the user to be told of timeouts, the ack and returned results. The design delivers these as a toast and cache patches without saying whether they reach assistive technology or what happens to focus. For a screen-reader user a visual-only toast tells nothing. For the keyboard-first dispatcher who submits and types the next query, a re-render that moves focus onto a result row turns Enter into expand and Delete into delete-from-view (6.4). RN-web list re-renders commonly remount rows, and RN's `accessibilityLiveRegion` is Android-only while iOS needs `AccessibilityInfo.announceForAccessibility` (reasoning beyond the doc). Nothing distinguishes a critical hit from routine traffic, and the mobile "Lookup in Motion" case has no audible or haptic channel.
- **Recommendation:** Add an "Announcements and focus" subsection: one app-level announcer (polite `role=status` for ack, status and timeouts; assertive `role=alert` only for critical keyword severity, using c099's result severity), coalesced per correlation ID, with `announceForAccessibility` on native; incoming events never move focus and results append without remounting the focused row; an optional audible cue per severity for mobile unit; and a Playwright test that types while a result arrives and asserts focus, input value and live-region text.

#### [MAJOR] x20: FR-005 and A3 error identification and A2's dynamically revealed required fields are not designed for display, focus or programmatic association
- **Requirement IDs:** FR-005, FR-006, FR-055, FR-002, UX-004
- **Design section:** 4.3, 4.4, 6.2, 6.6
- **Design quote:** "FormState { fields: { key, visible, required, effectiveValue, section }[], missingRequired: fieldKey[], invalid: { field, reason }[] }" / "Forms render entirely from core's `FormState`" / "When offline the submit button is disabled with a reason"
- **Argument:** Core computes `missingRequired` and `invalid`, but no app section says how they are presented. FR-005 and A3 require each missing field to be identified; the design specifies no visual or programmatic treatment, no association with inputs, no focus move when an Enter-submit (FR-006) is blocked, and no announcement. Terminal ParseErrors (FR-055) have no defined location or association either. A2 inserts a required Plate Type field while the user is on the form, with no indication to a screen-reader user who has tabbed past. A disabled control is typically removed from the tab order, so 6.6's disabled submit hides its reason from keyboard and screen-reader users (reasoning beyond the doc). Distinct from c009 (required indicator) and c095 (ParseError content).
- **Recommendation:** Specify one generic field renderer in 6.2 that labels inputs from labelKey, sets required state from FormState, and on a blocked submit marks invalid fields with described-by messages, moves focus to the first invalid field and announces the count; tie terminal errors to the terminal input; announce rule-revealed fields; keep the offline submit focusable with `aria-disabled` and a visible reason; and add Playwright and axe assertions for A2 and A3.

#### [MAJOR] x21: No semantic mapping for react-native-web output
- **Requirement IDs:** UX-015, UX-016, FR-043, UX-001
- **Design section:** 3 (`apps/app`), 4.5, 6.2
- **Design quote:** "Query panel with query-type selector, form or terminal toggle, source checkboxes, quick-access bar for frequent types (FR-007). Results list with per-source status, summary and detail toggle"
- **Argument:** Every control in 6.2 is a custom composite, since RN has no native checkbox, radio group, select or table and NativeWind only styles. The design never maps them to ARIA or native accessibility roles and states. Unmapped, source checkboxes, the form/terminal toggle, the query-type selector and the UX-015 summary/detail toggle read as unlabelled clickable text with no checked or expanded state, the results list is not a list, per-source status (FR-043) is not tied to its source, and the UX-016 grid (c101) has no headers. The "no per-query-type UI code" rule makes this one high-leverage decision in the generic renderer; react-native-web emits correct ARIA only when role, state and label props are passed explicitly (reasoning beyond the doc).
- **Recommendation:** Add a semantics table to 6.2 (selector as radiogroup or listbox, checkboxes with role and checked state, toggle as switch or tablist, summary/detail as a button with expanded state, each result card a region headed by source and status, RenderElements as label/value pairs, the grid as a table with column headers), expose every labelKey as the accessible label of its value, and build these as shared primitives in `apps/app`.

#### [MINOR] x22: Width-based persona re-evaluation makes browser zoom silently swap layout, response mapping and possibly the keyboard model
- **Requirement IDs:** UX-001, UX-012, UX-013, UX-014
- **Design section:** 6.1, 6.3, 6.4
- **Design quote:** "Persona is resolved at startup and re-evaluated on resize: native platform means `mobile`; web with width 1024 or more and a fine pointer means `dispatch`; otherwise `mobileUnit`."
- **Argument:** Browser zoom shrinks the CSS viewport, so a dispatcher on a 1920px console at 200% zoom has 960 CSS px and is re-evaluated to `mobileUnit` mid-session, getting summary-only cards with a different field set. 6.4's keyboard map is scoped to dispatch with no statement that it applies elsewhere, and the design does not say whether an explicit persona override suppresses re-evaluation. "800x600 must still work with scrolling" tolerates two-dimensional scrolling, while WCAG 1.4.10 and 1.4.4 expect reflow at 320 CSS px and survival at 200% text size, in tension with UX-013's no-wrap goal (reasoning beyond the doc).
- **Recommendation:** Resolve persona from device and pointer characteristics plus the stored override, not width alone; state that an explicit override disables re-evaluation and that the 6.4 map applies in every web persona; set a 200% zoom and 320 CSS px reflow target with result grids scrolling in their own container; and add a Playwright case at 1920x1080 and 200% zoom.

#### [MINOR] x23: Native mobile persona: screen readers, OS font scaling and the touch delete-from-view path are not designed, and M4 has no accessibility exit
- **Requirement IDs:** FR-062, FR-070, UX-002, UX-012
- **Design section:** 6.2, 6.3, 6.4, 6.7, 12 (M4)
- **Design quote:** "`Delete` on a result | Delete from view, with confirm" / "M4 Mobile: C1, C2. Mobile unit and mobile layouts, Expo Go on a phone, orientation preference, home-screen quick queries."
- **Argument:** Delete from view (FR-062) is specified only as a keyboard action; the touch interaction and its confirmation are undefined, and a swipe-only gesture is unreachable with VoiceOver or TalkBack unless exposed as a custom accessibility action (reasoning beyond the doc). The 48px and 16px minimums are CSS px for web; on native, text scales with the OS setting, so fixed 48px quick-query tiles (C2) clip at large sizes. Native toast, notification and confirm-dialog behaviour under a screen reader, and reduced motion, are unstated, and M4's exit covers layout and Expo Go only.
- **Recommendation:** Specify delete-from-view as a visible labelled button or menu item (swipe optional, exposed through accessibility actions) with a focus-correct confirm dialog, honour OS font scaling up to a stated multiplier with targets that grow rather than clip, respect reduced-motion settings, and add a VoiceOver and TalkBack pass at the largest text size to the M4 exit.

#### [MINOR] x24: The acknowledgment toast's lifetime is undefined, and the correlation ID has no persistent location
- **Requirement IDs:** FR-064, SEC-014
- **Design section:** 5.1, 6.2
- **Design quote:** "Acknowledgment toast and result notifications." / "`POST /api/queries` | Submit. Returns 202 `{ correlationId, acknowledgedAt }`"
- **Argument:** A6 requires an ack with a correlation ID, and SEC-014 makes that ID the troubleshooting key, but the only UI surface named is a toast whose lifetime, pause and recall behaviour are unstated, and the results list is not said to show the ID or ack time. WCAG 2.2.1 and 2.2.2 apply to auto-dismissing content that carries information, and screen-reader, low-vision and gloved users routinely miss a 3 to 5 second toast (reasoning beyond the doc).
- **Recommendation:** State that the toast is supplementary: show the correlation ID and ack time, copyable, on each request's entry in the results list, and have the toast persist until dismissed or stay at least 10 seconds and pause on hover or focus, announced through x19's polite announcer.

### Traceability and coverage

#### [MINOR] c012: Phase 2 items B6 and B7 are pushed past Phase 3 work without justification (severity corrected by critic)
- **Requirement IDs:** FR-061, FR-030, FR-031, FR-032
- **Design section:** 12
- **Design quote:** "Later: B6 supplemental write-back, B7 property picklist, C3 to C6."
- **Argument:** Appendix A puts B6 and B7 in Phase 2 with B1 to B5, which the design schedules in M3, but B6 and B7 land in an undated bucket after M4's Phase 3 work. Section 4.3 and 13 claim FR-031 and FR-032 from M1, while the backlog item that ships the narrowed picklist has no milestone. The reorder is visible in the list but unexplained. The tiebreak verifier held that it "survives as a real but minor documentation finding" and called blocker overinflated; the verdict table had kept the claimed blocker, and the critic corrected it.
- **Recommendation:** Move B6 and B7 into M3, or add a one-line rationale in section 12 for the reorder.

#### [MAJOR] c001: Four Business requirements are never mentioned and not listed as non-goals
- **Requirement IDs:** BR-003, BR-004, BR-005, BR-006
- **Design section:** absent (belongs in 1, 2 or 9)
- **Design quote:** None (absent).
- **Argument:** Section 13 maps only BR-001, BR-002 and BR-007. Licensing model (BR-003), upgrade communication (BR-004), documentation refresh (BR-005) and open-source policy review (BR-006) appear nowhere, while section 3 adopts a large dependency surface.
- **Recommendation:** State the licensing approach, add a release-communication step and a product-doc refresh to the process, and add an open-source license check before new runtime dependencies, or list each as a non-goal.

#### [MAJOR] c002: No CJIS or GDPR compliance position is recorded
- **Requirement IDs:** SEC-020, SEC-021, SEC-022
- **Design section:** 11, 13
- **Design quote:** "EU Cyber Resilience Act | Stays TBD; not a prototype concern"
- **Argument:** SEC-022 gets a disposition in section 11; SEC-020 and SEC-021 get none, and none of the three appear in section 13. Section 1's "never holds real CJIS data" scopes the prototype's data but is not a compliance position, and says nothing about GDPR.
- **Recommendation:** Add SEC-020 and SEC-021 to section 11 with the same treatment as SEC-022, add all three to section 13, and reference the gap from section 14.

#### [MAJOR] c011: NFR-002's volume clause is claimed as covered but contradicted by the single-writer design
- **Requirement IDs:** NFR-002
- **Design section:** 5.2, 13, 14
- **Design quote:** "SQLite is single-writer; fine for a prototype, and Drizzle keeps Postgres available."
- **Argument:** Section 13 maps NFR-002 to 5.2, which covers multi-source and nested dispatch but not "high transaction volumes", and section 14 admits the single-writer limit. See c116 for the mechanisms.
- **Recommendation:** Split the row: multi-source and nested covered by 5.2; volume marked prototype-scale only and cross-referenced to section 14.

#### [MINOR] c006: FR-071 is never cited, though its partner FR-065 is
- **Requirement IDs:** FR-071
- **Design section:** 6.7, 11, 13
- **Design quote:** "Background lookup launch | Stays TBD, Phase 3; Expo push notification action is the leading option"
- **Argument:** Section 11's row covers FR-071's substance, but the ID appears nowhere, including section 13, while FR-065 is traced repeatedly.
- **Recommendation:** Cite FR-071 in that section 11 row, in 6.7 beside FR-065, and in section 13.

#### [MINOR] c015 (reinstated by critic): Section 13 claims FR-065 through 5.2 and 5.3, but the background half is not built
- **Requirement IDs:** FR-065
- **Design section:** 13, 6.7
- **Design quote:** "Expo push notifications are the intended mechanism for FR-065 in the background; not built in Phase 1."
- **Argument:** FR-065 requires notifying the user "including when the mobile app is in the background", and that clause is not TBD in the requirements (only FR-071's launch mechanism is). Section 13 lists "FR-064, FR-065, SEC-012, SEC-014 | 5.2, 5.3" with no qualifier, but WebSocket delivery does not reach a backgrounded or suspended mobile app, and 6.7 defers the background path to an undated future milestone with no push-token table, registration route or send step in 5.2.
- **Recommendation:** Split the FR-065 row: 5.2 and 5.3 for the foreground WebSocket path at M2, and a separate "(partial; background deferred, 6.7)" entry, matching how the table already marks NFR-003.
- **Critic note:** The tiebreak refuted this because section 13 is "a cross-reference index, not a completion-status table". The same table annotates NFR-003 with "(partial)", so the author does mark partial coverage, and the unqualified FR-065 row overclaims. Reinstated at minor (claimed blocker), because 6.7 states the deferral plainly.

## Severity downgrades

- **c001** (blocker to major): real traceability gap, but process and licensing documentation that a paragraph closes; it does not block implementation or merge.
- **c002** (blocker to major): tiebreak held the CJIS/GDPR gap real but not blocking, since the prototype holds no real CJIS data and nothing in M0 to M4 depends on it.
- **c005** (blocker to minor): UX-003 is a real coverage gap, but native auto-fill is largely platform-default behaviour and nothing in the architecture prevents it.
- **c006** (major to minor): section 11 already records FR-071's substance; only the ID cross-reference is missing, and FR-071 is itself TBD.
- **c007** (blocker to major): real schema gap for site-mandated MFA, but Phase 2 and additive in a mock-data prototype; no milestone depends on it.
- **c014** (blocker to major): tiebreak held the unscoped shortcuts a real spec gap with a well-known, low-risk fix, not a broken core mechanism.
- **c037** (blocker to major): genuine self-contradiction between section 2 and section 12, but a planning defect, not a runtime failure.
- **c048** (blocker to major): the storage-layer point is correct, but B4 most plausibly means application-level non-retrievability and key rotation is a declared non-goal.
- **c105** (major to minor): largely covered by c084, and `evaluateForm` does run server-side per 5.2.
- **c117** (major to minor): tiebreak held the seam gap real but deferred; the atomicity risk manifests only after the deferred Shared Platform migration.
- **c009** (major to minor, corrected by critic): the tiebreak explicitly downgraded it to minor as a low-risk convention, but the verdict table inherited the claimed major.
- **c012** (blocker to minor, corrected by critic): the tiebreak held it "a real but minor documentation finding", but the verdict table inherited the claimed blocker.
- **c054** (blocker to major, corrected by critic): `audit_event.credential_user_id` exists per row (5.5) and 5.7 requires every audit row to record both identities, so per-source SEC-011 attribution is representable; what remains is the single request-level column and the unstated resolution-time and revocation rule.
- **c015** (blocker to minor, reinstated by critic): the section 13 overclaim is real, but 6.7 states the background deferral plainly.
- **x13** (major to minor): the tiebreak held it a forward-looking hardening item, since no real adapter exists in this phase; the extra round's verdict table inherited the claimed major.

Severity dissents on confirmed clusters, where one lens argued a different severity from the one recorded and no tiebreak changed it. For **c036**, **c038** and **c110**, lens B argued major; the blocker rating stands because both lenses confirmed the defect and the consequence (silent result collision, a flagship rule that never fires, no host integration path) blocks the milestone that builds on it. For **c025**, lens B said "blocker is inflated"; it stays blocker because the review gate governs every other sensitive fix in this report. For **c032**, lens B proposed major to minor; for **c075** and **c114**, lens B said major is inflated; for **c089**, lens B said the gap is narrower than major. Each stays major because lens A confirmed at major and a severity-only dissent did not trigger a tiebreak. For **x6**, lens B would downgrade because the failure depends on an implementer splitting a sensitive feature across PRs; it stays major for the same reason. For **x1**, lens B called major reasonable while noting that some individual stories (C1, C2) would be minor alone. The earlier lens B dissent on **c054** (major) is now applied.

## Refuted findings

- **c003** SEC-023 and SEC-024 gates dropped with the PLT items: both gates trigger on Shared Platform build or data flow, which section 2 defers; at most a traceability note.
- **c004** PLT-007 absent from the design body: section 2 names "PLT-001 to PLT-008" as deferred, which includes PLT-007.
- **c008** Traceability rows point to config and M4, not design: the generic schema in 4.1 fully specifies person and property fields, and "FR-070 | M4" is a valid deferral pointer.
- **c013** Persona rule misclassifies Toughbooks as dispatch: 6.1 provides a persisted `persona_override`, so no device is stuck.
- **c018** No keyboard path to Credentials settings or the audit viewer: 6.4's app-wide tab-order rule covers ordinary navigation controls.
- **c019** 48x48 CSS px touch target unjustified: the design resolves the spec TBD with a standard value and names Playwright verification.
- **c020** No notification coalescing for multi-source queries: per-source status lives in the results list, and toast grouping is below the design's altitude.
- **c022** Quick-select keys stop at 9: the map is site-overridable and other types stay reachable.
- **c024** CI coverage thresholds make M0 undeliverable: section 10 mandates TDD, so M0 code ships with its tests.
- **c027** Startup migrations under Watchtower risk corrupting the audit DB: speculative about library behaviour, and section 14 already accepts the operational risk class.
- **c031** Playwright and test-API harness not designed: standard CI plumbing, and 5.4 and 11 give the knobs for a deterministic profile.
- **c033** Branch-conditional `permissions` block is impossible: a prose summary of intent; a step-level `if` achieves it.
- **c035** Auth rate limiting has no thresholds: consistent with the design's level of detail elsewhere; the IP-keying defect survives as c062.
- **c066** Production CORS includes localhost and TLS terminates at Cloudflare: 5.9 already scopes SEC-007 "at the prototype's boundary".
- **c090** Two-digit year rule wrong for model years: the spec's own example uses this field as expiration year, where "2000 plus" is correct.
- **c118** Better Auth identity and password delegation cannot survive PLT-001/PLT-002: that integration is explicitly deferred behind interfaces.
- **c119** Laptop, tunnel and Watchtower topology does not transfer: section 1 and 5.9 already scope the topology to the prototype.
- **c120** Dependency policy unenforceable against Expo lockstep and Node 22: Node 22 LTS is a deliberate choice and section 14 names the churn risk with a mitigation.
- **c121** Response mapper frozen against invented JSON: adapters normalise wire formats into `SourcePayload`, so the mapper is not tied to the mock shape.
- **c123** No agency or tenant dimension for FR-004's Agency default: FR-004 treats Agency as an ordinary site default, and single-site-per-deployment is a deliberate choice.
- **x2** M1 claims A1 and A4 but submission, ack and audit arrive in M2: the requirements map A1 to FR-004, FR-006 and FR-010 and A4 to FR-050 to FR-055, never to FR-064 or SEC-010, which map to A6 and A9; section 12's M1 and M2 split mirrors that grouping, so "the query submits" is the UI submit trigger, not the audited dispatch pipeline.
- **x8** M3 bundles five sensitive areas with no internal ordering, and SEC-001 entry has no milestone: the default site's seeded scenarios set no `requiresCredentials: true`, and A6 and A9 fire on any adapter response including `badCredentials`, so the claimed M2 blockage does not follow; ordering work inside a milestone is sprint sequencing, not a design decision.
- **x15** No UI element marks results as simulated: the cited UX-010 and UX-011 are about keyword styling, not disclosure; the mock-only scope is a stated constraint, and the screenshot-out-of-context scenario is the finder's own reasoning beyond the documents. A reasonable enhancement, not a spec gap.
- **x17** The mock adapter checks only credential presence, so B3 is unobservable at the adapter: 5.7 already states the design decision (dispatch resolves the officer's credentials and records both identities); making the adapter independently corroborate which credential it received is a test-harness detail a TDD implementer adds.

Critic concerns on refutations that were not accepted: none. All four refutations the critic challenged (c015, c021, c067, c111) were reinstated or folded as described above.

## Coverage

What the finders examined and judged sound, so the reader knows these were checked and not merely missed:

- **Core architecture:** a pure, IO-free core depending only on `zod`, shared by app and API, with server-side re-validation through the same `evaluateForm` and `planRequest`. The pnpm split into core, api, config and app is reasonable.
- **Rules engine and conditions:** structured JSON conditions with no eval (no injection surface); recomputing FormState from `FieldDef` flags each evaluation so reverting a condition reverts its effects; "hidden fields are never required" as the require-versus-hide tiebreak; the op set (eq, neq, in, notIn, empty, notEmpty) is sufficient for every condition the spec invokes; `custom: true` affecting documentation only.
- **Terminal:** reusing `evaluateForm` for terminal validation; case-insensitive code match; keeping source selection out of the command string in Phase 1; trailing-empty handling for FR-054.
- **Response and highlighting:** per-persona `ResponseMapping` with a default persona; longest-keyword-first matching for overlaps; plate-only sources flagged per query-type source entry.
- **Config tooling:** generated JSON Schema for editor support and `config:validate` in CI; `mock` specs stripped from `GET /api/config`; the `MockSpec` behaviours (timeout, error, badCredentials) as test hooks for B1 and SEC-002, subject to the query-type keying and seeding gaps in x14.
- **Dispatch:** the 202 plus UUIDv7 correlation-ID ack pattern (74 random bits make guessing impractical); dispatching after ack, since FR-064 asks for ack on receipt; per-source `AbortSignal` timeouts yielding a terminal status per source; the 10s configurable default; the adapter registry as an extension point; status values matching FR-043 apart from the missing `pending`; WebSocket over SSE given React Native; request body limits.
- **Persistence and audit:** soft delete through a separate `result_visibility` table rather than mutating `source_result` (FR-062, FR-063); append-only intent with abort triggers as a strong baseline; `actor_user_id` plus `credential_user_id` as the right shape for SEC-011; `AuditService` behind an interface for PLT-005; the section 10 immutability test as a starting point; SEC-014 correlation-ID coverage apart from the nested-part caveat.
- **Credentials and auth:** AES-256-GCM with a random 12-byte IV per record (no IV-reuse risk at this volume); server-side credential resolution at dispatch, never on the client; scrypt hashing; httpOnly and secure cookies; native bearer tokens in secure storage; the `credentialsChanged` audit event and `expired` mock scenario for SEC-002; delegation placed on Opus-reviewed seats; key rotation as a non-goal, provided `key_version` is added.
- **Deployment and CI:** non-root runtime container with a healthcheck; the CORS baseline for plain HTTP routes, given the tunnel topology (the WebSocket handshake, CSP and embedding are not covered by it; see c061, c030, c110); Dependabot and CI policy consistent with the project's "newest stable" rule; SEC-005's TOTP placement at M3 (site-level enforcement is missing; see c007).
- **Traceability:** of the requirement IDs and all 22 Appendix A items walked, the traceability finder judged these present, meaning traced to a design section: BR-001, BR-002, BR-007, FR-001 to FR-012, FR-040 to FR-044, FR-050 to FR-056, FR-060, FR-062 to FR-064, FR-070, UX-001, UX-002, UX-010 to UX-015, SEC-001 to SEC-004, SEC-006, SEC-007, SEC-010, SEC-012 to SEC-014, NFR-001, NFR-003, NFR-004, PLT-003, PLT-006, PLT-008. Presence is all this line asserts. Nearly every ID in it later drew a confirmed finding on mechanism from another lens, including SEC-003 (c043, c052), SEC-004 (c064), SEC-006 (c047), SEC-007 (c030), SEC-011 (c054), SEC-013 (c039), UX-004 (c009, x20), UX-016 (c010), BR-002 and PLT-006 (c110, c111), and NFR-003 (c040, c072); the theme sections and the traceability delta below are authoritative. FR-065 is not in the list: its background half is unbuilt and section 13 overclaims it (c015). Items A1 to A9, B1 to B5, C1 and C2 are placed in M1 to M4, but B6 and B7 (Phase 2) sit in an undated "Later" bucket with no milestone (c012), and no item is tied to a named acceptance test (x1). Non-goals in section 2 (FR-045, FR-072 to FR-075, real PLT integration, MFA beyond TOTP, key rotation, offline queueing) were not treated as gaps, and NFR-003's "partial" label was judged honest.

## Traceability delta

Requirement IDs the design does not address, or claims in section 13 without delivering, drawn from confirmed findings.

| Requirement ID | Design claim | Actual state | Cluster |
|---|---|---|---|
| BR-003, BR-004, BR-005, BR-006 | Not mentioned; not a non-goal | Unaddressed | c001 |
| UX-003 | Not mentioned; not a non-goal | Unaddressed | c005 |
| FR-065 | 5.2, 5.3 (unqualified) | Foreground WebSocket path only; background half "not built in Phase 1" (6.7) | c015 |
| BR-007 | 4.1, 7, 5.1 | WebSocket event contract has no schema or published reference; contract tests tautological | x5 |
| FR-071 | Not cited (substance in section 11 "Background lookup launch") | ID untraced | c006 |
| SEC-020, SEC-021 | Not mentioned | No compliance position, unlike SEC-022 | c002 |
| SEC-022 | Section 11 only | Absent from section 13 | c002 |
| SEC-005 | 5.6, M3 | Opt-in per user; no site-level enforcement | c007 |
| SEC-006 | 5.7, 5.9 | Only credential secrets encrypted; query data, payloads and audit details plaintext; logs unredacted for query values | c047, c029 |
| SEC-013 | 5.5 | No audit event for delete-from-view | c039 |
| SEC-010, SEC-012 | 5.2, 5.5 | Audit rows do not carry query type, subtype or sources; nested parts unlogged | c068, c078 |
| SEC-011 | 5.7 | Request-level `credential_user_id` cannot hold per-source owners; audit rows can, but the design never says `sourceResponded` records the owner resolved at dispatch, nor what revocation mid-queue does | c054 |
| SEC-004 | 5.7 | Training-only dialog and schema | c064 |
| SEC-021 | Not mentioned | No retention or erasure path under append-only storage | c063, c076 |
| UX-016 | 4.5 | No grid layout; mapper output is scalar only | c010, c101 |
| UX-004 | 4.3, 6.2 | No visual treatment specified; missing and invalid fields not tied to inputs or announced | c009, x20 |
| FR-050 | 4.4 | Parser only; terminal not addable to a layout | c106 |
| NFR-002 | 5.2 | Volume clause contradicted by single-writer design in section 14 | c011, c116 |
| NFR-003 | 5.3, 6.6 (partial) | Replay has no backing table; acknowledged queries lost on restart | c040, c072 |
| NFR-004 | 5.2 | Server-only budget; transaction boundary and measurement unstated | c071, c077 |
| NFR-001 | 5.8 | Error text, picklist labels, formats and shortcuts unlocalized | c122 |
| BR-002, PLT-006 | 2, 3 (standalone add-on) | No embedding mechanism; no host identity handoff; Records hosts have no persona | c110, c111, c112 |
| FR-030, FR-031, FR-032, FR-061 | 4.3 (FR-031, FR-032); later milestone (FR-061) | B6 and B7 in undated "Later" bucket; picklist narrowing has no defined `Picklist` shape | c012, c098 |
