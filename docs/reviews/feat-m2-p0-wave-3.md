---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "7cdd0c1aa2cb948c8e255a7c63bf2c6121ffe792"
verdict: "approve"
---

# Review: feat/m2-p0-wave-3

Date: 10-16-26. Critical slice (Opus 5.5 high); the gate slice ran first in the same run and approved with no open critical or important finding.

## Scope

Branch feat/m2-p0-wave-3, range ee8a95217c6b4be10d1296b0b70f62e5dbdb8d95..7cdd0c1aa2cb948c8e255a7c63bf2c6121ffe792. The wave delivers the M2 audit catalogue (#523: roleChanged.fromRole, sessionRevoked.targetUserId, passwordChanged with its change-password writer, and the auditViewed, auditExported and adminViewed contracts for M2 P2), the request-key versioning ruling D-M2P0-3 option A (#524), the publish note and publisher name in the admin config contract (#507, #525), the #622 route contract minors, and the gate docs. Critical files reviewed in full: packages/api/src/keys/request-keys.ts, packages/core/src/contracts/audit.ts, packages/core/src/contracts/audit-auth.ts.

## Findings summary

- Critical: 0. Important: 0. Minor: 4 (listed below).
- Rulings kept as stands: D-M2P0-3 option A (key_version records the wrapping DATA_KEY version and is bound into the AAD); passwordChanged audit failure (session deleted, ids-only log, fixed error; double-failure residual accepted for P0 as for sign-in AUD-2); sessionRevoked.targetUserId is a BoundedId, not a Uuid7; #622 malformed correlation id is 404.
- Controller rulings: none needed in this slice.

## Cross-cutting checks

1. packages/core/src/contracts/admin-audit.ts (risk: stored pre-M2 rows fail the read schema; import cycle from the new audit.ts import). AuditReadRowSchema is loose (details any record), so old rows parse; admin-audit.ts imports only zod and primitives, so no cycle.
2. packages/api/src/auth/routes.ts changePassword (risk: row on a failed change, password in a log, fail-open audit). The row is written only after res.ok; on failure the caller's session is deleted and ended, the log holds ids and error names only, the answer is the fixed internal error; revokeOtherSessions is refused, so no new session cookie can escape.
3. Writers and readers of the changed schemas (risk: a writer missing a required field; a stored-row reader using the writer schema). All writers (users.ts setUserRole and revokeSession, grant-role.ts, routes.ts changePassword) set the new fields; AuditEventSchema.parse runs only at write time in audit/service.ts; parseAuditDetails reads only the unchanged acknowledged type.

## Answers to the controller's questions

1. No writer can emit roleChanged without fromRole or sessionRevoked without targetUserId: both are required in the writer schemas (audit-auth.ts:59, :75), AuditService parses every row before insert, and every writer sets them (users.ts:265, :330; grant-role.ts:81). Pre-M2 stored rows parse through AuditReadRowSchema (tested). No reader of stored rows parses with the writer schema.
2. passwordChanged is written only after res.ok (routes.ts:244); a failed change writes none. On an audit write failure the caller's session is deleted (routes.ts:257) and ended when the delete succeeded (routes.ts:258), the log carries ids and error names only (routes.ts:259-265), and the answer is the fixed internal error (routes.ts:266). No password, hash or body can reach a log line or the strict details. The double-failure residual is exactly the ruled one and no wider.
3. auditViewed, auditExported, adminViewed and passwordChanged are strict, value-free (see minor m1) and named as spec 4.7 lines 650, 662, 693 and 694. Actor rules: self change by the target user, adminReset by an admin, audit reads and exports by an admin, adminViewed by an admin or a non-system credential owner. adminReset is written by no route (the only writer hard-codes via self, routes.ts:252).
4. The request-keys comment matches the code: key_version is bound into requestKeyAad (request-keys.ts:71-76) and REQUEST_KEY_VERSION = CURRENT_KEY_VERSION (request-keys.ts:21). The new test fails if the version is dropped from the AAD (the literal AAD check, the open with the versioned AAD, and the relabeled-row refusal all break).

## Remaining Minors

- m1: auditViewed and auditExported filters.type is a free BoundedId (audit.ts:109); an admin-typed id-shaped value could land in an audit row. M2 P2: audit it as AuditEventTypeSchema and reject an unknown type with 400 before auditing.
- m2: adminViewed keeps correlationId in details only (audit.ts:323-327, adminEnvelope forbids the envelope column), so a correlation id search on the envelope column misses admin views. M2 P2: allow the envelope correlationId equal to details for adminViewed, or have the filter match details.
- m3: the audited cursor is base64url only (audit.ts:119) while AdminAuditQuerySchema.cursor accepts any string; a P2 route echoing a client cursor would fail closed with 500. M2 P2: validate the cursor alphabet at query parse.
- m4: the non-query early-return chain in AuditEventSchema (audit.ts:583-597) now has 13 clauses; a positive check of the query types would be shorter and fail safe on new types.
