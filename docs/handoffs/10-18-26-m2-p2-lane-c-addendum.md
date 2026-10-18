# Handoff addendum: M2 P2 Lane C gate chores, 10-18-26

Adds to [10-18-26-m2-p2-lane-c.md](10-18-26-m2-p2-lane-c.md); that file is not edited.

- Plan: gate chores job from M2 Manager 8 (no plan file): #750 gate boxes and #743.
- Branch and head: `chore/m2-c-gate-chores`, work head `0a81c7c7a8c91c0d65049cf21ba508e7f30f78e5` (reviewed, gate Opus 5.5 medium, approve), plus the review artifact and this addendum on top. Base `b2a14792ebc7f8f9820686e48505ffb1794390d3`.
- Done:
  - #750: `outsideRepo` guard (win32 drive and UNC) in `scripts/ci/config-validate.ts`; `gitShow` runs git with `LC_ALL=C` and `LANGUAGE=C` (injectable exec); `.vitest/` in `.gitignore`; dead `example-ok` filter removed from `scripts/ci/config-files.test.ts`; `--diff` limits in `docs/site-config.md`.
  - #743: `phaseBodyUpdate` in `scripts/ops/board-model.mjs`, used for phase parents through `keepBelow: true` in `scripts/ops/gh-setup-project.mjs`. Unit tests plus a static-source test; no test spawns the script.
  - `design` added to `KNOWN_LABELS` (`scripts/ops/board-config.mjs`) with its test (Refs #724).
- In progress: none.
- Rulings this depends on: manager plan approval for this job (worst case 5 review agents; hand fixes to gate files after `reviewedSha` void the artifact, so minors go to the manager).
- Open questions: none. Review minors left for the manager to file: G-G-m1 (`phaseBodyUpdate` cuts at the first "Grid and handoffs:" anywhere, so a body with no generated trailer but that phrase in added text loses text above it; anchor the search to the generated plan line), G-G-m2 (no test for a changed generated part with CRLF input, nor for the trailer phrase inside added text), G-G-m3 (the `normalise` helper is duplicated from `bodyUpdate`), G-G-m4 (the kept tail is normalized text: LF endings, trailing whitespace stripped).
- Next step: the manager files the four minors; after the PR merges, a live `gh-setup-project.mjs` dry run (no `--apply`) should plan no body update for #46. I did not run it (it reads the live API).
