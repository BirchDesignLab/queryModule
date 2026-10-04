---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "7db73c158f9df56469f97b7f2f0c0c902bf70b73"
verdict: "approve"
---

# Review: fix/m1-critical-hardening (critical slice)

Date: 10-03-26

## Scope

Branch fix/m1-critical-hardening, range 916b2f0..7db73c1 (78155f3 H1, 4b9698e H2, 7db73c1 inline). The wave delivers M1 hardening for #98, #505 and #311: host subject required on host audit rows (C-M2) and spread by the admin user writers; the admin guard refuses a must-change-password user with 403 passwordChangeRequired; publish, rollback and validate refuse a document with features.adminConfig off (T27 Q6); POST /api/v1/queries takes an explicit role allowlist (T27 Q2); spec 10.3 key canary assertions and storage test closes (#311). Critical files reviewed in full: packages/api/src/admin/access.ts, packages/api/src/admin/config/draft.ts, packages/api/src/queries/route.ts, packages/core/src/contracts/audit.ts, packages/core/src/contracts/audit-auth.ts. The gate slice ran first and approved with no open critical or important finding.

## Findings summary

- Critical: 0. Important: 0. Minor: 1.
- Controller rulings kept as stand: T27 Q6 (adminConfig off refused at /features/adminConfig), T27 Q2 (allowlist user, trainingOfficer, admin), G-m2 (gate slice), H1 C-M6 and T28 M6 already done, H2 IC1 (0006 trigger meets the origin check, no migration 0009), out-of-scope items moved to #511.

## Cross-cutting checks

1. validateDocument callers (startup refusal risk): only the validate route and publish/rollback prepare() call it; startup and activate do not.
2. Host rows without hostSubject (fail-closed writer or stored-row read risk): AuditEventSchema is parsed on write only; every principal-derived writer spreads hostSubject; identity resolution issues local principals only today.
3. Admin routes without adminGuard after the app.ts middleware removal (forced-change bypass risk): all 6 user and 7 config routes take the guard first; resolveGated fails closed.

## Answers to the controller's questions

None asked.

## Remaining Minors

- packages/api/src/admin/config/draft.ts:155-160: the validateDocument docstring does not list the new adminConfig refusal; add it to the list of activate() checks.
