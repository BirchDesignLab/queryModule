---
date: 09-26-26
status: accepted
track: core
phase: m0-p0
supersedes: ["spec 4.7"]
---

# 0003 Audit partId in envelope and details

## Context

Spec 4.7 (Audit events) says the envelope columns carry `part_id?` among others and that "`details` repeat none of these". The same section's query-event table requires `partId` in the `details` of `submitted`, `sourceDispatched`, `sourceResponded`, `interrupted` and `partSkipped`. The two statements conflict, and the six query event schemas freeze at the M0 P0 gate (SEC-010 to SEC-013), after which details schemas are additive-only. If both copies exist unchecked, one audit row can carry two different part ids.

## Options

1. Drop `partId` from details and rely on the envelope column: follows the prose rule; breaks the table and the P0 brief, and leaves `partId` optional on part-scoped rows.
2. Keep `partId` only in details and forbid it on the envelope for those types: follows the table; loses the indexed `part_id` column for part-scoped rows.
3. Keep both, require the envelope `partId` for part-scoped types and require it to equal `details.partId`: follows the table and keeps the column; cost is one equality check.

## Decision

Option 3. For `submitted`, `sourceDispatched`, `sourceResponded`, `interrupted` and `partSkipped`, the envelope `partId` is required and must equal `details.partId`. `acknowledged` keeps an optional envelope `partId` and no `partId` in details. `AuditEventSchema` in `packages/core/src/contracts/audit.ts` enforces both rules, so `AuditService.record` (spec 5.5) rejects a row that breaks them.

## Consequences

- `AuditService.record` callers set `partId` on the envelope and in details for part-scoped types, with the same value.
- Details schemas stay additive-only; this decision adds no details field.
- Spec 4.7 carries `Overridden by ADR-0003.` under its heading.
