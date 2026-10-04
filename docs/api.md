# API reference

The HTTP and WebSocket contract of the Query Module API, as of M1 (BR-005).

This page is written by hand. The source of truth is
[`packages/api/openapi.json`](../packages/api/openapi.json), which is generated from the route
contracts in `packages/core/src/contracts/routes.ts` and checked in CI (`pnpm gen:check`). If this
page and `openapi.json` disagree, `openapi.json` wins; the test
`packages/api/test/docs-reference.test.ts` fails when a route, an error code or a WebSocket message
is missing from this page (decision D-A18).

Mock data only. The prototype never connects to real state or national systems. The examples below
use placeholder values.

## Conventions

- **Base path.** `/api/v1`. Every route below is under it.
- **Sessions.** A signed-in browser holds a session cookie set by the auth routes. "Session" in the
  table means a live session; "public" means no session. A native client may send
  `Authorization: Bearer` on the WebSocket upgrade (see "WebSocket").
- **`X-Requested-With: querymodule`.** Required on every state-changing request (POST, PUT, DELETE)
  except the Better Auth sign-in routes. Without it the answer is `403 forbidden`. GET requests do
  not need it. (Spec 5.9.)
- **`X-Background: 1`.** Optional. A request that carries it does not extend the session idle clock.
  The web app sets it on its 15 second config refresh and its health poll.
- **Body cap.** 32 KiB for every route, `413 payloadTooLarge` above it. The admin draft save and
  validate routes take up to 256 KiB, because a whole config document can pass 32 KiB.
- **No cache.** Every `/api/*` response carries `Cache-Control: no-store`.
- **Errors.** Every non-2xx answer that carries a body uses the `ApiError` shape (below).
- **Feature gates.** The admin routes sit behind site features (`adminConfig`, `adminUsers`). With
  the feature off the route answers `404 notFound` to every caller, although the route table below
  (from `openapi.json`) does not list that 404 per route. The shipped default site turns both on.
- **Forced password change.** A user created by an admin holds a temporary password. Until they
  change it, every session route answers `403 passwordChangeRequired`, and the WebSocket upgrade is
  refused with HTTP 403. Only the auth routes work (D-A26).

## Routes

Access levels:

| Access | Who may call |
|---|---|
| public | anyone |
| session | any signed-in user (the `implementer` role is refused on `POST /queries`, see below) |
| sessionOwn | any signed-in user, for their own row only |
| configEditor | `admin` or `implementer` |
| admin | `admin` only |

"X-Requested-With" is `yes` when the header is required. "M1" is the status in this milestone:
`live` means the handler is merged and answers as listed.

| Method | Path | Access | X-Requested-With | M1 | Responses |
|---|---|---|---|---|---|
| GET | `/api/v1/health` | public | no | live | 200 |
| GET | `/api/v1/meta` | public | no | live | 200 |
| GET | `/api/v1/locales/{locale}` | public | no | live | 200, 400, 404 |
| GET | `/api/v1/config` | session | no | live | 200, 401, 403 |
| GET | `/api/v1/me/preferences` | sessionOwn | no | live | 200, 401, 403 |
| PUT | `/api/v1/me/preferences` | sessionOwn | yes | live | 200, 400, 401, 403 |
| POST | `/api/v1/queries` | session | yes | live | 202, 400, 401, 403, 409, 413, 429, 500, 503 |
| GET | `/api/v1/admin/config` | configEditor | no | live | 200, 401, 403 |
| PUT | `/api/v1/admin/config/draft` | configEditor | yes | live | 200, 400, 401, 403, 409, 413 |
| POST | `/api/v1/admin/config/validate` | configEditor | yes | live | 200, 400, 401, 403, 413 |
| POST | `/api/v1/admin/config/publish` | configEditor | yes | live | 200, 400, 401, 403, 404, 409 |
| GET | `/api/v1/admin/config/versions` | configEditor | no | live | 200, 401, 403 |
| POST | `/api/v1/admin/config/versions/{version}/rollback` | configEditor | yes | live | 200, 400, 401, 403, 404, 409 |
| GET | `/api/v1/admin/config/versions/{version}/export` | configEditor | no | live | 200, 400, 401, 403, 404 |
| GET | `/api/v1/admin/users` | admin | no | live | 200, 401, 403 |
| POST | `/api/v1/admin/users` | admin | yes | live | 201, 400, 401, 403 |
| POST | `/api/v1/admin/users/{id}/disable` | admin | yes | live | 200, 400, 401, 403, 404, 409 |
| PUT | `/api/v1/admin/users/{id}/role` | admin | yes | live | 200, 400, 401, 403, 404, 409 |
| GET | `/api/v1/admin/users/{id}/sessions` | admin | no | live | 200, 400, 401, 403, 404 |
| DELETE | `/api/v1/admin/sessions/{sessionId}` | admin | yes | live | 204, 400, 401, 403, 404 |

The contract file still marks the first six rows (`health` to `PUT /me/preferences`) with the
status `planned`; their handlers are merged and tested (`packages/api/test/routes.test.ts`,
`preferences.test.ts`), so this page lists them as live.

What each route does:

| Route | Summary |
|---|---|
| `GET /health` | Liveness for the Docker healthcheck. Body `{ "status": "ok" }`, no data. |
| `GET /meta` | `apiVersion`, `coreVersion`, `configSchemaVersion`, `configHash` and `minClientVersion` (null when unset). The client refuses to run below `minClientVersion`. |
| `GET /locales/{locale}` | A locale bundle of UI strings. `400 validationFailed` for a malformed locale, `404 notFound` for a well-formed locale the site does not list. |
| `GET /config` | The `ClientSiteConfig` allowlist. Never carries `Source.server`, `auth`, `retention`, `extends` or mock data. |
| `GET /me/preferences` | The caller's own preference row: `themeMode`, `personaOverride`, `layout`. Each is `null` when unset. |
| `PUT /me/preferences` | Replaces the caller's own row. |
| `POST /queries` | Submit a query. See "Submitting a query". |
| `GET /admin/config` | The live config version and the shared draft (or `null`), each with its document. |
| `PUT /admin/config/draft` | Save the shared draft. The body names the `baseVersion`, which must be the live version, else `409 draftConflict`. |
| `POST /admin/config/validate` | Run the config validation chain on a document and return `errors[]` and `warnings[]`, each at its JSON pointer. Does not save. |
| `POST /admin/config/publish` | Publish the draft named by `draftVersion` and make it live in the same step. Refused with `400 validationFailed` when the draft has any validation error. |
| `GET /admin/config/versions` | Version history, newest first. Rows are never rewritten. Capped at 1000, not paged. |
| `POST /admin/config/versions/{version}/rollback` | Publish an older version's document as a new version. The draft is left as it is, so its base is then stale. |
| `GET /admin/config/versions/{version}/export` | One version document as JSON, for the git round trip. |
| `GET /admin/users` | Users with role, state and sign-in counts (see "Admin users"). No secrets. |
| `POST /admin/users` | Create a user from `email`, `name` and `role`. The response carries a one-time `temporaryPassword`, shown once. |
| `POST /admin/users/{id}/disable` | Disable a user and delete their sessions in one transaction. Open sockets close. |
| `PUT /admin/users/{id}/role` | Change a user's role. |
| `GET /admin/users/{id}/sessions` | A user's live sessions by row id. Never tokens. |
| `DELETE /admin/sessions/{sessionId}` | Revoke one session. `204` with no body. |

### Auth routes

The auth routes are under `/api/v1/auth/` and are not part of `openapi.json`. The ones the web app
uses are `POST /auth/sign-in/email`, `POST /auth/sign-out`, `GET /auth/get-session` and
`POST /auth/change-password`. Sign-out and change-password need `X-Requested-With: querymodule`.
Sign-in is rate limited per account and per client address (see the demo runbook, "If something goes
wrong"). Authentication is by session cookie; there are no tokens in query strings.

### Submitting a query

`POST /api/v1/queries` with the headers `X-Requested-With: querymodule`, `Content-Type:
application/json` and `Idempotency-Key`. The key is 16 to 128 URL-safe characters
(`A-Z a-z 0-9 _ -`); a UUID fits. The same key from the same user returns the original
acknowledgment, so a retry never runs the query twice.

Body (all keys required, unknown keys are rejected):

```json
{
  "queryType": "VEH",
  "values": { "plate": "ABC123", "state": "TX" },
  "sourceIds": ["stateSource", "nationalSource"],
  "mode": "normal",
  "configHash": "<the configHash from GET /config, 64 hex characters>"
}
```

- `values` maps field keys to a string (up to 4096 characters), number, boolean or `null`.
- `sourceIds` has 1 to 8 entries.
- `mode` is `normal` or `plateOnly`.
- `configHash` is the hash of the config the form was built from. If the live config has changed,
  the answer is `409 configHashMismatch` with `currentConfigHash` in `params`; the client refetches
  the config and asks the user to check the form.

Answer `202 Accepted`, once the request is recorded:

```json
{
  "correlationId": "<UUIDv7>",
  "acknowledgedAt": 1790000000000,
  "parts": [
    {
      "partId": 0,
      "queryType": "VEH",
      "status": "dispatched",
      "sourceIds": ["stateSource", "nationalSource"],
      "droppedSourceIds": []
    }
  ]
}
```

`acknowledgedAt` is epoch milliseconds. There is one part per planned query: the query itself is
part 0 and each nested "also run" query follows (at most 4). A nested part can have the status
`skipped`.

**M1 ends here.** In M1 the 202 is the end of the submit: the request, its parts and the audit row
are recorded, but nothing is sent to a source and no result comes back. Dispatch, the mock adapter
at runtime and source answers land in M2 P0.5 (ADR-0012). Until then the recorded source rows stay
`pending`.

Other answers:

| Status | Code | When |
|---|---|---|
| 400 | `validationFailed` | Malformed body, a field value that fails its rules, or a plan that cannot run. `errors[]` lists each problem by message key and field, never by value. |
| 401 | `unauthenticated` | No session. |
| 403 | `forbidden` | The query type or a source is not allowed for the caller, or the role is `implementer` (config only). |
| 403 | `passwordChangeRequired` | The temporary password is not yet changed. |
| 409 | `configHashMismatch` | Stale `configHash`. |
| 413 | `payloadTooLarge` | Body over 32 KiB. |
| 429 | `rateLimited` | More than 30 submits per user per minute. `Retry-After` carries the seconds. |
| 500 | `internal` | Nothing was acknowledged. |
| 503 | `unavailable` | The server is shutting down or not ready. |

### Admin config

The stored version is the live config (ADR-0011). One shared draft exists per site. The flow is
`GET /admin/config` (read live and draft), `PUT /admin/config/draft` (save), `POST
/admin/config/validate` (check), `POST /admin/config/publish` (go live), then `GET
/admin/config/versions` and `POST .../rollback` for history. The document shape is:

```json
{
  "siteConfig": { "...": "raw SiteConfig JSON" },
  "locales": { "en": { "field.plate": "Plate" } },
  "mock": { "...": "present only where ALLOW_MOCK_SOURCES is true" }
}
```

A version row (`ConfigVersion`) has `id`, `version`, `status` (`draft`, `published` or
`superseded`), `configHash` (set at publish), `baseVersion`, `createdBy`, `createdAt`,
`publishedBy`, `publishedAt` and `rollbackOf`. A publish takes effect for open dispatcher forms
within 15 seconds: clients refetch `GET /config` on that interval and on window focus.

A validation diagnostic is `{ level, path, key, params }`. `path` is a JSON pointer into the
document, `key` is a message key, and `params` never carries a value from the document.

### Admin users

A user row (`AdminUser`) has `id`, `email`, `name`, `role`, `disabled`, `mustChangePassword`,
`createdAt` and three sign-in figures taken from the audit:

- `signInCount`: the number of successful sign-ins.
- `lastSignInAt`: epoch milliseconds, or `null` when the user never signed in.
- `distinctIps`: how many different client addresses signed in. This is a count only. No address
  value ever leaves the audit.

Roles are `user`, `trainingOfficer`, `admin` and `implementer`. `implementer` edits and publishes
site config only. `admin` manages users and sessions and may also edit config.

Rules the user routes enforce:

- The server generates the temporary password. An admin never chooses one. It is in the `201`
  response of `POST /admin/users` and nowhere else; it is never logged and never shown again.
- The new user must change it at first sign-in, until then `403 passwordChangeRequired`.
- An admin cannot change their own role or disable their own account, and the last enabled admin
  cannot be demoted or disabled: `409 lastAdmin`.
- `POST /admin/users` answers `400 validationFailed` with the key `validation.emailTaken` when the
  email is already used.

## Errors

Every error body has this shape:

```json
{
  "error": {
    "code": "validationFailed",
    "params": { "currentConfigHash": "<hash>" },
    "errors": [{ "key": "validation.required", "params": { "field": "plate" } }],
    "correlationId": "<UUIDv7, when a query was acknowledged>",
    "requestId": "<UUIDv7>"
  }
}
```

`params`, `errors` and `correlationId` are optional; `requestId` is always present. Params and
`errors[]` carry keys, field names, positions and counts, never a submitted value, a credential or
payload text.

| Code | HTTP status | Meaning |
|---|---|---|
| `validationFailed` | 400 | Malformed input or failed validation; `errors[]` lists each problem. |
| `unauthenticated` | 401 | No live session. |
| `stepUpRequired` | 403 | Reserved for step-up authentication; no M1 route returns it. |
| `mfaEnrollmentRequired` | 403 | Reserved for MFA (M3); no M1 route returns it. |
| `forbidden` | 403 | Role not allowed, or `X-Requested-With` missing on a write. |
| `notFound` | 404 | No such resource, or the route's feature is off for the site. |
| `configHashMismatch` | 409 | The submit was built from an older config; `params.currentConfigHash` names the live one. |
| `delegationCredentialsMissing` | 409 | Reserved for delegated credentials; no M1 route returns it. |
| `draftConflict` | 409 | The draft or publish base is not the live version, or the live version changed during a rollback. |
| `lastAdmin` | 409 | The change would leave the site with no enabled admin, or an admin changed their own role or account. |
| `passwordChangeRequired` | 403 | An admin-created user must change the temporary password first. |
| `payloadTooLarge` | 413 | Body over the cap. |
| `rateLimited` | 429 | Too many requests; `Retry-After` carries the seconds. |
| `internal` | 500 | Unexpected failure; nothing is exposed. |
| `unavailable` | 503 | Shutting down or not ready. |

## WebSocket

One socket per signed-in client at `GET /api/v1/ws` (upgrade). Messages are JSON text frames, each
with `"v": 1` (the protocol version) and a `type`. Frames over 4096 bytes close the socket.

**Upgrade checks**, cheapest first, before any socket exists: the path must be exactly
`/api/v1/ws` with no query string (`400` otherwise, so no token ever rides in a URL); at most 60
upgrades per client address per minute (`429` with `Retry-After`); the `Origin` must be the site's
own (`403`), or absent with an `Authorization: Bearer` header; a live session (`401`); and no
pending forced password change (`403`).

**Heartbeat.** The client sends `ping` about every 20 seconds. The server answers `pong` with the
same `nonce` and its own `serverTime`. A socket with no ping for 60 seconds is closed with code
4000. A ping also checks that the session is still live.

**Close codes.**

| Code | Meaning |
|---|---|
| 4001 | The session ended: sign-out, expiry, revocation or the user was disabled. |
| 4000 | No ping for 60 seconds. |
| 1008 | A frame that does not parse as a client message. |
| 1001 | The server is shutting down. |

**Messages.**

| Message | Direction | M1 status |
|---|---|---|
| `hello` | client to server, `{ lastSeq: int or null }` | live. The server answers `welcome`. |
| `welcome` | server to client, `{ latestSeq }` | live. `latestSeq` is always 0 in M1; the real value arrives with `event_log` (M2 P0.5). |
| `ping` | client to server, `{ nonce }` (1 to 64 characters) | live. |
| `pong` | server to client, `{ nonce, serverTime }` | live. |
| `ackReceipt` | client to server, `{ correlationId, receivedAt }` | accepted and ignored. The metric is recorded from M2 P1. |
| `sourceStatus` | server to client, `{ seq, at, correlationId, partId, sourceId, resultId, status }` | planned. The contract and the event bus exist; nothing publishes it until dispatch lands (M2 P0.5), and replay by `lastSeq` follows with the feed (M2 P1). |

The web app uses the socket in M1 for the heartbeat shown on the Status page.
