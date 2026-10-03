# Task 21d report

Implemented: #220 r1-a (strip-comments regex literals), #497 G-M1 (logger \n escape), #497 G-M2 (board-dates validation, both copies + parity case).
Already done on HEAD (no change): #220 M2 gate CLIs (changed-paths.mjs, check-schema-writes.ts, lockfile-guard.mjs use isMainModule; covered by scripts/ci/cli-main-guards.test.ts), #220 M4 (check-licences.test.ts has timeout 20_000).
RED: vitest on strip-comments, board-model: 3 failures (regex // eaten as comment; 2026-13-45 kept; finish<start kept). Logger test and parity case pass before and after (behaviour-preserving / both copies equally buggy).
GREEN: 4 touched suites 122/122. pnpm lint 0, typecheck 0. pnpm coverage/verify: only Diagnostics.test.tsx "an invalid edit..." times out at 5s under full load (flake #499), 3613 pass; passes alone.
Tickable: #220 r1-a, #220 M4 (already satisfied), #497 G-M1, G-M2. #220 M2 stays open (check-audit-migrations rides AC2; its box is already isMainModule on HEAD, add test exists).

## Fix round 1

- critic:C1 (scripts/ci/strip-comments.ts:7): removed `<` and `\n` from the regex-allowed set. Test: strip-comments.test.ts "strips a comment after a JSX closing tag or a line-leading division". RED: 1 failed (comment survived); GREEN: 7/7.
- spec:S1 (scripts/ops/board-model.mjs leafDates; .github/workflows/project-sync.yml leafDates): marker finish dropped when it precedes the effective (clamped) start; closed_at then applies. Tests: board-model.test.ts (finish alone before created_at, dropped start + earlier finish now finish 2026-10-02; finish-alone-valid case moved to 2026-10-01). RED: 2 failed; GREEN: board-model, project-sync parity (102/102).
- gate-0:1: declined noChangeNeeded (ruling IC1, flake #499); Diagnostics.test.tsx passes in isolation (4/4). Full pnpm coverage: 3614 passed, 1 failed (the same flake, 5 s timeout).
- pnpm lint exit 0 (1 info, pre-existing); pnpm typecheck clean.
- Boxes to tick: none.
