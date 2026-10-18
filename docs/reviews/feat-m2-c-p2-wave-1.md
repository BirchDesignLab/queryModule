---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "d3421f4f088e12be95c48a5aa12253de30df26dc"
verdict: "approve"
---

# Review: feat/m2-c-p2-wave-1 (gate slice, 10-18-26)

## Scope

Branch feat/m2-c-p2-wave-1, range e54b5e5bcd165b85fc26793c0619f5370dafc101..d3421f4f088e12be95c48a5aa12253de30df26dc. The wave delivers `config:validate` mapping path warnings against mock payloads (Task 15, #722, spec 4.5), `config:validate --diff <tag>` for release notes (Task 16, #733, D-M2P2-8, spec 7 and 9.5), and the CI image job timeout of 35 minutes (#747). Gate files: .github/workflows/ci.yml, scripts/ci/ci-workflow.test.ts, scripts/ci/config-files.ts and test, scripts/ci/config-validate.ts and its two tests.

## Findings summary

- Critical: 0. Important: 0. Minor: 3 new (G3-m1..m3) plus G-m7 carried.
- First review minors G-m1 to G-m5 are fixed in d3421f4 with tests. G-m6 sits in the ordinary-tier core file.
- Rulings kept as they stand: Task 15 mapping tally (M2 Manager 8, 10-18-26, ruling on #722), recorded in the plan Rulings.
- Controller rulings: none in this run.

## Cross-cutting checks

1. Stray vitest report could come back: .gitignore has no `.vitest` entry (G3-m3).
2. Outside-repo guard vs path normalizing: cli-io.ts `toPosixRel` only swaps separators, so a Windows cross-drive target is not caught (G3-m1).
3. Generic-mapping relaxation ruling: on file in the plan Rulings (line 427).

## Answers to the controller's questions

1. G-m1 (invalid JSON at tag), G-m2 (git failure vs absent path), G-m3 (new file validated on head), G-m4 (`--resolved` with `--diff` rejected) and G-m5 (outside-repo targets) are fixed in scripts/ci/config-validate.ts and tested in config-validate.test.ts. G-m5 holds for `../` paths. The stray `packages/api/.vitest/json/output.json` is removed. `--diff` checks the tag before any git call, uses execFile with an argument array, prints one line per change, prints "new file", and exits 0 only when both sides validate. Targeted tests pass (23/23). New items are minor only.

## Remaining Minors

- G3-m1: config-validate.ts:147-151, a cross-drive Windows target prints "new file" instead of `config.targetOutsideRepo`; also check `isAbsolute(rel)`.
- G3-m2: config-validate.ts:102, the absent-path match reads git's English stderr; set `LC_ALL=C` for `git show` (today it fails closed).
- G3-m3: add `.vitest/` to .gitignore so the stray report does not come back.
- G-m7: example-ok's 15 standing mapping path warnings (manager to file).
