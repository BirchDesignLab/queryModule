### 5.6 Authentication

Two identity modes behind `IdentityService.resolve(req) -> Principal` (5.5). Every route and the WebSocket upgrade (5.3) authenticate through it; no route reads a cookie or token directly.

**Standalone mode** (the demo app). Better Auth with email plus password, mounted at `/api/v1/auth/*`. Password hashing is Better Auth's default (scrypt). Web sessions use a `__Host-` prefixed cookie: httpOnly, Secure, `Path=/`, no `Domain`, SameSite=Lax. Native uses the Better Auth Expo plugin; the bearer token lives in SecureStore only and travels only in the `Authorization` header, never in a query string (5.3, 6.10).

**Embedded mode** (a host CAD product frames the module, 6.9). The host passes a host-issued JWT to the module over postMessage. `IdentityService` validates signature, `iss`, `aud` and `exp` against the issuer, audience and JWKS URL in deploy config, maps `sub` to a local principal with no local password, and takes roles from the claims map in `SiteConfig.auth.embedded` (4.1). The module presents the JWT once to `POST /api/v1/auth/embedded`, which issues an ordinary module session; everything after that is identical to standalone [open: session carried as a `__Host-` cookie with `SameSite=None; Partitioned`, since the frame is third-party to the host]. Embedded sessions never outlive the host token's `exp`; the host sends a fresh token over postMessage to continue [open]. Audit rows carry `identity_source` (`local` | `host`) and the host subject.

```
Principal { userId, email, roles: Role[], identitySource: "local"|"host",
            hostSubject?: string, sessionId, authenticatedAt, stepUpAt? }
```

**Session limits** from `SiteConfig.auth.session` (4.1): absolute 12h, idle 30 min, defaults `{ absoluteMinutes: 720, idleMinutes: 30 }`. The same limits apply to native bearer sessions and embedded sessions. Expiry, logout and revocation close the session's sockets (5.3), revoke delegations bound to it (5.7) and reset client state (6.7).

**Rate limiting and lockout.** Client IP is read from `CF-Connecting-IP`. The header is trusted only because cloudflared is the sole ingress and the app port is not published on the host (8); outside production the socket address is used. The limiter is keyed by IP and by target account and stored in the `rate_limit` table (5.5), so it survives redeploys. Thresholds:

| Key | Limit | On breach |
|---|---|---|
| Target account, failed sign-ins | 10 per 15 min | Account locked 15 min; further attempts rejected without password check |
| Client IP, auth requests | 100 per 15 min | 429 for the rest of the window |
| Officer, failed delegation code redemptions (5.7) | 5 per 15 min [open] | Redemption blocked 15 min |

Lockouts are audited: `loginFailed` details carry `lockoutStarted: true` on the attempt that trips the lock [open: no separate event type in the 4.7 catalogue].

**Auth audit.** Better Auth hooks write `loginSucceeded`, `loginFailed`, `logout`, `sessionRevoked`, `mfaEnrolled` and `mfaDisabled` (4.7).

**MFA.** TOTP through the Better Auth two-factor plugin (M3, SEC-005). `SiteConfig.auth.mfaRequired: boolean | { roles: Role[] }`, default `false`. When it applies to a user who has not enrolled, middleware returns 403 `{ key: "auth.mfaEnrollmentRequired" }` on every route except auth, enrollment, `meta`, `config` and `locales`, and the client routes to enrollment. In embedded mode MFA is the host's responsibility and `mfaRequired` is not evaluated [open].

**Roles.** `user`, `trainingOfficer`, `admin`, stored on the user row in standalone mode and checked by route middleware. Roles change only through `scripts/ops/grant-role.ts`, which writes `roleChanged`. There is no role-editing route. Delegator roles are per purpose (5.7).

**Step-up.** Routes marked step-up (credential PUT and DELETE, delegation approval) require: a TOTP code in the request when the user has TOTP enrolled, otherwise a password re-entry at `POST /api/v1/me/step-up` within the last 5 minutes, recorded as `stepUpAt` on the session. Step-up failures count against the account limiter. In embedded mode step-up requires a host token with `iat` within 5 minutes [open].

**User disable.** One transaction: revoke every delegation where the user is trainee or officer (reason `userDisabled`), delete the user's `state_credential` rows, revoke all sessions, set the user disabled, write `userDisabled` (plus `delegationRevoked` and `credentialsDeleted` per affected row). Sockets close after commit. Run by `scripts/ops/disable-user.ts` [open]. `audit_event` has no foreign key to `user` and carries an actor snapshot (5.5), so audit survives. Hard delete of a user row happens only through an ops script after the audit retention period (11).

**Demo users.** `packages/api/src/seed/users.ts` defines usernames and roles. Passwords are derived at seed time as HMAC-SHA256 of the email under `SEED_PASSWORD_SECRET` (Docker secret file, 8), printed once to the seed script's stdout and never committed. `docs/demo.md` lists usernames only.

Covers SEC-005, BR-002, PLT-006.

### 5.7 Credentials and delegation

**Storage.** One `state_credential` row per user per source (SEC-001, SEC-002). `{ username, secret }` is serialised and encrypted as one AES-256-GCM blob under `CREDENTIAL_KEY`, random 12-byte IV per write, AAD = `user_id|source_id|key_version`. Columns: `ciphertext`, `iv`, `auth_tag`, `key_version`, `username_hint` (last 2 characters of the username), `updated_at`, `last_verified_at`, `last_status`. A row copied to another user or source fails authentication; a decrypt failure writes `credentialsInvalidated` and the source resolves as `credentialsMissing`. This column encryption sits inside the whole-database encryption of 5.5, whose key is separate.

**Key custody.** `CREDENTIAL_KEY` (32 bytes, base64) is read from a Docker secret file, never from an environment variable and never stored on `/data` (8). At startup the API decrypts a canary row (`key_canary` table [open]) written under the current key on first boot; a missing, malformed or mismatched key refuses to serve (fail closed). `scripts/ops/lost-key.ts` is the lost-key runbook: it deletes every `state_credential` row, writes `credentialsInvalidated` per row with reason `keyLost`, revokes active delegations (reason `keyLost`) [open], writes a new canary under the new key, and users re-enter credentials. Rotation remains a non-goal (2); `key_version` exists so it can be added.

**Change and delete.** A change replaces the row; a delete removes it. With `secure_delete=ON` (5.5), the write is followed by `PRAGMA wal_checkpoint(TRUNCATE)` so superseded ciphertext leaves both the main file and the WAL. Backups taken earlier still hold superseded ciphertext; their retention is bounded (8). Verified by the raw-bytes scan test (10).

**Secret handling.** Decrypted values exist only as `Secret<T>`: `toJSON`, `toString` and `util.inspect` return `"[redacted]"`, and `.reveal()` is called only at an adapter's wire boundary (5.4). Decryption is confined to the dispatch module; no other module imports the decrypt function.

**Routes** (5.1). The API never returns a secret, ciphertext or full username.

```
GET    /api/v1/me/credentials            -> CredentialStatus[]   // every requiresCredentials source
GET    /api/v1/me/credentials/:sourceId  -> CredentialStatus
PUT    /api/v1/me/credentials/:sourceId  { username, secret }    // step-up
DELETE /api/v1/me/credentials/:sourceId                          // step-up
CredentialStatus { sourceId, usernameHint, hasSecret, updatedAt, lastVerifiedAt,
                   lastStatus: "ok"|"credentialsRejected"|null }
```

PUT writes `credentialsCreated` or `credentialsChanged`; DELETE writes `credentialsDeleted`. A source without `requiresCredentials` returns 404.

**Credential statuses** (SEC-002). Dispatch resolves `credentialsMissing` when no usable credential exists (none stored, or decrypt failed) and does not call the adapter; the adapter reports `credentialsRejected` when the source refuses them. Both are `source_result` statuses (5.5) and update `last_status` and `last_verified_at`. The result card shows the status with a deep link to the user's own credential editor, or, when the credential was delegated, the officer's name and no link. "Retry this source" resubmits the same values to that one source as a new submission with a new correlation ID and Idempotency-Key [open]. The mock simulates rejection through `mock_credential_state` (5.4).

**Delegation model** (SEC-003, SEC-004, SEC-011). The trainee never types anyone's password. The officer approves from their own session on their own device and lends their stored state credentials.

```
SiteConfig.delegation {
  maxDurationMinutes: 480
  purposes: { key, labelKey, delegatorRoles: Role[], maxDurationMinutes? }[]
    // default: [{ key: "training", labelKey: "delegation.purpose.training",
    //             delegatorRoles: ["trainingOfficer"] }]
}
```

Effective duration cap is the lower of the purpose's and the site's `maxDurationMinutes`. The officer must hold a role in the purpose's `delegatorRoles`; the trainee needs no role. The dialog title comes from the purpose `labelKey`, never a hard-coded "training officer".

Rows: `credential_delegation` (id, purpose, trainee_user_id, session_id, officer_user_id nullable until redeemed, code_hash, status `pending`|`active`|`expired`|`revoked`, requested_minutes, created_at, approved_at, expires_at, ended_at, end_reason) and one `credential_delegation_source` row per source (delegation_id, session_id, source_id, active). A partial unique index on `credential_delegation_source (session_id, source_id) WHERE active = 1` enforces one active delegation per trainee session per source [open: child table shape; 5.5 owns the final DDL].

**Request and approval flow.**

1. **Trainee device, trainee session.** Trainee opens the delegation dialog, picks purpose, sources and duration. `POST /api/v1/delegations { purpose, sourceIds[], durationMinutes }`. Server checks every source exists and has `requiresCredentials`, and duration is within the cap. It creates a `pending` row bound to the trainee's `session_id`, generates a 6-character code from an unambiguous alphabet, stores only its SHA-256 hash, sets `expires_at` to now plus 5 minutes, and writes `delegationRequested`. A newer request from the same session cancels an older pending one [open]. Response: `{ id, code, expiresAt }`.
2. **Trainee device.** Shows the code and a QR code encoding `https://<origin>/delegate#code=<code>` (fragment, so the code never reaches server or tunnel logs), plus a countdown.
3. **Officer device, officer session.** Officer signs in normally on their own device, then types the code or scans the QR. `POST /api/v1/delegations/redeem { code }`. The code is single-use: redemption binds the request to this officer. A wrong, expired or already-redeemed code returns 404 `{ key: "delegation.codeInvalid" }`, writes `delegationVerifyFailed` and counts against the per-officer redemption limiter (5.6). An officer lacking a delegator role for the purpose gets 403 and `delegationVerifyFailed`. Success returns a preview: trainee name, purpose, requested sources, duration, and `missingCredentials[]` (requested sources for which the officer has no `state_credential`).
4. **Officer device, officer session.** The preview shows who is asking and for what. The officer may narrow the sources, shorten the duration, or add missing credentials in the same flow through the credential editor (PUT above, step-up).
5. **Officer device, officer session.** `POST /api/v1/delegations/:id/approve { sourceIds[], durationMinutes, totpCode? }`, step-up required (5.6). One transaction re-checks: request still `pending`, bound to this officer and unexpired; role still held; trainee session still live; `sourceIds` a subset of the request and `durationMinutes` no longer than requested; officer holds a `state_credential` for every approved source, else 409 `{ key: "delegation.credentialsMissing", params: { sourceIds } }`. Any active delegation on the same trainee session that shares a source is revoked whole with reason `superseded` and `delegationRevoked` [open]. The row becomes `active` with `expires_at` = now plus duration, source rows are inserted active, and `delegationApproved` is written with officer, trainee, purpose, sources and expiry. After commit a delegation event (4.7) goes to both users.
6. **Trainee device, trainee session.** A persistent banner shows the officer's name, the covered sources and the expiry, with a revoke control, until the delegation ends.
7. **Server, per submission.** In the step-3 transaction (5.2), for each (part, source): an active, unexpired delegation matching the submitting session and source supplies the officer's credential and overrides the trainee's own; otherwise the trainee's own credential is used. `credential_user_id` and `delegation_id` are persisted on each pending `source_result`, and `sourceDispatched` records the owner per source. That snapshot is authoritative: revocation or expiry after commit does not change credentials for that submission. A delegation on another session of the same trainee (for example their phone) never resolves.
8. **Any device.** The delegation ends by one of: `DELETE /api/v1/delegations/:id` by trainee, officer or admin (`delegationRevoked`, actor and reason recorded); expiry (`delegationExpired`; resolution checks `expires_at` directly, and a sweep marks rows and writes the event); the trainee session ending by sign-out, expiry or revocation (`delegationRevoked`, reason `sessionEnded`); user disable (5.6). A pending request unredeemed or unapproved at 5 minutes becomes `expired` with `delegationRequestExpired`.

**Visibility.** `GET /api/v1/delegations` returns, to both trainee and officer, their active delegations and those ended in the last 24h. `GET /api/v1/me/delegated-queries` gives the officer a read-only list of requests that ran on their credentials (policy function, 5.2; audited). The admin audit user filter matches actor OR credential owner (5.1). Dispatch and response events copy the credential owner from the step-3 snapshot; a later hide records the actor only.

The officer lends credentials already stored rather than typing state credentials at the trainee's console, which diverges from B3's wording; the divergence and its reason are recorded in 13.

Covers SEC-001, SEC-002, SEC-003, SEC-004, SEC-006, SEC-011.

### 5.8 Config loading

**Source.** One image serves every site. Site config, locales and mock files come from a read-only volume; the image bundles `packages/config` as the default. `SITE_CONFIG` names the site file (default the bundled `sites/default.json`). Locales load from `locales/<locale>.json` beside it. Mock files `mock/<siteId>.json` load only when `ALLOW_MOCK_SOURCES=true` (5.4). No admin editing UI; edit the file and restart.

**Startup sequence.** Fails closed at every step, naming the file and JSON path.

1. Read the site file and resolve its `extends` chain: keyed deep merge (arrays of entities merge by `id`, `code` or `key`), `$remove` deletes an inherited entry (4.1).
2. `migrateConfig(raw)` from core (see below).
3. Strict Zod parse of `SiteConfig` (4.1).
4. `validateSiteConfig(config, locales)`: the referential pass (4.1), including labelKeys present in every locale listed in `SiteConfig.locales`, source `kind` against the adapter registry and `ADAPTER_DIR` plugins, and mock coverage (5.4). Errors stop startup; warnings are logged.
5. Compute `configHash`: SHA-256 of the canonical JSON (sorted keys) of the resolved config.
6. Write `configLoaded` with site id, config version and `configHash`.

**Migration.** `SiteConfig.version` is an integer. Core exports `migrateConfig`, an ordered list of pure step functions (`n -> n+1`) applied in memory at startup with a logged warning per step. `pnpm config:migrate <file>` writes the migrated file for the site developer. A config whose version is newer than the server's schema version is rejected. The server parse is strict; clients parse `ClientSiteConfig` forward-tolerantly (6.7).

**Client view.** `GET /api/v1/config` requires a session and returns `ClientSiteConfig`, an allowlist schema: fields not listed there never leave the server. `Source.server`, mock data, `retention`, `auth.embedded` and delegation role lists are excluded. The response carries `configHash`, also exposed by `GET /api/v1/meta` with `apiVersion`, `coreVersion`, `configSchemaVersion` and `minClientVersion` (5.1). Every submit carries `configHash`; a mismatch returns 409 `{ key: "config.changed" }` and the client refetches config. The hash is stored on `query_request` and in `submitted` details.

**Locales** (NFR-001). `SiteConfig.locales[]` lists the site's locales; the first is the default. A per-user locale is a preference (5.1). `GET /api/v1/locales/:locale` returns the bundle for a listed locale, 404 otherwise; it needs no session because the sign-in screen uses it, and holds UI strings only [open]. Ships `en` only. Every user-facing string, picklist label and error is a message key with params (4.1, 4.4); formatting uses `Intl`.

**Feature flags.** `SiteConfig.features: { [name]: boolean }` over a closed list of names defined in core; an unknown name is a validation error. A disabled feature's routes return 404 as if absent and its UI is hidden (`ClientSiteConfig.features`). Sensitive capabilities (credentials, delegation, admin audit, hide) merge dark behind their flag until their acceptance tests pass (9, 10). Initial names: `credentials`, `delegation`, `resultHide`, `adminAudit`, `embedded` [open].

Covers BR-001, BR-004, NFR-001, PLT-007.

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
frame-ancestors <FRAME_ANCESTORS allowlist, 'none' when empty>;
```

The web app is Vite plus React DOM (3); inline styles are set through the CSSOM, which `style-src 'self'` permits, and no stylesheet is inlined. From M0 a Playwright check asserts zero CSP violations across the smoke flow (10).

**Headers.** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. `Cache-Control: no-store` on every `/api` response and on `index.html`; hashed static assets are `public, max-age=31536000, immutable`.

**Origins.** CORS and `frame-ancestors` each read an allowlist from deploy config (`CORS_ORIGINS`, `FRAME_ANCESTORS`, 8), default the deployed origin only; localhost origins are added only in development. The WebSocket upgrade enforces its own Origin check (5.3). Better Auth's trusted origins are the same list.

**CSRF.** Every state-changing request (POST, PUT, PATCH, DELETE) to a non-auth route must carry `X-Requested-With: querymodule`, else 403. A cross-site form cannot set it and a cross-origin script cannot send it without passing CORS. Better Auth routes rely on its own origin check. The `__Host-` session cookie (5.6) cannot be set or overwritten by a sibling subdomain.

**Limits.** Request body 32KB, 4KB per field value (4.1).

**Logging.** Structured logs. The logger redacts, at any depth, every key that is a `FieldDef` key in the resolved config, and every object under `values`, `payload`, `body`, `credentials`, `secret`, `password`, `authorization` or `cookie`. `Secret<T>` (5.7) redacts itself regardless. The error reporter never captures request or response bodies. A log-capture test submits known test values and asserts none appear in any sink (10).

**Secrets.** `CREDENTIAL_KEY`, the database key, the Better Auth secret and `SEED_PASSWORD_SECRET` are Docker secret files (8). Environment variables name file paths only. None live on `/data`.

**Transport.** TLS terminates at Cloudflare. The container listens on plain HTTP on the private compose network, with no host port published; cloudflared is the sole ingress, which is also what makes `CF-Connecting-IP` trustworthy (5.6). This is SEC-007 at the prototype's boundary; real adapters are out of scope (2).

Covers SEC-006, SEC-007.

## Writer notes (remove at assembly)

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
