---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "5b387f88b46f5d7f663782e1214f8d94c1c836a2"
verdict: "approve"
mode: "fast"
---

# Review: feat/m2-a-p2-wave-1

Date: 10-18-26.

## Scope

Branch `feat/m2-a-p2-wave-1`, range `76b9f7e729b8077ae55499f4c897718986464fc2..5b387f88b46f5d7f663782e1214f8d94c1c836a2` (5 commits). M2 P2 wave AW1:

- Task 1 (#709): `listAdminAudit`, `exportAdminAudit` and `getAdminQuery` carry `feature: "adminAudit"` (OpenAPI `x-feature`); the export 200 description names `AuditExportLineSchema`, with the line shape in `docs/api.md`; the shipped default site turns `adminAudit` on (D-M2P2-1). The routes stay planned and unmounted until AW2.
- Task 2 (#710): `SESSION_CEILING_MINUTES = 10_080` in `packages/core/src/config/session-limits.ts`; validate errors `config.sessionCeilingExceeded` and `config.sessionIdleOverAbsolute` (D-M2P2-2, AUD-1, SEC-005); `session-limits.ts` joins `[gate]` in `.github/sensitive-paths` and the CLAUDE.md gate list.

Sensitive slice: `.github/sensitive-paths` (critical, +2) and `session-limits.ts` (gate, +8), 10 lines, fast path. Both read in full.

## Findings summary

- Critical: 0. Important: 0. Minor: 2.
- Rulings kept as they stand: D-M2P2-1 (`adminAudit` on in `default.json`; it governs over the spec's flags-off-until-acceptance rule, design v2 "Feature flags"), D-M2P2-2 (fixed 7-day ceiling plus validate rules, no schema change).
- No controller rulings in this run.

## Cross-cutting checks

1. Turning `adminAudit` on exposes unfinished UI: no client code reads the flag and the three routes are unmounted, so nothing is exposed.
2. The validate rules misfire on zero or negative limits: `auth.session` fields are `z.int().positive()` with defaults 720 and 30, so the rules see only positive integers and the defaults pass.
3. Equality at the ceiling reproduces the AUD-1 race once Better Auth reads the ceiling: `packages/api/src/auth/auth.ts` sets `expiresIn` from `absoluteMinutes` today, with no separate request-time absolute check. Nothing reads the ceiling yet, so this is recorded as a minor for AW3.

## Answers to the controller's questions

No controller questions.

## Remaining Minors

- M1 `packages/core/src/config/session-limits.ts:2-5`: at `absoluteMinutes: 10_080`, Better Auth's expiry and the absolute limit fall on the same instant, so a request before the next sweeper tick can meet Better Auth's unaudited expiry. AW3 Task 8 should set `expiresIn` to the ceiling plus at least one sweeper interval and reword the comment ("strictly later than").
- M2 `docs/site-config.md:82`: the flags-off-until-acceptance sentence contradicts the `adminAudit` row; add the D-M2P2-1 exception.
