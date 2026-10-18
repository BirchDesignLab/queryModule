---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "bf69854d6da958a44affe4b9ebacb2e98e2c0262"
verdict: "approve"
---

# Review: feat/m2-a-p2-wave-2 (M2 P2 Lane A, wave AW2)

Date: 10-18-26.

## Scope

Branch feat/m2-a-p2-wave-2, range 392b662741bb6670cb3f2d6ffb6c9c13b0f9ee0b..bf69854d6da958a44affe4b9ebacb2e98e2c0262. Two tier slices in one run: gate (Opus 5.5 medium, packages/api/src/app.ts mount) and critical (Opus 5.5 high).

The wave delivers the admin audit read routes (spec 5.1, 4.7; SEC-010 to SEC-012, SEC-014, FR-063):

- `GET /api/v1/admin/audit`: filtered, cursor-paged audit page that writes `auditViewed` after the read and answers only after commit (#711).
- `GET /api/v1/admin/audit/export`: NDJSON export with a 100,000-row cap, `auditExported` committed before the first byte, streamed set bounded by max id (#712).
- `GET /api/v1/admin/queries/:correlationId`: admin read with `adminViewed` (viewerBasis admin) committed before any DEK is unwrapped, through a shared `loadDetail` that leaves the owner read unchanged; `recordAdminViewed` credentialOwner binding check (#713).
- Story A9 test of query audit rows field by field (#714), and a comment rewrap in packages/core/src/contracts/audit.ts (#561).

Critical files reviewed in full: packages/api/src/audit/read.ts, packages/api/src/audit/routes.ts, packages/api/src/queries/admin-read.ts, packages/api/src/queries/read.ts, packages/core/src/contracts/audit.ts.

## Findings summary

- Gate slice: 0 critical, 0 important, 0 minor. Verdict approve.
- Critical slice: 0 critical, 0 important, 1 minor. Verdict approve.
- No critical or important finding to resolve.
- Ledger rulings kept as stands: Task 3 checker ruling (request logger logs path only, never the query string); Task 3 FR-064 traceability fix (IDs SEC-010 to SEC-012, spec 4.7, 5.1); Task 4 checker ruling (@hono/node-server cancels the stream on a real socket abort); Task 5 checker ruling (contracts:gen and client:gen produce no drift).
- Controller rulings kept: the controller-declined minors (T4 Q1, T4 Q2, T4 Q3, T5 Q1, T5 Q2, T5 Q3, T3 Q1, T3 Q4) were not re-raised; none is judged important. Wave critic W1 (plain-digit from and to) is fixed in b7e491b and verified.

## Cross-cutting checks

- Gate: audit routes mounted outside `/api/v1/*` would skip bodyCap, requireRequestedWith and noStore. All three paths are under `/api/v1/admin/`, GET, behind `adminGuard(d, "adminAudit", ["admin"])`. No gap.
- Critical: packages/api/src/queries/policy.ts, risk that an admin reading their own request gets basis owner (404) or a non-admin reaches basis admin. Route admin answers basis admin for any existing request only when the role is admin and the action is read. No gap.
- Critical: packages/core/src/contracts/admin-audit.ts, risk that an accepted query value fails the audit write or admits free text into audit details. user, correlationId, type and cursor use the same schemas as AuditFiltersSchema and AuditCursorSchema. Aligned.
- Critical: tests (export.test.ts, admin-read.test.ts, admin-audit.test.ts), risk that fail-closed order, no-store and the W1 rejection lack route-level proof. Unwrap-order spy, audit-failure-unwraps-nothing, no-store on 200, 400 and guard responses, and hex and exponent window rejection are all covered.

## Answers to the controller's questions

No controller questions.

## Remaining Minors

- m1 packages/api/src/audit/routes.ts:344-361: `limit` still uses number coercion, so `limit=0x10` or `limit=1e1` is accepted. Not audited, page size only; inconsistent with the plain-digit window rule. Optional fix: extend the plain-digit check to `limit` with a test row.
