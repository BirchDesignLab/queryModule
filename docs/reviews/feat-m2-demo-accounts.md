---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "de5230fd034420146b8c3db5ec8248ef70ed2a7e"
verdict: "approve"
---

# Review: feat/m2-demo-accounts

Date: 10-19-26.

## Scope

Branch feat/m2-demo-accounts, range 73b9dd0d2c7a031074d1c3110170f7957158de1a..de5230fd034420146b8c3db5ec8248ef70ed2a7e (#781, mixed critical and gate). The wave adds a second demo account per role to DEMO_USERS, an add-demo-users ops command that adds only the missing demo accounts to an existing database, and docs. Critical slice: packages/core/src/contracts/audit.ts, which lets userCreated be written by SYSTEM_ACTOR only with details via "add-demo-users". Gate slice: approved earlier in this run with no open critical or important finding.

## Findings summary

- Critical: 0. Important: 0. Minor: 1 (critical slice).
- Ruling kept as stands: M2 Manager 9, 10-19-26, on #781, audit path B (SYSTEM_ACTOR userCreated only with via add-demo-users; admin rows unchanged; no migration). The contract change matches it.
- No controller rulings were needed.

## Cross-cutting checks

1. Admin user-create writer (packages/api/src/admin/users/users.ts:156-162) could forward a client via: it builds details as a literal without via, so byAdmin applies. Clean.
2. The only via writer (packages/api/src/ops/add-demo-users.ts:100-105) writes SYSTEM_ACTOR, identitySource system, role user, via add-demo-users, which the contract accepts; existence check and inserts share one transaction. Clean.
3. Details consumers: openapi.json lists type names only, so no regeneration. The spec 4.7 table row is stale (minor m1).

## Answers to the controller's questions

1. Yes. audit.ts:653-659 sends only via "add-demo-users" to bySystem; every other userCreated row goes to byAdmin (audit.ts:617-618). The details schema (audit.ts:302-306) is strict with a single via literal. Tests reject an admin row with the via and keep rejecting the system actor without it.
2. No on all three. add-demo-users.ts:74-107 checks the email and inserts in one transaction and never updates; existing accounts are skipped whole and grantRole runs only for accounts made in this run (112-119). Nothing logs: the CLI uses a no-op log sink and prints passwords only to its own stdout (scripts/ops/add-demo-users.ts:20, 29-30, 37-38); error messages carry no password. add-demo-users.ts:63-64 refuses any entry not ending in @example.test before any write.

## Remaining Minors

- m1. docs/superpowers/specs/2026-09-25-query-module-2-design-v2.md:692: the userCreated row in the spec 4.7 admin and ops table still says only the admin writes it. Add `via?` (`add-demo-users`) and that those rows are written by the system actor (#781), as the roleChanged row does for grant-role.
