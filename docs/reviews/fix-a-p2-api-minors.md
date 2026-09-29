---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "8c2da7a8543576fbaa0ae1f47d7b3f0ef677cb8b"
verdict: "approve"
---

# Review: fix/a-p2-api-minors

Date: 09-29-26.

## Scope

Branch fix/a-p2-api-minors, range 17f84b81ef7999108b56216dd54fcba1f6957fc5..8c2da7a8543576fbaa0ae1f47d7b3f0ef677cb8b. The wave delivers: #317 C-m1 (replay errors leave only as fixed or sanitized text), #289 (sign-out deletes the session and writes the logout audit row in one transaction), #311 critical boxes (request-key validation, zeroing and key version; migration 0006 query_request origin trigger; one TriggerMissingError; writable_schema guard as a plain string with an exact scanner allowlist entry; scripts/ci/is-main-module.mjs listed critical) and #303 Tasks 7, 8 (startup refusal log on configLoaded audit failure, config load and startup test gaps). Gate slice and critical slice reviewed in one run.

## Findings summary

- Critical: 0. Important: 0 (gate slice: 0; critical slice: 0). Minor: 3 in the critical slice.
- No critical or important finding needed resolution.
- Ruling ids kept as stands: T101 checker rulings (1) to (5) of 09-29-26, IC1, IC2.
- Controller rulings: none requested.

## Cross-cutting checks

1. packages/api/src/app.ts onError: risk that wrapping replay errors changes a mapped status. Found: every error maps to 500 internal; no change beyond the sanitized message.
2. packages/api/src/keys/canary.ts: risk that REQUEST_KEY_VERSION tied to CURRENT_KEY_VERSION breaks existing rows or creates an import cycle. Found: value is 1, no cycle; existing request_key rows open.
3. packages/core/src/rules/types.ts: risk that the non-finite check misses nested numbers. Found: CanonicalValue is flat (string, number, boolean); the check is complete.

## Answers to the controller's questions

None asked.

## Remaining Minors

1. packages/api/src/queries/admission.ts:133-149: a stored row that fails schema parsing on replay leaves as a generic "submit replay failed"; map ZodError to a fixed-text ReplayIntegrityError for diagnosis.
2. CLAUDE.md: the critical path list does not name scripts/ci/is-main-module.mjs or scripts/ci/check-schema-writes.ts; enforcement via .github/sensitive-paths is correct.
3. packages/api/src/queries/route.ts:8-12: the re-export from ./errors splits the import block.
