---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "71bd7afbdfe2c5a83b7be1a5ae68f5912d3a26ab"
verdict: "approve"
---

# Critical review: docs/status-a-20260927 (P0 phase, critical slice)

Date: 09-27-26

## Scope

Branch docs/status-a-20260927, range 44d70b40314a76bf2d4ede8e92e6a85fa24e9770..71bd7afbdfe2c5a83b7be1a5ae68f5912d3a26ab. This is the whole-phase P0 gate review (plan Step 8) of the critical-tier files, read as a whole across W1 to W6: the audit and identity contracts (`audit.ts`, `primitives.ts`, `identity.ts`), the dispatch contracts (`source-status.ts`, `ws.ts`) and the review gate (`.github/sensitive-paths`, `scripts/ci/sensitive-review.ts`, `scripts/ci/check-sensitive-review.ts`). P0 delivers the frozen M0/M1 contracts: six query audit events, WS v1 messages, shared id and time primitives, and the tiered sensitive-review check.

## Findings summary

- Critical: 0. Important: 0. Minor: 7.
- Rulings kept as they stand: no xhigh or max; #93 (message and label keys keep minLength 1); #95 (review caps, branch-keyed artifact, fast path, reserved token-store glob; the #96 minors are not re-raised); audit rows never deleted or rewritten.
- No controller rulings were needed in this pass.

## Cross-cutting checks

1. `packages/core/src/contracts/routes.ts`, for the risk that the FR-064 202 acknowledgment body was frozen with a shape that disagrees with the `acknowledged` audit event: the submit route is not a contract yet; M1 P2 adds it as an additive route and should reuse the shared primitives.
2. `version.ts` and the generated `ws-events.schema.json`, for the risk that WS wire-format files sit outside the critical tier: both are unlisted (minor M7).
3. Plan Task 4 and spec 12.2 and 12.3, for the risk that SEC-013 (`deletedFromView`) is missing at the freeze: the spec freezes exactly six query events in P0 and schedules `deletedFromView` and `adminViewed` for M2 P0 (additive). Consistent.

## Answers to the controller's questions

1. The three files agree. All user ids use BoundedId, all correlation, result and delegation ids use UUIDv7, instants use EpochMs, durations use DurationMs, and part ids use one family. SEC-010, SEC-011, SEC-012 and SEC-014 are covered; SEC-013 joins in M2 P0 by design. The contracts can freeze. Two audit rules should tighten early in P1 through master plan 8 while no rows exist: the credential owner must agree between envelope and details, and host rows must carry the host subject.
2. Yes. WS `sourceStatus` and audit share SourceStatus, UUIDv7 and part ids, and cover FR-040 to FR-044 per (part, source, result). FR-064 is the 202 plus `acknowledged`, and `ackReceipt` is a metric. The FR-065 foreground path is `sourceStatus`. The close code 4001 matches ADR-0004. `resync` and `resultHidden` are needed only in M2, so M1 dispatch needs no WS contract change.
3. Nothing blocks the freeze. Expensive later if left: the two audit tightenings (M1, M2), WS forward compatibility for native clients (M4, decide before M4), and the hand-listed `sourceResponded` status enum (M3), which would crash the dispatcher when SourceStatus grows.

## Remaining Minors

- M1 `audit.ts:204`: the envelope `credentialUserId` should equal `details.credentialOwnerUserId` on `sourceDispatched` and `sourceResponded`. Fix before the first writer in M1 P2 (master plan 8 tightening).
- M2 `audit.ts:263-270`: rows with `identitySource` host should require `hostSubject` (spec 5.6). Fix before M4 (master plan 8 tightening).
- M3 `audit.ts:140-146`: derive the `sourceResponded` status from `SourceStatusSchema.exclude(["pending", "interrupted"])` and add an accept test.
- M4 `ws.ts:136-185`: client receipt policy for additive WS changes (drop unknown types, strip unknown keys), or raise `MIN_CLIENT_VERSION` on each change; decide before M4.
- M5 `primitives.ts:21-22, 44-45`: build the patterns from the length constants.
- M6 `audit.ts:192`: IdentityService should normalise actor email with the audit schema, or store null, so an audit write cannot fail every submit.
- M7 `.github/sensitive-paths`: list `packages/core/src/contracts/version.ts` (and the generated `ws-events.schema.json`) under the critical tier.
