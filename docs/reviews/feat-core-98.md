---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "d60bae360e7ac95369f42ac0b331a887080a703c"
verdict: "approve"
---

# Review: feat/core-98

Date: 09-28-26.

## Scope

Branch feat/core-98, range 6e8290441eb9fcac3cd6cac70cbfa6e4be6121db..d60bae360e7ac95369f42ac0b331a887080a703c. Critical slice: `packages/core/src/contracts/audit.ts`, `packages/core/src/contracts/primitives.ts`.

The wave delivers two frozen-contract changes on the audit catalogue:

- #98 C-M8 (D-A1): request-level query rows (`submitted`, `acknowledged`, `partSkipped`) carry no envelope `credentialUserId`; `interrupted` keeps an optional owner; `sourceDispatched` and `sourceResponded` keep the C-M1 equality rule.
- #270 (D-A2): `configLoaded` and `retentionPurged` audit types on a system envelope, written by SYSTEM_ACTOR only; `retentionPurged.olderThan` is null exactly when `reason` is `keyLost`. `SemverSchema` moved from `routes.ts` to `primitives.ts` unchanged.

## Findings summary

Critical 0, important 0, minor 1. No ledger rulings touch these files; no controller rulings needed.

## Cross-cutting checks

1. Existing API writers or readers of `credentialUserId` on request-level rows: only `packages/api/src/audit/service.ts` (parse then insert) and the DB column; no query audit writer yet and no reader parses rows back. No risk.
2. configLoaded stricter than SiteConfig (would fail startup on a valid config): `site.id` and `extends` are BoundedIdSchema in `packages/core/src/config/schema.ts`, same as the audit details. Aligned.
3. Gate coverage: `.github/sensitive-paths` lists both files; no new files in the diff.

## Answers to the controller's questions

1. D-A1: no request-level row can carry a `credentialUserId` (`z.never().optional()`, audit.ts:260-261); `interrupted` accepts one or none (audit.ts:309-314); the equality rule for `sourceDispatched` and `sourceResponded` is unchanged (audit.ts:392-401).
2. D-A2: system types need role system (audit.ts:378), which forces identitySource system and the exact SYSTEM_ACTOR (audit.ts:354-367); correlationId, partId and credentialUserId are never (audit.ts:278-285); hostSubject is impossible without identitySource host. The olderThan/keyLost refinement is an exact biconditional (audit.ts:212).
3. Frozen contract: only D-A1 narrows existing types; everything else is additive. SemverSchema regex and 64 cap are identical; `openapi.json` is not in the diff.

## Remaining Minors

- m1: the retentionPurged tests do not reject partId, credentialUserId or hostSubject explicitly (covered by the shared system envelope and the configLoaded cases). Add them if `audit.test.ts` is touched again.
