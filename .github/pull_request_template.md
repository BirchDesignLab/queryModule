## Summary

<!-- What changed and why. One PR per wave in P0 (ADR-0006). -->

Closes #

## Requirement IDs

<!-- BR-, FR-, UX-, SEC-, NFR- or story IDs, verbatim. -->

## Rulings and carries

<!-- Rulings made (plan versus spec), follow-ups created, carries for later tasks or tracks. -->

## Sensitive tier (ADR-0007)

- [ ] none or exempt: no review artifact
- [ ] deps (dependency fields, lockfile, `uses:` bumps): the ci job's automated checks only
- [ ] gate: review artifact from Opus 5.5 at effort medium (#92 cap)
- [ ] critical: review artifact from Opus 5.5 at effort high (#92 cap; no xhigh or max unless the developer asks)

The artifact is `docs/reviews/<branch>.md` (every "/" to "-"), which can land before the PR exists, or `docs/reviews/pr-<n>.md`. A PR whose gate and critical files change at most 50 lines may use the fast path (one reviewer, `mode: "fast"`).

With an artifact, no gate or critical file this PR changes is changed again after its `reviewedSha` (a `main` merge that touches only `main`-side files is fine).

## Dependencies

<!-- Packages added or bumped, and why; "none" otherwise. -->

## Test plan

- [ ] Failing test first, then green (TDD); the failing test: <!-- name it -->
- [ ] `pnpm verify` (lint, typecheck, coverage, config:validate, gen:check)
- [ ] `pnpm audit --prod`
- [ ] Mock data only; no real person, vehicle or property records
