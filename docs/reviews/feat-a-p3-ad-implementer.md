---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "bc935f4383f9fe08e9abe80020a75e8c24c4a4ce"
verdict: "approve"
mode: "fast"
---

# Review: feat/a-p3-ad-implementer

Date: 09-29-26.

## Scope

Branch feat/a-p3-ad-implementer, range f288774..bc935f4 (one commit, #363). Adds the implementer@example.test demo account (role implementer, config only, ADR-0011 item 6, plan Task 36) to the seed, with its password derived from SEED_PASSWORD_SECRET like every other demo user. Rides two persona follow-ups: M1 (persona typed as a site persona key, checked by a test against the shipped default site) and M2 (failure-injection test for the persona preference write, plus a recovery line in docs/demo.md). Gate tier files: packages/api/src/seed/seed.ts, packages/api/src/seed/users.ts.

## Findings summary

Critical 0, important 0, minor 3. No ledger rulings contested; the controller ruling on M1 (string plus test, not a layout union) is kept as stands. No controller rulings needed.

## Cross-cutting checks

- grant-role accepts implementer, which docs/demo.md now tells operators to use: ROLES in packages/core/src/contracts/identity.ts includes implementer and parseGrantRoleArgs checks ROLES, so it works; the usage message is stale (minor).
- The M1 test reads packages/config/sites/default.json: path and personas[].key shape confirmed, mobileUnit present.

## Answers to the controller's questions

No controller questions. Context question: the implementer seed keeps the run-once refusal and the partial-failure recovery list, and the M1 choice is sound.

## Remaining Minors

- packages/api/src/ops/grant-role.ts:13: usage text omits implementer; build it from ROLES.
- packages/api/src/seed/seed.ts:22: JSDoc implies a missing persona can be set in place; docs say reset and reseed. Align wording.
- packages/api/test/ops/seed.test.ts: persona-key test covers default.json only; optional scope note.
