---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "542a91cec08b15eff7166c9a99cc144c3ae486f6"
verdict: "approve"
---

# Review: feat/core-104

Date: 09-27-26.

## Scope

Branch feat/core-104, range 3e4f66702880813ce39e41af88604330ee247671..542a91cec08b15eff7166c9a99cc144c3ae486f6
(d8e6628, 71b5662, 542a91c). Delivers M0 P1 Track A Task 1 (#104), the auth audit contracts:

- loginSucceeded, loginFailed, logout and roleChanged added to AUDIT_EVENT_TYPES and AUDIT_DETAILS_SCHEMAS, with
  AuditEventSchema variants on an auth envelope whose partId and credentialUserId are `z.never().optional()`.
- ClientIpSchema `^[0-9A-Za-z:.%_-]{1,64}$`; sessionId on loginSucceeded and logout is Uuid7Schema (the session row
  id, never the token); ids use BoundedIdSchema and lockoutUntil uses EpochMsSchema.
- The auth early return in the superRefine sits after the actor/identitySource, SYSTEM_ACTOR and hostSubject checks.
- The auth contracts are exported from `@querymodule/core/contracts`.
- `.github/sensitive-paths` lists audit-auth.ts under Audit logging (critical); plan carry-forwards for Task 16
  (clientIp() maps any value failing ClientIpSchema to "unknown") and Task 17 (audited sessionId differs from the
  token); plan Task 11 fixtures use a UUIDv7 sessionId.

## Findings summary

- Round 2 review of 71b5662: Critical 0, Important 2, Minor 2. All four resolved in 542a91c and verified on
  re-review.
- I1 (auth schemas and ClientIpSchema not exported from the package entry): fixed by `export * from "./audit-auth"`
  in packages/core/src/contracts/index.ts, with a test importing from `./index` (RED then GREEN).
- I2 (plan Task 11 logout fixture used sessionId "s1", which Uuid7Schema rejects): fixed by replacing the literal at
  plan lines 1577, 1582 and 1589 with a UUIDv7.
- No ruling kept as stands. Controller ruling applied: the developer's Option A adjusted ruling on #104 (never-keys,
  ClientIpSchema charset, Uuid7Schema sessionId, early-return order test), verified in round 2.

## Cross-cutting checks

1. packages/core/package.json exports: `./contracts` maps to `src/contracts/index.ts`, so the Task 16 import of
   ClientIpSchema resolves.
2. Star-export collisions: the six names added to the barrel are declared only in audit-auth.ts; typecheck exits 0.
3. Other plan fixtures writing a sessionId through AuditService: Task 17 uses session row ids (uuidv7); none uses a
   non-UUID literal in a step still to run.

## Answers to the controller's questions

1. `z.never().optional()` accepts an absent key, rejects any value, keeps `z.toJSONSchema` working with default
   options (emits `{ not: {} }`, now asserted by test), and lets Task 11's `e.partId ?? null` compile unchanged.
2. Uuid7Schema for sessionId is safe for every session row the plan and spec define (Task 14 generateId is uuidv7;
   Task 15 and Task 17 use the row id). Residual risk: hand-inserted session rows or a Better Auth change to
   generateId would fail closed; the Task 17 carry-forward test would catch it.
3. ClientIpSchema accepts every value Task 16 clientIp() can return (up to the 61-character IPv4-mapped IPv6 with a
   15-character zone, now tested along with the 64-character boundary) and rejects header punctuation.

## Remaining Minors

- plan:207-219, the ticked Task 1 history block, still shows sessionId "s1"; it documents the already-implemented
  step and is not run again.
- The CLAUDE.md sensitive-area line for audit-auth.ts is deferred to a chore PR whose home the controller should
  confirm; it does not change the review tier.
