# Handoff addendum 2: M2 P2 Lane C test hygiene and board minors, 10-18-26

Adds to [10-18-26-m2-p2-lane-c.md](10-18-26-m2-p2-lane-c.md) and [the first addendum](10-18-26-m2-p2-lane-c-addendum.md); neither is edited.

- Plan: two jobs from M2 Manager 8 (no plan file): test hygiene for #755 and #760 boxes, and the #758 board minors.
- Branch and head:
  - PR 1 `chore/m2-c-test-hygiene`, head `a093ab8c5e95323035eb70e925bbe2b10e595590`, PR [#766](https://github.com/BirchDesignLab/queryModule/pull/766) (ordinary tier, CI only).
  - PR 2 `chore/m2-c-board-minors`, work head `d7fbe5bad1f7ecabf32668021f1ffd9161740df0` (reviewed, gate Opus 5.5 medium, approve), plus the review artifact and this addendum on top. Base `c46ec5ead2d4498eaef202740de3d0a0661a702f`.
- Done:
  - PR 1: #755 T4 Q3 (export cap test lowers the cap through a `vi.mock` getter, one full 500-row batch), #755 T5 Q1 (order spy marks at commit), #760 T7 Q1 (explicit commit then ended order), #760 T9 Q2 (`audit.record` restored), #760 T9 Q3 (shared `test/helpers/sessions.ts`). Red proofs for T4, T5 and T7 against temporary `src` breaks.
  - PR 2: #758 G-G-m1 to m4 in `scripts/ops/board-model.mjs`: `phaseBodyUpdate` cuts only in a body that starts with `Phase parent for `, keeps the added tail byte for byte, and shares `normaliseBody` with `bodyUpdate`; new tests for CRLF, the trailer phrase in added text, and a body without the head. No test spawns the script.
- In progress: none.
- Rulings this depends on: manager job approvals (worst case 5 review agents; hand fixes to gate files after `reviewedSha` void the artifact, so minors go to the manager).
- Open questions: none. Review minors for the manager to file: G-m-1 (a body with the head but no generated trailer whose added text quotes the phrase loses the text above the quote; docstring overstates "never a cut"), G-m-2 (hand-typed text on the trailer line itself is dropped on a rewrite; document it), G-m-3 (`bodyUpdate`'s JSDoc is orphaned above `titleUpdate`'s; move it).
- Next step: the manager runs the live #46 dry run after PR 2 merges (no body update planned = pass).
- Note for the next lane: coverage on `packages/api/src/audit/**` is 100% branches; a test that lowers the export cap below one batch (500) loses the empty-final-batch branch.
