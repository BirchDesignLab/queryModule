---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "28fe535e09f4374a9765cedddaaa58b70d56db9f"
verdict: "approve"
---

# Review: feat/m2-a-p1-wave-1 (critical slice)

Date: 10-13-26.

## Scope

Branch feat/m2-a-p1-wave-1, range 022618d786da91f87270e55d46fbe4d21b955b44..28fe535e09f4374a9765cedddaaa58b70d56db9f. The wave delivers M2 P1 Track A AW1: #565, one pure mock scenario matcher (packages/core/src/mock) shared by the mock adapter and the coming builder preview, with packages/core/src/mock/** added to the critical tier; #576, 202 acknowledgment parts carry origin, parentPartId and values-free skipReasons, rebuilt identically on idempotent replay. Critical files reviewed: .github/sensitive-paths, packages/api/src/adapters/mock.ts, packages/api/src/queries/acknowledge.ts, packages/api/src/queries/admission.ts, packages/core/src/mock/index.ts, packages/core/src/mock/match.ts, packages/core/src/mock/match.test.ts.

## Findings summary

- Critical: 0. Important: 0. Minor: 1.
- Rulings kept as stands: Task 1 parked items (Windows load timeouts, no code cause); oasdiff read-route ERRs expected, with the api-breaking label; deferred client fixture and gen:check minors; AW2 Tasks 3 and 4 serve skipReasons.
- No controller rulings were needed.

## Cross-cutting checks

1. The 202 part contract (packages/core/src/contracts/queries.ts, audit.ts): strict object; the refine ties skipped to non-empty reasons and primary to null parentPartId; reason params strict. No value can reach the 202.
2. Replay parity (admission and submit tests): a skipped-part replay is deep-equal and text-equal to the live 202; malformed stored reasons raise a fixed-text ReplayIntegrityError with no value in the stack.
3. Behaviour coverage after the move (default mock, adapter test): timeout and error in the default mock, credentialsRejected in the adapter test.

## Answers to the controller's questions

None asked.

## Remaining Minors

- M1 packages/core/src/mock/match.test.ts:215: the random-mock property never generates a behaviour scenario; add an optional behaviour to scenarioArb and extend the oracle outcome as the default-mock property does.
