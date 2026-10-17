---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "831c5d2d107320ef430a904147d5f8a3333d96db"
verdict: "approve"
---

# Review: fix/m2-audit-debt-690

Date: 10-17-26. Critical slice (the only slice this run), Opus 5.5 high.

## Scope

Branch fix/m2-audit-debt-690, range 5132459360d95e32a204be4d4d87ecedcdeb7989..831c5d2d107320ef430a904147d5f8a3333d96db. The wave delivers #690 PR-1, boxes m1 to m4: one compile-time exhaustive per-type table (`AUDIT_TYPE_RULES`) driving the audit actor rule and the query or non-query scope (m4); adminViewed carries the viewed request's correlationId in the envelope, equal to details (m2); the admin audit `type` filter and `cursor` validated with the audited schemas (m1, m3); `AUDIT_PAGE_MAX_LIMIT` moved into audit.ts to avoid an import cycle; plus a #317 C-m1 replay driver-error test. Critical file reviewed: `packages/core/src/contracts/audit.ts`.

## Findings summary

- Critical: 0. Important: 0. Minor: 3 (listed below).
- Ruling on #690 option A (two PRs) kept as stands: passwordChanged hardening stays in PR-2.
- Manager ruling on m2 (envelope correlationId required and equal to details) kept as stands; implemented at audit.ts:414 and 558-564.
- No controller rulings were needed in this run.

## Cross-cutting checks

1. A reader, writer or event_log path treating a correlation-id row as a query row: the writer stores `correlationId ?? null` (packages/api/src/audit/service.ts:21); no migration CHECK ties correlation_id to type; the only correlation-id read (packages/api/src/queries/admission.ts:139) also filters type acknowledged. No breakage; no adminViewed writer exists yet.
2. Import cycle or stale importer after moving `AUDIT_PAGE_MAX_LIMIT`: audit.ts imports nothing from admin-audit.ts; no other importer of the constant; the contracts index has no duplicate export.
3. The new table lookup throwing or failing open on a malformed row: a probe at head showed unknown, prototype-named and missing types, bad details and bad actors all return a Zod failure without running the superRefine. Fail closed holds.

## Answers to the controller's questions

1. m4: exhaustive at compile time through the mapped type over `AuditEventType` (audit.ts:611). Every existing type keeps its exact previous actor rule and message: system types by the system actor; configPublished admin or implementer; userCreated, userDisabled, auditViewed, auditExported admin; sessionRevoked, roleChanged, passwordChanged and adminViewed branch as before; query and login or logout types any actor. The cast in `actorIssueOf` (audit.ts:680-682) is sound: the lookup key is `e.type`, and the mapped type pins the rule at key T to events of type T.
2. Yes: the six query types are `scope: "query"` (audit.ts:612-617), the other 14 `nonQuery`, matching the old 14-type early return; the gate is audit.ts:566.
3. Yes: envelope correlationId required (audit.ts:414) and equal to details (audit.ts:558-564); partId and credentialUserId stay never. No existing reader, writer or event_log path breaks (cross-cutting check 1).
4. Yes: route `type` and `cursor` are the audited `AuditEventTypeSchema` and `AuditCursorSchema` (admin-audit.ts:25, 43; audit.ts:112, 123); the other echoed fields and the window and limit bounds line up, so any accepted query echoes into auditViewed and auditExported. No import cycle.

## Remaining Minors

- audit.ts:322-326 and 399-401: comments still say adminViewed's envelope correlationId stays empty and admin rows carry no request; reword for #690 m2.
- audit.ts:99-105: `AUDIT_PAGE_MAX_LIMIT` sits between the AuditFiltersSchema doc block and the schema; move it above the doc block.
- audit.ts:611: `AUDIT_TYPE_RULES` is exported unfrozen; `Object.freeze` the table and entries as defense in depth (optional).
