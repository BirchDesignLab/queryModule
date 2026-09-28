---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "80adeb60f792a91ea6a0d42074bdc8c60833d2e1"
verdict: "approve"
---

# Review: feat/b-p2-wave-2 (critical slice)

Date: 09-28-26.

## Scope

Branch feat/b-p2-wave-2, range cd5a9e468c18319c9dc4963e59b0cdd3db9e2e49..80adeb60f792a91ea6a0d42074bdc8c60833d2e1. Critical tier: the terminal command parser, `packages/core/src/terminal/**` (14 new files, 1444 lines), Tasks 4 to 7. The wave delivers the spec 4.4 terminal core: `tokenize`, `parseCommand` with position-aware errors (story A4), `formatCommand`, `selectCommand` and `mergeDraft` for the form and terminal toggle, and the round-trip property tests (story A5, core half). FR-050 to FR-056.

## Findings summary

- Critical: 0.
- Important: 0.
- Minor: 3 (listed below).
- Rulings kept as they stand: D-B2 option (a) (unknownField only after a named token); D-B5 (1-based positions, canonical round-trip comparison, presetKeys and namedKeys); Task 4 (a whitespace-blank rest remainder is a trailing empty token); Task 6 (mergeDraft takes config; delimiterInValue params are field, labelKey, position); Task 7 (a non-blank rest remainder, even delimiters only, is a value).
- Controller rulings: none were needed in this slice.

## Cross-cutting checks

1. validation.* params passed through parseCommand could carry the typed value. Checked packages/core/src/rules/canonicalise.ts and evaluate-form.ts: params are field keys, min, max and the query type code only. Clean.
2. Core purity. Checked biome.json core override, packages/core tsconfig and package exports: IO imports and globals are forbidden in packages/core/src; the only suppression is the test-only fixture reader; the terminal entry imports no fixture. Clean.
3. The terminal directory in `.github/sensitive-paths`. Listed as `packages/core/src/terminal/**`. Clean.

## Answers to the controller's questions

1. The rest-position split in tokenize.ts (isTrailingEmpty, restAt, seenNamed guard) matches spec 4.4. It splits only up to the rest position and treats the tail as one value, blank to count as trailing. The Task 4 and Task 7 readings are consistent: a blank rest remainder is a trailing empty; a non-blank one is taken verbatim, as the binding round-trip property requires. It is safe: nothing is dropped and no error param changes. A doubled trailing delimiter on PRO submits description "." and the PR description must state this reading (Task 7 carry-forward).
2. mergeDraft(draft, t, config) is correct and complete. It writes presets, every command position (null when omitted or empty), positioned and named keys, and keeps every other value. Switching drafts by query type is the caller's job (spec 6.7).
3. No error param carries a typed value except terminal.unknownCommand.code and terminal.unknownField.name, across tokenize, parseCommand (enriched validation.* and valueForHiddenField) and formatCommand (unknownCommand, delimiterInValue).
4. Core purity holds. No IO, clock or randomness in non-test terminal code; `now` is passed in. __fixtures__/sites.ts reads files under a justified biome-ignore and is test-only.

## Remaining Minors

- tokenize.ts:105-106: a blank token after a named token is reported as terminal.positionalAfterNamed.
- tokenize.ts:121-125: `VEH..A.B.C.D` reports tooManyPositions with expected 4, got 4 (already deferred, Task 4 R1-N1).
- __fixtures__/arbitraries.ts:23: enabledCodes compiles at now 0 while the round trip runs at 09-28-26; pass `now` through (test-only).
- Ledger deferrals still open: delimiterInValue reused for named-token look-alikes and the en.json:78 wording; isTrailingEmpty re-splits per blank token; the arbitrary's readsAsNamed exclusion.
