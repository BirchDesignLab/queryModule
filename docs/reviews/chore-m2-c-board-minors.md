---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "d7fbe5bad1f7ecabf32668021f1ffd9161740df0"
verdict: "approve"
---

# Review: chore/m2-c-board-minors (10-18-26)

## Scope

Branch chore/m2-c-board-minors, range c46ec5ead2d4498eaef202740de3d0a0661a702f..d7fbe5bad1f7ecabf32668021f1ffd9161740df0, gate tier: `scripts/ops/board-model.mjs`, `scripts/ops/board-model.test.ts`. Delivers #758 (G-G-m1 to m4 from the PR #759 review): `phaseBodyUpdate` cuts only in a body that starts with the generated head, at the first trailer line; keeps the added tail byte for byte; shares one normalizer with `bodyUpdate`; new tests for CRLF, a quoted trailer phrase and a body without the head.

## Findings summary

Critical 0, important 0, minor 3. No ledger rulings or controller rulings were contested.

## Cross-cutting checks

1. `scripts/ops/gh-setup-project.mjs:488-490, 564-565`: only phase parent specs (`keepBelow`) go through `phaseBodyUpdate`; the generated body starts with `Phase parent for ` and carries the trailer once, on its last line.
2. Live #46 body (read only): simulated a changed Gate line; all hand-added lines kept exactly, rerun returns null, CRLF variant the same.
3. `board-model.test.ts` at head: 64 passed.

## Answers to the controller's questions

1. Yes. Unchanged plus added returns null (board-model.mjs:225). A changed generated part returns the new body plus the old tail from the original bytes (:233-234). CRLF keeps the trailer line's own terminator. A quoted phrase in the added text is never the cut, because the first trailer line is the generated one (:230-232). A body without the head is replaced whole (:226). Live #46 keeps its checklists. Every output converges to null on rerun, so there is no loop. One residual edge is listed as minor m-1.

## Remaining Minors

- m-1 board-model.mjs:226-237: if a body has the head but no trailer in its generated part and quotes the phrase in added text, it is cut at the quote. The docstring claim at :216-217 is too broad. No live body has this shape.
- m-2 board-model.mjs:232-234: hand text on the trailer line itself is dropped when the generated part changes; document it.
- m-3 board-model.mjs:42-53: the orphaned `bodyUpdate` JSDoc sits above `titleUpdate`; move it to :201.
