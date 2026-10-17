---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "ef617c1fdf41ab00c90643003b33f4ebbe2a0a32"
verdict: "approve"
---

# Review: fix/m2-audit-debt-690

Date: 10-17-26. Critical slice (the only slice this run), Opus 5.5 high. Re-review after 927fb9d.

## Scope

Branch fix/m2-audit-debt-690, range 5132459360d95e32a204be4d4d87ecedcdeb7989..ef617c1fdf41ab00c90643003b33f4ebbe2a0a32. The wave delivers #690 PR-1, boxes m1 to m4: one compile-time exhaustive per-type table (`AUDIT_TYPE_RULES`) driving the audit actor rule and the query or non-query scope (m4); adminViewed carries the viewed request's correlationId in the envelope, equal to details (m2); the admin audit `type` filter and `cursor` validated with the audited schemas (m1, m3); `AUDIT_PAGE_MAX_LIMIT` moved into audit.ts to avoid an import cycle; a #317 C-m1 replay driver-error test; and ef617c1, which fixes the three minors of the first review. Critical file reviewed: `packages/core/src/contracts/audit.ts`.

## Findings summary

- Critical: 0. Important: 0. Minor: 1 (listed below).
- First review minors C-m-1, C-m-2 and C-m-3 resolved in ef617c1 with no behavior change.
- Ruling on #690 option A (two PRs) kept as stands: passwordChanged hardening stays in PR-2.
- Manager ruling on m2 (envelope correlationId required and equal to details) kept as stands: audit.ts:416, 519, 560-566.
- No controller rulings were needed in this run.

## Cross-cutting checks

1. Purity and tree shaking with the new module-level freeze (packages/core/package.json `"sideEffects": false`): the freeze only touches the module's own object, with no I/O or global mutation, and runs whenever any export of the module is used. Core stays pure.
2. An importer that mutates AUDIT_TYPE_RULES and would now throw: only readers exist (audit.ts:568, 686; audit.test.ts:1201-1216). No writer.
3. Named doubt run at head: audit and admin-audit contract tests, 224 passed; `tsc --noEmit` on packages/core clean.

## Answers to the controller's questions

1. Yes. adminViewed details and admin envelope comments now state the required, equal envelope correlationId (audit.ts:322-327, 400-416); the AuditFiltersSchema JSDoc sits directly above its schema (audit.ts:102-107) with `AUDIT_PAGE_MAX_LIMIT` above it (audit.ts:99-100); the table and each entry are frozen (audit.ts:677-679) with a test (audit.test.ts:1210-1213). No actor rule, scope, message or schema changed.
2. Yes. The freeze is synchronous and local, so core stays pure; the readonly mapped type (audit.ts:613) and AuditTypeRule (audit.ts:601-604) are unchanged, so compile-time exhaustiveness holds; the superRefine reads the table only at parse time (no TDZ). The first review's m1 to m4 answers stand.

## Remaining Minors

- audit.ts:403: reworded admin envelope comment line is 118 characters, over the 100 lineWidth; rewrap it.
