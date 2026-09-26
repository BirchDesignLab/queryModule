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

`ValidationError` is `{ key, params }` (see 4.7). Every function returns all errors it finds, never only the first.

**Grammar.** The delimiter is site-level, `siteConfig.terminal.delimiter` (default `.`). There is no per-command delimiter. Input is split on the delimiter; the first token is the command code, matched case-insensitively. The remaining tokens fill `CommandDef.positions` in order. `validateSiteConfig` rejects command codes that collide after case folding.

```
CommandDef { code, queryType, presets?: { [fieldKey]: value },
             positions: (fieldKey | { field: fieldKey, rest: true })[] }
```

- `presets` set user values before positions are read. This is how a command selects type-level fields (`role: "type"`, see 4.1); positions may also include type fields.
- Values are trimmed. Trailing empty tokens are ignored, so `VEH.ABC123...` equals `VEH.ABC123`.
- An empty interior position leaves the user value empty; the rules engine then fills the field's configured default as its effective value (FR-054, 4.3).
- More non-empty positional tokens than positions is `tooManyPositions`.
- Only the last position may be `{ field, rest: true }`, and only for a free-text string field. It takes the remainder of the input verbatim, delimiters included. Named tokens are not recognised after a rest position has been reached [open].
- There is no escape or quote syntax. A delimiter inside any other value cannot be typed; `formatCommand` reports `delimiterInValue` for such a value (see below).
- Trailing named tokens `fieldKey=value` set any field of the query type, for example `VEH.ABC123.OK.plateType=PC`. A token is named when the text before its first `=` matches a field key of the command's query type, case-insensitively; otherwise it is positional. A positional token after a named token is `positionalAfterNamed`. An unknown key is `unknownField`. A named token for a field that is also positioned or preset in the same command is `duplicateField` [open].

**Values by dataType.** The terminal produces raw strings; canonicalisation per dataType happens in core before rules on both the form and terminal paths (4.3). The terminal syntax per dataType:

| dataType | Accepted tokens | `formatCommand` emits |
|---|---|---|
| `string` | any text without the delimiter (rest position excepted); `transform` and whitespace collapse applied by canonicalisation | the user value |
| `picklist` | a code, case-insensitive against enabled codes; otherwise `notInPicklist` | the canonical code |
| `date` | `FieldDef.inputFormats` (default `MMDDYYYY`, `MM/DD/YYYY`, `MM-DD-YYYY`, `YYYY-MM-DD`); stored as ISO `YYYY-MM-DD` | `FieldDef.outputFormat` (default `MMDDYYYY`) |
| `year` | two or four digits; two-digit years resolve by `FieldDef.century` (4.1, 11) | four digits |
| `boolean` | `Y`, `N`, `1`, `0`, `true`, `false`, case-insensitive | `Y` or `N` [open] |
| `number` | `integer`: optional `-` then digits; `decimal`: integer part with optional `.` fraction | canonical number |

`validateSiteConfig` rejects a date `outputFormat` that contains `terminal.delimiter`, and a `decimal` number field in a command position when `terminal.delimiter` is `.` [open]. `century: "past"` (for DOB) resolves a two-digit year to the most recent year not after today, and applies to year fields and to any two-digit-year token a site adds to `inputFormats`. Dates display as MM-DD-YY in the UI (6.2); the terminal format is independent of display.

**Errors.** `tokenize` always returns the values it could read, even when it returns errors. `parseCommand` runs `tokenize`, canonicalisation and `evaluateForm`, so required and constraint errors come from the same engine as the form. Error keys:

| Key | Params | When |
|---|---|---|
| `terminal.emptyInput` | | input is blank |
| `terminal.missingDelimiter` | `input` length only | no delimiter in the input and the input is not a command code |
| `terminal.unknownCommand` | `code` | code matches no `CommandDef` (FR-055) |
| `terminal.tooManyPositions` | `expected`, `got` | more non-empty positional tokens than positions |
| `terminal.positionalAfterNamed` | `position` | positional token after a named token |
| `terminal.unknownField` | `name` | named token key is not a field of the query type |
| `terminal.duplicateField` | `field`, `labelKey` | field set by both position or preset and a named token |
| `terminal.valueForHiddenField` | `field`, `labelKey`, `position?` | a value lands in a field the rules hide; the value is kept in the draft, not dropped, and blocks submit |
| `terminal.delimiterInValue` | `field`, `labelKey`, `position` | from `formatCommand`: a non-rest value contains the delimiter |
| `field.required` | `field`, `labelKey`, `position?` | required field empty with no default (FR-055); `position` names where to type it, absent when only a named token can set it |
| constraint keys from 4.3 | `field`, `labelKey`, constraint params | `notInPicklist`, `invalidDate`, `minLength`, `maxLength`, `pattern`, and so on |

Error params never carry the typed value; they carry field keys, label keys, positions and lengths, so errors can be logged and audited (see 4.7).

**Command config checks** (in `validateSiteConfig`, 4.1): a field that is unconditionally required and has no position, preset or configured default is an error; a field that some rule can make required and has no position is a warning (a named token can still supply it). Tested with `VEH.ABC123.OK` against the Appendix B plate rules: with `plateType` required when State is not the default, the result is `field.required` for `plateType` with no position, and `VEH.ABC123.OK.plateType=PC` succeeds.

**Draft merge.** Terminal edits never replace the draft. On each parse, the command's preset fields, positioned fields and named-token fields are written into the draft (an omitted or empty position writes an empty user value); every other user value is left unchanged. A code that selects a different query type switches the draft to that query type's user values, kept per query type by the store (6.7) [open].

**Toggle.** Form to terminal: pick the command whose `queryType` equals the selected query type and whose `presets` all equal the draft's current type-field values; most specific (most matching presets) wins, ties go to config order [open]. No match starts the terminal with an empty string and the draft untouched. `formatCommand` serialises user values only, never effective defaults: presets imply the code, positions are emitted in order, interior empties kept, trailing empties dropped. `unshownCount` counts non-empty user values that are neither positioned nor preset; the terminal shows "n fields not shown" (6.2) and those values stay in the draft. Terminal to form uses `tokenize` and the draft merge, so a failing command loses nothing.

**Round-trip property.** For any draft `D` of query type `T` and command `C` for `T` whose presets match `D`, where every positioned user value is canonical and contains no delimiter outside a rest position: `merge(D, tokenize(formatCommand(C, D)))` equals `D`. Positioned user values survive format then parse exactly; unpositioned user values survive because the merge never erases them. Canonicalisation is idempotent: `canon(canon(v)) = canon(v)`. Both are property tests (10), including delimiter-bearing values in rest positions and date, boolean and number fields (NAM table tests).

Covers FR-050 (component; layout placement in 6.2), FR-051 to FR-056.

### 4.5 Response mapper, assessResult, highlighter

**Mapping selection.**

```
mapResponse(siteConfig, ctx, payload) -> MappedResult
ctx { queryType, partValues: { [fieldKey]: value }, sourceId, persona }
MappedResult { mappingIndex: number | null, elements: RenderElement[], diagnostics: Diagnostic[] }

ResponseMapping { queryType, when?: Condition, sourceId?, persona?,
                  elements: MappingElement[] }
MappingElement =
  | { kind: "value", path, labelKey, view: "summary"|"detail"|"both", format?, highlight?: boolean = true }
  | { kind: "table", path, labelKey, view, highlight?: boolean = true,
      columns: { path, labelKey, format? }[] }
```

A mapping is a candidate when its `queryType` equals the part's query type (required), its `when` holds against the part's effective values (4.2), its `sourceId` is absent or equal, and its `persona` is absent or equal. Score: `when` present and matching +4, `sourceId` match +2, `persona` match +1. Highest score wins. `validateSiteConfig` rejects two mappings with equal keys (`queryType`, `when`, `sourceId`, `persona`); two different `when` conditions that both match at equal score go to the earlier mapping in config order [open]. No candidate yields the generic dump.

**Path language.** Dot segments, `[n]` array index, `["key.with.dots"]` bracket-quoted keys, and `[*]` projection: `warrants[*].offense` yields one value per array element. A `value` element whose path yields an array joins the items with `", "`. A `table` element's `path` must yield an array of records; each column `path` is relative to one record and yields one cell, so offense and date stay paired per row. Table is the UX-016 grid; the summary format is the set of `view: "summary"|"both"` elements, toggled against detail per UX-015.

```
RenderElement =
  | { kind: "scalar", label: { key } | { text }, value: string, view, format, highlight }
  | { kind: "table", label: { key }, view, highlight,
      columns: { labelKey, format }[], rows: string[][] }
```

An element whose path does not resolve, or a table path that yields an empty array, is omitted and adds a `Diagnostic { path, reason }`; the UI shows diagnostics only in development builds [open for empty tables]. `config:validate` resolves every mapping path against each mock default and scenario payload for its (queryType, source) and warns on unresolved paths (5.4, 7).

**Generic dump.** With no candidate mapping, every string, number and boolean leaf becomes a `scalar` with `label: { text: <path> }` and `view: "both"`, in payload order, highlight on. An unmapped result is never blank.

**Formats.** `format` is one of a fixed declarative set with params: `text` (default), `date { pattern }`, `phone`, `upper`, `template { template }`. An unknown format is a `validateSiteConfig` error; there is no format registry.

**Result severity.**

```
assessResult(payload, keywords) -> Assessment
Assessment { severity: "critical"|"warning"|"info" | null,
             matches: { keyword, severity, path }[] }
```

`assessResult` scans every string leaf of the raw payload, independent of the mapping, the element `highlight` flags and the selected view, with the same matching rules as `highlight`. `severity` is the maximum found. Every result card, list row and notification renders a severity badge from it with icon, marker text and colour (6.2, 6.6), so a STOLEN flag mapped `view: "detail"` or not mapped at all still shows on a summary card. Tested in Playwright at 1024x768 with STOLEN in a detail-only path (10).

**Highlighter.**

```
highlight(text, keywords) -> Segment[]
Segment { text, severity?, keyword? }

KeywordStyle { keyword, severity, except?: string[],
               style?: { color?, background?, bold? } }
SiteConfig.keywordSeverityStyles: { [severity]: { color, background, bold, icon, marker } }
```

- Case-insensitive, longest keyword first, on NFC-normalised text [open].
- Word boundaries are Unicode-aware: a match must not be preceded or followed by a letter or digit, implemented as `(?<![\p{L}\p{N}])` and `(?![\p{L}\p{N}])` lookarounds with the `u` flag, never `\b`.
- `except` phrases suppress a match that lies inside an occurrence of the phrase, for example `STOLEN` with `except: ["NOT STOLEN", "RECOVERED STOLEN"]`, and `WANTED` with `except: ["NO WANTS OR WARRANTS"]`. Applies to both `highlight` and `assessResult`.
- The renderer styles a segment from `keywordSeverityStyles[severity]`, with the keyword's own `style` overriding colour, background and bold only. The severity `marker` (text) and `icon` are always rendered next to highlighted text, so severity never relies on colour (6.3).
- An element with `highlight: false` (for echoed input, such as the plate the user typed) renders unsegmented; `assessResult` still scans it.
- `validateSiteConfig` checks that each severity style and each keyword style override meets 4.5:1 contrast between colour and background, and each theme mode's token pairs per 6.5.

Covers FR-060, UX-010, UX-011, UX-015, UX-016.

### 4.6 Query planner

`planRequest(siteConfig, queryType, userValues, selectedSourceIds) -> Plan | PlanError`

```
Plan { mode: "full" | "plateOnly", droppedSourceIds: sourceId[], parts: PlanPart[] }
PlanPart { partId: number,                 // 0 = primary, 1..n = nested, config order
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
4. **Nested parts.** For each `alsoRun` entry whose `when` holds against the primary effective values, in config order: copy primary effective values into the nested type's user values through `fieldMap` (`{ [targetField]: sourceField }`), then run `evaluateForm` for the nested type. Nested sources are the nested type's `sources[]` with `selectedByDefault: true` whose `when` holds against the nested effective values; the parent's selection does not carry over. The plate-only narrowing of step 3 applies to a nested part in `plateOnly` mode, with an empty intersection skipping the part instead of rejecting [open].
5. **Skipped parts.** A nested part whose evaluation fails, or that has no sources, gets `status: "skipped"` with `skipReasons` (`plan.nestedNoSources` for the latter). The primary and other parts proceed. The API audits each skipped part (`partSkipped`, 4.7) and writes no `source_result` rows for it.

Part ids are assigned before `when` filtering is applied to skipped parts, so a part keeps its id when it is skipped; an `alsoRun` entry whose `when` does not hold produces no part [open].

**Limits, enforced by `validateSiteConfig`.** Exactly one nesting level: a query type named in any `alsoRun` must not declare `alsoRun` itself. `fieldMap` is checked both ways: each target field exists on the nested type, each source field exists on the parent type. At most 4 `alsoRun` entries per query type [open: fixed, not configurable]. The per-request cap on total (part, source) pairs (default 8) and the concurrency caps are the API's (5.2).

All parts share one correlation ID; each (part, source) pair gets its own pending `source_result` row, keyed (correlation_id, part_id, source_id), and FR-043 status is reported per part per source (5.2, 5.5).

Covers FR-012, FR-040 to FR-042.

### 4.7 Contracts exported by core

Everything the API, `packages/client` and the host-integration layer must agree on is a Zod schema in `packages/core/src/contracts/`, with the TypeScript type inferred from it. The API validates on write and on send; the client validates on receipt; each schema has tests (10).

**Version constants.**

| Constant | Value | Meaning |
|---|---|---|
| `API_VERSION` | `"v1"` | URL prefix `/api/v1` (5.1) |
| `CORE_VERSION` | package semver | reported by `GET /api/v1/meta` |
| `CONFIG_SCHEMA_VERSION` | `1` | `SiteConfig.version`; `migrateConfig` steps key on it (5.8) |
| `WS_PROTOCOL_VERSION` | `1` | `v` on every WebSocket message |
| `EMBED_PROTOCOL_VERSION` | `1` | postMessage protocol (6.9) |
| `SOURCE_ADAPTER_API_VERSION` | `1` | adapters loaded from `ADAPTER_DIR` declare it (5.4) |

`minClientVersion` in `/meta` is deployment configuration owned by the API, not a core constant [open].

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
| `validationFailed` | 400 | `errors[]` from core: field, terminal and plan keys (4.3, 4.4, 4.6), including `unknownField`, `plan.sourceNotAllowed`, `plan.noPlateOnlySource` |
| `unauthenticated` | 401 | no session, expired session |
| `stepUpRequired` | 403 | credential PUT/DELETE and delegation approval without fresh auth (5.7) [open: status] |
| `mfaEnrollmentRequired` | 403 | `auth.mfaRequired` applies and the user has not enrolled (5.6) [open: status] |
| `forbidden` | 403 | authenticated but role missing, for admin routes |
| `notFound` | 404 | unknown resource, non-owner access (policy function, 5.2), feature-flagged route (5.8) |
| `configHashMismatch` | 409 | submitted `configHash` differs; `params.currentConfigHash`; client refetches config |
| `rateLimited` | 429 | `params.retryAfterSeconds`; also sets `Retry-After` |

Params never contain submitted field values, credentials or payload text. A repeated `Idempotency-Key` is not an error: it returns the original 202 (5.2).

**Source status.**

```
SourceStatus = "pending" | "returned" | "failed" | "timedOut" | "interrupted"
             | "credentialsMissing" | "credentialsRejected"
```

`pending` is the only non-terminal status. A status is written once from `pending` and never changes after (5.2). Clients treat any terminal status as final and ignore a later `pending` for the same result.

**Audit events.** `AuditEventType` is a closed union. Each type has a Zod schema for `details`, validated on every write by `AuditService.record(tx, event)` (5.5). The envelope columns (5.5) carry id (integer ordering), `type`, `at` (epoch ms UTC), `correlation_id?`, `part_id?`, the actor snapshot `{ id, email, role }`, `credential_user_id?`, `identity_source` and host subject for embedded mode (6.9). `details` repeat none of these.

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
| `adminViewed` | `correlationId`, `includeHidden` (boolean), `viewerBasis` (`admin`\|`delegationOwner`) [open: officer reads share this type] |

`credentialOwnerUserId` and `delegationId` are copied from the step-3 snapshot on the pending row (5.2), not resolved again.

Auth events (Better Auth hooks, 5.6):

| Type | Required `details` |
|---|---|
| `loginSucceeded` | `method` (`password`\|`totp`\|`hostJwt`), `sessionId`, `clientIp` |
| `loginFailed` | `targetUserId` (nullable), `reason` (`badPassword`\|`unknownAccount`\|`mfaFailed`\|`lockedOut`\|`hostJwtInvalid`), `clientIp`, `lockoutUntil?` (set when this failure starts a lockout) |
| `logout` | `sessionId` |
| `sessionRevoked` | `sessionId`, `reason` (`userDisabled`\|`admin`\|`expired`) [open: whether idle/absolute expiry is detected and audited] |
| `mfaEnrolled` | `method: "totp"` |
| `mfaDisabled` | `method: "totp"`, `byUserId` |

Credential events (`credential_user_id` in the envelope is the owner):

| Type | Required `details` |
|---|---|
| `credentialsCreated` | `sourceId`, `keyVersion` |
| `credentialsChanged` | `sourceId`, `keyVersion` |
| `credentialsDeleted` | `sourceId`, `reason` (`user`\|`userDisabled`\|`lostKey`) |
| `credentialsInvalidated` | `sourceId`, `keyVersion`, `reason` (`decryptFailed`\|`lostKey`) |

Delegation events (5.7). The Chunk 6 flow replaces `delegationCreated` with request and approval events:

| Type | Required `details` |
|---|---|
| `delegationRequested` | `delegationId`, `purpose`, `traineeUserId`, `traineeSessionId`, `sourceIds`, `durationMinutes` |
| `delegationApproved` | `delegationId`, `purpose`, `traineeUserId`, `officerUserId`, `sourceIds` (as confirmed or narrowed), `durationMinutes`, `expiresAt`, `authMethod` (`freshPassword`\|`totp`) |
| `delegationVerifyFailed` | `officerUserId`, `reason` (`wrongCode`\|`expiredCode`\|`roleMissing`\|`missingCredentials`\|`stepUpFailed`\|`rateLimited`), `missingSourceIds?` |
| `delegationRequestExpired` | `delegationId` |
| `delegationRevoked` | `delegationId`, `revokedByUserId` (nullable for automatic), `reason` (`trainee`\|`officer`\|`admin`\|`sessionEnded`\|`superseded`\|`userDisabled`) |
| `delegationExpired` | `delegationId` |

Admin and ops events:

| Type | Required `details` |
|---|---|
| `roleChanged` | `targetUserId`, `role`, `change` (`granted`\|`revoked`), `via: "grant-role"` |
| `auditViewed` | `filters` (`userId?`, `correlationId?`, `type?`, `from`, `to`), `cursor?`, `rowCount` |
| `auditExported` | `filters`, `rowCount`, `format: "ndjson"` |
| `configLoaded` | `siteId`, `configHash`, `configSchemaVersion`, `coreVersion`, `extendsChain` (site ids) |
| `retentionPurged` | `scope` (`payload`\|`values`), `olderThan` (epoch ms), `requestCount`, `keysDeleted` |
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
- `delegationChanged` goes to both parties' sockets; `viewerRole` says which side the receiver is. Clients refetch `GET /api/v1/delegations` [open: one event type for all delegation transitions].
- The server closes the socket with code 4001 when its session ends (logout, expiry, revocation) and 4003 on a rejected Origin [open: close codes].

Covers SEC-010 to SEC-014, FR-043, FR-062, FR-064, NFR-003, NFR-004 (contract side).

## Writer notes (remove at assembly)

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
