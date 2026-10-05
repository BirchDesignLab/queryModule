---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "ff96621d3c0969f0251537bbf3e4785baed445d0"
verdict: "approve"
---

# Review: feat/m2-a-p05-wave-1 (gate slice)

Date: 10-05-26.

## Scope

Branch feat/m2-a-p05-wave-1, range 4854e18babfe8fb16bc18d84bae231a0271d45aa..ff96621d3c0969f0251537bbf3e4785baed445d0. The wave delivers the core fixture policy for mock payloads (#529, spec 5.4), the mock-data generator and regenerated mock files (#530), config:validate running the fixture policy and the generator drift check (#531, spec 10.8), and the board P0.5 Phase option with phase parent #519. Gate files reviewed: scripts/ci/config-files.ts and test, scripts/ci/config-validate.ts, scripts/ops board config, schema, model and tests, gh-setup-project.mjs, scripts/vitest.config.ts, packages/core/src/config/fixture-policy.ts and test.

## Findings summary

Critical 0, Important 0, Minor 3. Rulings kept as stands: allowlist of normalised keys with `when` exempt; Ruler C3; controller be75721; Manager S1; `issued` in the dob kind and container recursion; drift check on the whole-tree run only; board P0.5 and p0-5 label. No controller rulings needed.

## Cross-cutting checks

1. Fail-open when the mock fails its schema: checkMockCoverage reports config.mockSchema, and the payload schema is a passthrough record, so no keys are stripped before the policy walk. Safe.
2. Phase option change on --apply: ensureSelect keeps option ids by name, so existing Phase values survive. Safe.
3. Label p0-5 in scripts/ops/gh-setup-labels.sh: not defined there (Minor M1).

## Answers

No controller questions.

## Remaining Minors

- M1: add p0-5 to scripts/ops/gh-setup-labels.sh, or correct the board-model.mjs phaseLabel comment.
- M2: config:validate does not flag a committed mock file with no site and no generator entry (spec 10.8 "every shipped mock file").
- M3: a generator throw in mockDriftErrors crashes config:validate with a stack instead of an ERROR line (fails closed).
