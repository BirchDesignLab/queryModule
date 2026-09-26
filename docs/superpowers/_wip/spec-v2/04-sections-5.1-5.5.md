### 5.1 Routes

All routes live under `/api/v1`. Every body, query string and header the route reads is validated with Zod; OpenAPI is generated from the same schemas and served at `/api/v1/openapi.json` with a viewer at `/api/v1/docs` (BR-007). Cross-cutting rules: state-changing non-auth routes require `X-Requested-With` (5.9); every `/api` response carries `Cache-Control: no-store` (5.9); a route behind a disabled `features` flag returns 404 (5.8); read and hide access to query data goes through one policy function (5.2). "Session" means a principal resolved by `IdentityService.resolve` (5.5, 5.6).

| Route | Access | Purpose |
|---|---|---|
| `POST/GET /api/v1/auth/*` | public | Better Auth handlers (5.6) |
| `GET /api/v1/meta` | public [open] | `{ apiVersion, coreVersion, configSchemaVersion, configHash, minClientVersion }`; client refuses to run below `minClientVersion` |
| `GET /api/v1/config` | session | `ClientSiteConfig` (allowlist, 4.1); never `Source.server` or mock data |
| `GET /api/v1/locales/:locale` | public [open] | Locale bundle (5.8) |
| `POST /api/v1/queries` | session | Submit. Header `Idempotency-Key` required. Body `{ queryType, values, sourceIds, mode, configHash }`. 202 `{ correlationId, acknowledgedAt, parts[] }`; 400 core error shape; 409 config hash mismatch; 429 rate limit (5.2) |
| `GET /api/v1/queries` | session, own | Caller's requests, cursor-paged, parts nested with per-source status, hidden results excluded |
| `GET /api/v1/queries/:correlationId` | policy | One request, parts, per-source status and payloads, hidden results excluded |
| `POST /api/v1/results/hide` | policy, owner only | Delete from view. Body `{ resultIds[] }` |
| `WS /api/v1/ws` | session, Origin checked | Result feed (5.3) |
| `GET/PUT /api/v1/me/preferences` | session | `user_preference` row (5.5) |
| `GET /api/v1/me/credentials` | session | List of own credential summaries, never secrets (5.7) |
| `GET/PUT/DELETE /api/v1/me/credentials/:sourceId` | session; PUT/DELETE step-up | One state-system credential (5.7) |
| `GET /api/v1/me/delegated-queries` | session | Officer view: parts run under the caller's credentials, read-only (5.7) |
| `POST /api/v1/delegations` | session | Trainee requests `{ purpose, sourceIds[], durationMinutes }`; returns code + QR payload (5.7) |
| `POST /api/v1/delegations/approve` | session, fresh auth or TOTP | Officer redeems code, confirms or narrows sources and duration (5.7) |
| `GET /api/v1/delegations` | session | Delegations where caller is either party, active plus last 24h (5.7) |
| `DELETE /api/v1/delegations/:id` | either party or admin | Revoke, audited (5.7) |
| `GET /api/v1/admin/audit` | admin | Filters: user (actor OR credential owner), correlation ID, type; required window <= 31 days; cursor, limit <= 200; writes `auditViewed` |
| `GET /api/v1/admin/audit/export` | admin | Same filters, NDJSON stream; writes `auditExported` |
| `GET /api/v1/admin/queries/:correlationId?includeHidden=true` | admin | Request with payloads including hidden results (FR-063); writes `adminViewed` |
| `PUT /api/v1/dev/mock-credential-state` | admin; exists only when `ALLOW_MOCK_SOURCES=true` | Set `mock_credential_state` for (user, source) (5.4) |
| `GET /api/v1/health` | public | Liveness for Docker healthcheck; no data |

Static web build is served at `/` from the same process. There is no unversioned `/api` alias.

Covers BR-007, FR-062, FR-063.

### 5.2 Query lifecycle

Vocabulary: a submit has one correlation ID (UUIDv7). The plan (4.6) splits it into parts: `part_id` 0 is the primary, 1..n are `alsoRun` children (one nesting level, children cap default 4). Each (part, source) pair is one `source_result` row with its own `result_id`.

Steps for `POST /api/v1/queries`:

1. **Admission.** Resolve principal (5.6). Check `X-Requested-With`, body cap 32 KB, per-value cap 4 KB, per-user rate limit (default 30 per minute, `rate_limit` table, 429). Require `Idempotency-Key`. If a `query_request` row with (user_id, idempotency_key) exists, return its original 202 body and stop; no new writes. A concurrent duplicate that loses the unique-index race does the same.
2. **Validation and plan (no writes).** Reject 409 with the current hash if `configHash` differs from the loaded config (5.8). Reject 400 on unknown query type or any posted key not a `FieldDef` of that type. Canonicalise and run `evaluateForm` (4.3) server-side; recompute `mode` and reject 400 if it differs from the posted `mode`. Run `planRequest` (4.6): plate-only intersects selected sources with `plateOnly` sources (empty intersection 400, non-empty narrows and the 202 names dropped sources); selected sources must be a subset of the type's sources; total dispatched (part, source) pairs across all parts capped at 8 by default [open]. Each nested part is evaluated on its mapped values with `selectedByDefault` sources; a failing nested part becomes `skipped` with a reason and the parent proceeds. Persisted and dispatched values are built only from the server `FormState`'s visible effective values. The raw body is never persisted or logged.
3. **Credential snapshot (no writes).** For each (part, source) with `requiresCredentials`: an active delegation matching (current session_id, source_id) wins, giving the officer as `credential_user_id` plus `delegation_id`; otherwise the caller's own `state_credential`; otherwise none. Only ownership is resolved here; decryption happens in dispatch (5.7). This snapshot is authoritative for the submit: later revocation or expiry does not change it.
4. **Transaction T1 (acknowledge).** One SQLite transaction:
   - insert `request_key` (fresh DEK, wrapped);
   - insert one `query_request` row per part (values encrypted under the DEK; skipped parts carry `skipped_reason`);
   - insert one `pending` `source_result` per dispatched (part, source) with `credential_user_id`, `delegation_id`, `adapter_kind`;
   - through `AuditService.record`: `submitted` per part (query type code, every `role:"type"` field value, selected and dispatched sources, `plateOnly` flag, actor snapshot, config hash, origin `primary` or `alsoRun`, parent part, fieldMap applied), `partSkipped` per skipped part, `sourceDispatched` per (part, source) recording the credential owner and delegation id [open: written at plan commit, not at the adapter call], then `acknowledged` carrying `acknowledged_at`.

   `acknowledged_at` is taken inside T1 as epoch ms. Any audit write failure rolls back T1 and returns 500 (fail closed). Only after commit does the server return 202 `{ correlationId, acknowledgedAt, parts: [{ partId, queryType, status: "dispatched"|"skipped", sourceIds, droppedSourceIds }] }` with a `Server-Timing` header. NFR-004 split: server target 200 ms from request receipt to 202; end-to-end measured from the client's ack-receipt message over the WebSocket (5.3), recorded as a metric log line, not an audit row.
5. **Dispatch (in-process, after commit).** The dispatcher owns all deadlines. Sources within a part run in parallel; parts run in parallel. Concurrency caps: per source default 4, global default 32; excess jobs wait in memory. Each deadline is `acknowledged_at + timeoutMs`, so queue wait counts against it. Per job: no credential when required -> outcome `credentialsMissing` without calling the adapter; decryption failure -> `credentialsInvalidated` audit and outcome `credentialsMissing`; otherwise `Promise.race(adapter.query(...), deadline)`, then abort the signal on deadline. A settlement after the deadline is logged (no payload) and never changes status. No automatic retries; "retry this source" is a new submit for that source (5.7).
6. **Transaction T2 (one per outcome).** Update the `source_result` row `WHERE result_id = ? AND status = 'pending'` (write-once), set `returned` (payload encrypted under the DEK), `failed`, `timedOut` (sets `timed_out_at`), `credentialsMissing` or `credentialsRejected`, and `received_at`; write `sourceResponded` (source, status, latency from the monotonic clock, credential owner, delegation id, `adapter_kind`); on a credentialed call update `state_credential.last_status` and `last_verified_at`; append a `sourceStatus` row to `event_log`. If the update matches no row, nothing else is written. After commit, `EventBus.publish` pushes the event (5.3). If T2 fails, the row stays `pending` and the next startup sweep marks it `interrupted` [open].
7. **Client.** The 202 alone drives the ack toast. `sourceStatus` events tell the client which result to fetch through `GET /api/v1/queries/:correlationId` (6.7).

**Startup sweep.** Before the server listens, one transaction sets every `pending` `source_result` to `interrupted`, writes an `interrupted` audit row per result and an `event_log` row per owner; clients receive them on replay. Nothing is re-dispatched.

**SIGTERM drain.** Stop accepting `POST /api/v1/queries` (503) and new WebSocket upgrades; let in-flight dispatch reach outcome or deadline, bounded by the maximum configured `timeoutMs` plus 5 s; then close sockets and exit. Compose `stop_grace_period` exceeds that bound (8). Anything still pending is swept at next start.

**Access policy.** One function, `authorizeQueryAccess(principal, correlationId, action: "read"|"hide")`, used by every query route and by WebSocket delivery:
- owner: read and hide;
- admin: read through the admin route only, audited `adminViewed`; never hide;
- delegating officer: read-only on (part, source) rows whose `credential_user_id` is the officer, via `GET /api/v1/me/delegated-queries`, audited as `adminViewed` with `details.basis: "delegator"` [open];
- anyone else: 404, never 403. The correlation ID is an identifier, not a capability.

**Hide.** `POST /api/v1/results/hide { resultIds[] }` runs in one transaction. Every id must pass the owner check or the whole call is 404. Inserts use `ON CONFLICT DO NOTHING`; each row actually inserted writes one `deletedFromView` audit row (result id, correlation ID, part, source, actor) and one `resultHidden` `event_log` row, pushed after commit so the owner's other devices drop it. Every read path, including replay, filters `result_visibility`.

Covers FR-040 to FR-044, FR-062, FR-064, FR-065, SEC-010 to SEC-012, SEC-014, NFR-002, NFR-004.

### 5.3 Result feed

WebSocket at `/api/v1/ws`. WebSocket rather than SSE because React Native supports it without a polyfill.

**Upgrade.** Rejected unless:
- `Origin` equals the deployed origin (dev origins accepted only when `NODE_ENV=development`); or
- `Origin` is absent and the request carries `Authorization: Bearer` (native). A token in the query string is never accepted.

Browser sessions authenticate with the `__Host-` prefixed session cookie (5.6). Each socket is bound to its session id and closed on logout, session expiry, session revocation or user disable (the session service publishes `sessionEnded` on the `EventBus`).

**Events.** All schemas live in core (4.7). Events are reference-only and never carry payloads or field values; the client fetches content through the policy-checked GET, which filters hidden results.

```
sourceStatus  { seq, correlationId, partId, sourceId, resultId, status }   // forward-only: pending -> terminal
resultHidden  { seq, resultId }
delegation*   { seq, delegationId, status }        // delegationApproved, delegationRevoked, delegationExpired (5.7)
resync        { currentSeq }
heartbeat     ping/pong every 20 s                 // client: stale after 2 missed (6.8)
```

Client to server: `{ type: "resume", lastSeq }` after connect, and `{ type: "ackReceived", correlationId, receivedAt }` for the NFR-004 end-to-end metric (5.2). There is no `ack` event.

**Replay.** `seq` is per user, monotonically increasing, assigned inside the writing transaction (single writer). On `resume` the server sends `event_log` rows with `seq > lastSeq`, created within the last 24 h, skipping `sourceStatus` for results the user has hidden, up to 500 events. If `lastSeq` is absent, older than the 24 h window, or more than 500 events are due, the server sends `resync { currentSeq }` and the client refetches its list over HTTP. The server terminates a socket after 2 missed pongs. `event_log` rows older than 24 h are pruned at startup and by `scripts/ops/purge.ts` [open].

**Client rules** (implemented in 6.7): dedup by `seq` high-water mark; status never moves backward; a `sourceStatus` arriving before the POST resolves creates a placeholder cache entry.

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

**Default site scenarios.** Plate `ZZ-0001` returns a STOLEN hit. Plate `ABC123` returns a clean no-record (A4 parse). Plate `TIMEOUT` times out on exactly one of the two default sources (B1). Plate `FAIL1` errors. Last name `WANTED` returns a WANTED hit on the nested wanted query type only (B2).

**Fixture policy** (also in `docs/site-config.md`). Every payload in a mock file is fictitious by construction:
- plates use the reserved format `ZZ-####`;
- VINs fail the ISO 3779 check digit;
- DOBs fall in 1901 (the `1901-01-01` family);
- names come from a synthetic corpus (Testerson, Sampleworth, ...);
- street addresses are on Example Ave.

Trigger values in `when` (such as `ABC123`, `TIMEOUT`) are inputs, not records, and are exempt. Payloads are produced by `scripts/mock-data/generate.ts` (committed). `config:validate` rejects payload violations, detecting fields by leaf key name (`plate`, `vin`, `dob`, name and address keys) [open]; it also checks that every (queryType, mock source) pair has a `default` and warns where its ResponseMapping paths do not resolve against the default and scenario payloads (4.5).

Covers FR-043, FR-044, SEC-002.

### 5.5 Persistence

SQLite through libSQL and Drizzle, one file on `/data`. Migrations generated by drizzle-kit, applied at process start, expand-then-contract (9).

**Connection.** Whole-database encryption through libSQL `encryptionKey`, read from the `DB_KEY` Docker secret file. `DB_KEY` is separate from `CREDENTIAL_KEY` (5.7); neither is ever stored on `/data`. Opening the database without the key fails (tested). Pragmas: `journal_mode=WAL`, `synchronous=FULL`, `secure_delete=ON`, `busy_timeout=5000`, `foreign_keys=ON`.

**Conventions.** Every timestamp is an INTEGER of epoch milliseconds UTC. Durations come from the monotonic clock and live in audit `details`. Ids are UUIDv7 text unless stated.

**Tables.**

- Better Auth: `user` (plus `role`, `disabled_at`), `session`, `account`, `verification`, `two_factor` (M3). Owned by Better Auth (5.6).
- `query_request`, insert-once (trigger aborts UPDATE):
  `correlation_id`, `part_id` INTEGER, PK (`correlation_id`, `part_id`); `user_id`; `parent_part_id` nullable; `origin` (`primary`|`alsoRun`); `query_type`; `type_values` JSON (`role:"type"` field values only); `values_ciphertext`, `values_iv`, `values_tag` (under the request DEK); `plate_only` INTEGER; `selected_source_ids` JSON; `dropped_source_ids` JSON; `skipped_reason` nullable; `config_hash`; `idempotency_key` (part 0 only); `submitted_at`. No `acknowledged_at` (it lives in the `acknowledged` audit row) and no `credential_user_id` (it lives per `source_result`).
- `source_result`:
  `result_id` PK; `correlation_id`, `part_id`, `source_id`, UNIQUE (`correlation_id`, `part_id`, `source_id`); `user_id` (request owner); `status` (`pending`|`returned`|`failed`|`timedOut`|`credentialsMissing`|`credentialsRejected`|`interrupted`); `credential_user_id` nullable; `delegation_id` nullable; `adapter_kind`; `payload_ciphertext`, `payload_iv`, `payload_tag` nullable; `error_code` nullable (no free text); `created_at`; `received_at` nullable; `timed_out_at` nullable. A trigger aborts any UPDATE whose old status is not `pending` (write-once). Rows are never deleted by application code (FR-063).
- `result_visibility`: `result_id` FK, `user_id`, `hidden_at`; PK (`result_id`, `user_id`). Delete-from-view inserts here with `ON CONFLICT DO NOTHING`.
- `event_log`: `user_id`, `seq` INTEGER, PK (`user_id`, `seq`); `type`; `correlation_id`, `part_id`, `source_id`, `result_id`, `delegation_id`, each nullable; `created_at`. Serves as the outbox for `EventBus`.
- `audit_event`: `id` INTEGER PK AUTOINCREMENT (ordering is by `id`, never by `at`); `type`; `at`; `correlation_id`, `part_id`, `source_id` nullable; `actor_user_id`, `actor_email`, `actor_role` (snapshot, no FK to `user`); `credential_user_id` nullable; `delegation_id` nullable; `identity_source` (`local`|`host`); `host_subject` nullable; `details` JSON validated by the per-type schema (4.7). `details` holds identifiers, metadata and `role:"type"` values only, never field values or payloads.
  Triggers `audit_event_no_update` and `audit_event_no_delete` `RAISE(ABORT)`. At startup the server checks `sqlite_master` for both and refuses to serve if either is missing. Migrations may only CREATE, ADD a nullable COLUMN or CREATE INDEX on this table, enforced in CI (9). Hash chaining is deferred [open].
- `state_credential` (5.7): `user_id`, `source_id`, PK both; `ciphertext`, `iv`, `auth_tag`, `key_version`, `username_hint`, `updated_at`, `last_verified_at` nullable, `last_status` nullable.
- `credential_delegation` (5.7), one row per source: `id`; `request_id` (groups one approval); `purpose`; `trainee_user_id`; `officer_user_id` nullable until approved; `session_id` (trainee session); `source_id`; `status` (`pending`|`active`|`revoked`|`expired`|`requestExpired`); `code_hash`; `requested_at`, `approved_at`, `expires_at`, `revoked_at`; `revoked_by` nullable; `revoke_reason` nullable. Partial unique index on (`session_id`, `source_id`) WHERE `status = 'active'`.
- `request_key`: `correlation_id` PK; `wrapped_dek`, `iv`, `auth_tag`, `key_version`; `created_at`. The DEK is wrapped with a key derived from `CREDENTIAL_KEY` under a distinct HKDF label [open].
- `user_preference`: `user_id` PK; `layout` JSON (orientation, terminal `toggle`|`pane`); `default_view`; `persona_override` nullable; `theme_mode`; `locale`; `updated_at`.
- `rate_limit`: `key` PK (for example `login:ip:<ip>`, `login:acct:<email>`, `queries:user:<id>`, `delegationCode:officer:<id>`); `window_start`; `count`; `locked_until` nullable. Thresholds in 5.6 and 5.2.
- `mock_credential_state`: `user_id`, `source_id`, PK both; `state` (`valid`|`expired`|`rejected`). Read only by the mock adapter.

**Indexes.** `query_request`: UNIQUE (`user_id`, `idempotency_key`) WHERE `part_id = 0`; (`user_id`, `submitted_at`). `source_result`: (`user_id`, `created_at`); (`credential_user_id`, `created_at`); (`status`) for the sweep. `event_log`: (`created_at`). `audit_event`: (`at`), (`actor_user_id`, `at`), (`credential_user_id`, `at`), (`correlation_id`), (`type`, `at`).

**Retention.** Values and payloads are encrypted under a per-request DEK; deleting the `request_key` row crypto-shreds both while the audit trail and metadata stay. `SiteConfig.retention { payloadDays, valuesDays }` exists now and is `null` (keep) for the prototype. `scripts/ops/purge.ts` deletes expired `request_key` rows and writes `retentionPurged`. Schema lands in M2, shredding in M3. Hard deletion of a user row happens only through an ops script after retention; audit rows keep their actor snapshot.

**Seam interfaces.** All code goes through these; each ships a shared contract-test suite that local and future Shared Platform implementations must pass.

```
interface AuditService {
  record(tx: Tx, event: AuditEvent): Promise<{ id: number }>   // same txn as the change it audits; throws -> caller rolls back
}
interface IdentityService {
  resolve(req: Request): Promise<Principal | null>             // standalone: Better Auth session; embedded: host JWT (5.6)
}
Principal { userId, email, role, sessionId, identitySource: "local" | "host", hostSubject? }
interface EventBus {
  publish(userId: string, event: WsEvent): void                // called only after the event_log row commits
  subscribe(userId: string, handler: (e: WsEvent) => void): () => void
}
interface EntityStore {                                        // FR-061 write-back, B6 later; local impl rejects NotImplemented
  appendSupplemental(principal: Principal, target: { recordType: string, recordId: string }, resultIds: string[]): Promise<void>
}
```

**Scale limit.** Single node is a hard limit: one process, one SQLite file, in-process dispatcher and `EventBus`, no horizontal scaling and no planned Postgres move. The NFR-002 ceiling is the dispatch caps (32 source calls in flight, 4 per source, 30 submits per minute per user), sized for tens of concurrent users [open]. Risk in 14.

Covers FR-061 (interface only), FR-062, FR-063, SEC-010, SEC-013, SEC-021, PLT-001 to PLT-005, PLT-008.

## Writer notes (remove at assembly)

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
