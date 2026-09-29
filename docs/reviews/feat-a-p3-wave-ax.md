---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "f79edf592958765dd12eef6afb404112ee26a9eb"
verdict: "approve"
---

# Review: feat/a-p3-wave-ax

Date: 09-29-26.

## Scope

Branch feat/a-p3-wave-ax, range 78329fe6e7096b4f505c4895bbdf4c977eebf206..f79edf592958765dd12eef6afb404112ee26a9eb. Track A P3 Tasks 22 (#346, example-query config for the default site: NAM on PER and PROP on PRO, per-type PRO rules) and 23 (#347, example-ok site variations: NAM positions last.first.race.sex.dob, one site-only rule, demo script). Two slices: gate (config-files.test.ts warning pins) approved first; critical slice covers packages/core/src/terminal/roundtrip.a5.test.ts.

## Findings summary

- Gate slice: approve, 0 critical, 0 important.
- Critical slice: approve, 0 critical, 0 important, 2 minor.
- Checker ruling Q1 (typed-only NAM and PROP; A5 split into toggle round trip and per-command round trip; A5 tag kept; no reorder) kept as stands and implemented as ruled.
- Checker ruling Q3 (accept conditionallyRequiredWithoutPosition warnings, update pins) kept as stands; judged in the gate slice.
- No controller rulings in this run.

## Cross-cutting checks

1. selectCommand in packages/core/src/terminal/format.ts: risk that the "first preset-free command in config order" premise behind TYPED_ONLY is wrong. Found: highest matching preset count wins, ties keep the first by strict comparison; premise holds.
2. Site fixtures and shipped config order (packages/core/src/terminal/__fixtures__/sites.ts, packages/config/sites/default.json, example-ok.json): risk that the test does not exercise shipped order or that the example-ok overlay puts NAM ahead of PER. Found: fixtures load and merge the shipped files; PER precedes NAM and PRO precedes PROP; example-ok only redefines NAM.
3. Ran the A5 test file at head for the overlay-order doubt: 95 tests passed, tree clean.

## Answers to the controller's questions

- Does the rewritten test still prove A5 for every toggle-selected command, with nothing vacuous and the #323 guard kept, and does TYPED_ONLY fail a wrong pick? Yes. Non-typed-only commands assert the toggle picks them and then run every property on that path; the #323 guard and its harness test remain; a typed-only command the toggle picks, or a toggle command that gets shadowed, fails.

## Remaining Minors

- roundtrip.a5.test.ts:141: typed-only case asserts only that the toggle does not pick the command, not which command it picks. Suggest a map NAM to PER, PROP to PRO.
- roundtrip.a5.test.ts:75: TYPED_ONLY is keyed by code across all sites, including the inline presets site; a future inline site reusing NAM or PROP would inherit the expectation.
