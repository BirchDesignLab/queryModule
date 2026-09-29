---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "26043ec82e0b6439bf1b0f61b3f0b45cd53c2643"
verdict: "approve"
---

# Review: feat/a-p2-wave-5

Date: 09-29-26.

## Scope

Branch feat/a-p2-wave-5, range 8a3019fac739007ea8b65390cee4b17f76948b9e..26043ec82e0b6439bf1b0f61b3f0b45cd53c2643 (M1 P2 Track A wave A5, plan Tasks 17 to 21 plus #307). The wave delivers POST /api/v1/queries (spec 5.2 steps 1 to 4): submit admission with per-value cap, per-user rate limit and Idempotency-Key replay; server-side plan and M1 credential snapshot; transaction T1 with request DEKs, query_request and pending source_result rows and the submitted, partSkipped, sourceDispatched and acknowledged audit rows, failing closed; the authorizeQueryAccess policy (SEC-014); planner minors from A4 (#307); and `packages/api/src/queries/**` added to `.github/sensitive-paths` at critical tier. Two slices ran: gate slice (Opus 5.5 medium) and critical slice (Opus 5.5 high).

## Findings summary

- Gate slice: approve, 0 Critical, 0 Important.
- Critical slice: approve, 0 Critical, 0 Important, 1 Minor.
- No critical or important finding to resolve.
- Ruling kept as stands: ruler T20/IC1 (the race loser is detected through migration 0005's BEFORE INSERT trigger; the controller's UNIQUE-index premise was wrong).
- Controller ruling kept: #284, duplicate sourceIds rejected 400 validation.invalidBody { field: "sourceIds" }, no new key.
- Deferred wave critic minors not re-reported: M1 delegated/own-credential overlap (M3 P1), M2 ackLatencyMs and Server-Timing (M2 P1).

## Cross-cutting checks

1. packages/core/src/rules/compile.ts. Risk: the planner now compiles the primary with the request's queryType, not the canonical code. Found: findQueryType case-folds for both compile and evaluateForm; same type. No issue.
2. packages/api/src/app.ts onError. Risk: submit-route errors outside the T1 sanitizer reach the log with drizzle params; T1 failure must be 500 internal. Found: all throws map to 500 internal; replay reads are not sanitized (Minor m1).
3. packages/core/src/contracts/queries.ts. Risk: empty sourceIds acknowledging a zero-pair primary; array values bypassing the UTF-8 per-value cap. Found: sourceIds min 1 max 8; values scalar only. No issue.

## Answers to the controller's questions

None asked.

## Remaining Minors

- m1 packages/api/src/queries/route.ts:229 and admission.ts:66: `replayResponse` runs outside `sanitizeSubmitError`, so a DB failure during replay logs drizzle's message with userId and the Idempotency-Key (a client nonce, not a value or key material). Fix: rethrow replay failures through the sanitizer.
- Declined for controller ruling: whether idempotent replay should filter result_visibility (spec 5.2 Hide "including replay" versus step 1 "original 202 body"); lands with the hide route.
