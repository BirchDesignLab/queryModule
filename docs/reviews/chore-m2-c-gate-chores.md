---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "0a81c7c7a8c91c0d65049cf21ba508e7f30f78e5"
verdict: "approve"
---

# Review: chore/m2-c-gate-chores

Date: 10-18-26

## Scope

Branch chore/m2-c-gate-chores, range b2a14792ebc7f8f9820686e48505ffb1794390d3..0a81c7c7a8c91c0d65049cf21ba508e7f30f78e5, gate tier (the only slice). Delivers #750 (config:validate --diff: `outsideRepo` guard for parent, drive and UNC targets; git run in the C locale through an injectable exec; `.vitest/` ignored; dead example-ok warning filter removed) and #743 (gh-setup-project keeps hand-added text below a phase parent's generated body through the pure `phaseBodyUpdate`, opted in by `keepBelow: true` on the phase parent only), plus the `design` board label (Refs #724).

## Findings summary

Critical 0, Important 0, Minor 4. No ledger rulings or controller rulings were contested. The manager's test constraint (no test spawns gh-setup-project.mjs) is kept: #743 is covered by unit tests of `phaseBodyUpdate` and a static-source test.

## Cross-cutting checks

1. gh-setup-project.mjs ensureIssue create path (risk: `keepBelow` leaks into the POST body): the body is built field by field; not sent.
2. scripts/ci/cli-io.ts `toPosixRel` (risk: drive or UNC relative results escape `outsideRepo`): backslashes become slashes, so drive and UNC forms are `win32.isAbsolute`.
3. Changed test files run at the head (VITEST_MAX_WORKERS=3): 5 files, 166 tests passed; example-ok carries no warnings after the filter removal.

## Answers to the controller's questions

1. `phaseBodyUpdate` (scripts/ops/board-model.mjs:215-230): unchanged body plus added text returns null; a changed generated part returns the new generated body plus the old tail cut at the end of the trailer line, and the next run returns null (no duplication); CRLF is normalized before comparison; a body with no trailer is replaced whole (added text dropped, documented). The first-occurrence search can match inside added text only when the generated part lacks the trailer (minor G-m1).
2. #750: `outsideRepo` (config-validate.ts:92-94, tested), `LC_ALL=C` and `LANGUAGE=C` env (config-validate.ts:110, tested via injected exec), `.vitest/` in .gitignore, example-ok filter removed (config-files.test.ts:47, passes), `design` in KNOWN_LABELS (board-config.mjs:155, asserted in board-data.test.ts). All correct.

## Remaining Minors

- G-m1 board-model.mjs:224: trailer search can cut inside hand-added text when the existing body has no generated trailer; anchor the search or pin it with a test.
- G-m2 board-model.test.ts:65-86: no test for a changed generated part with CRLF, or for the trailer phrase inside added text.
- G-m3 board-model.mjs:216-221: `normalise` duplicated from `bodyUpdate`; hoist it.
- G-m4 board-model.mjs:229: the kept tail is normalized text (LF, trailing whitespace stripped); say so in the doc comment.
