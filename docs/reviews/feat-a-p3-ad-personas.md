---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "1344cf8435ecc38445d9f8cb6c8ae5dbcaf9572c"
verdict: "approve"
mode: "fast"
---

# Review: feat/a-p3-ad-personas

Date: 09-29-26

## Scope
Branch feat/a-p3-ad-personas, range 78329fe6e7096b4f505c4895bbdf4c977eebf206..1344cf8435ecc38445d9f8cb6c8ae5dbcaf9572c (one commit, #363, plan Task 36). The demo seed writes user_preference.persona_override "mobileUnit" for mobileunit@example.test and officer@example.test so the officer demo shows the mobile-unit layout on a desktop browser (spec 6.1, UX-012, D-A33). Gate files: packages/api/src/seed/seed.ts, packages/api/src/seed/users.ts. Fast path, 39 reviewed lines.

## Findings summary
Critical 0, Important 0, Minor 2. No ruling ids contested; no controller rulings.

## Cross-cutting checks
1. Persona value validity: PERSONA_LAYOUTS (packages/core/src/config/schema.ts) contains "mobileUnit"; resolve-persona.ts lets the override beat the heuristic. Valid.
2. Column and return shape: createLocalUser returns {id}; user_preference insert matches schema (userId PK FK, updatedAt timestamp_ms). OK.
3. Sensitive-path coverage: no new file; seed/** already gate tier. OK.

## Answers
No controller questions. Recovery contract (SeedPartialFailureError lists created users, no password in message) holds for the new preference write.

## Remaining Minors
- M1 users.ts: persona type is a literal, not derived from PERSONA_LAYOUTS.
- M2 seed.ts: no failure-injection test for the preference insert; recovery doc mentions role grants only.
