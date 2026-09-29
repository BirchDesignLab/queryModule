---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "f9399aadef3ed17b3f477e9451101edb1e40b98c"
verdict: "approve"
---

# Review: feat/b-p2-wave-6

Date: 09-28-26.

## Scope

Branch feat/b-p2-wave-6, range 8a3019f..f9399aadef3ed17b3f477e9451101edb1e40b98c. Gate slice first, critical slice last.

The wave delivers issue #294 (B2 wave-review minors C-M1 to C-M3 and triaged task-review minors), #296 C-M2 and #295 box 1: terminal tokenize rewrite (blank token after a named token skipped, tooManyPositions counts interior empties, named token accepted for an empty positioned field, linear trailing-empty check), formatCommand preset shown rule, no valueForHiddenField for preset-only keys, shared position helpers in `packages/core/src/terminal/positions.ts`, `.js` barrel imports, hardened terminal tests (literal trailing-empty results, leak check for case-folded, canonical and substring echoes, VEH and PER draft round trips, A5 presets site, error-aware canonDraft, typed date formats, `enabledCodes` at `now`), and the biome `__fixtures__` exemption.

## Findings summary

- Gate slice: approve, 0 critical, 0 important.
- Critical slice: 0 critical, 0 important, 3 minor.
- Rulings kept as stands: T18/a, T18/b, T18/c, T18/C-M2 (#296), #296 rulings 2 to 4, #295 box 1, T18 ruler (positionalAfterNamed counts blank tokens). The code follows each.
- Controller rulings: none requested.

## Cross-cutting checks

1. `packages/core/src/contracts/primitives.ts`: FIELD_KEY_PATTERN is anchored with no flags and fails on empty text, so a post-named token with no `=` stays positionalAfterNamed.
2. `packages/core/src/rules/canonicalise.ts`: rawText trims, so whitespace-only draft values are not counted in unshownCount.
3. `tsconfig.base.json`: target and lib ES2023 cover `findLastIndex` in tokenize.

## Answers to the controller's questions

No controller questions.

## Remaining Minors

- Spec 4.4 Toggle sentence (line 462) does not yet state ruling T18/b (preset key shown only when the draft value is empty or canonically equal).
- `roundtrip.a5.test.ts:73`: `trip` formats `selected?.code ?? ""`, so two properties could pass vacuously; throw on an undefined selection.
- `terminal/types.ts:18`: `positionedKeys` doc does not mention that a named token filling an empty position moves the key to `namedKeys`.
