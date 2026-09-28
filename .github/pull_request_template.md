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
- [ ] gate: `docs/reviews/pr-<n>.md` from Opus 5.5 at effort high or above
- [ ] critical: `docs/reviews/pr-<n>.md` from Opus 5.5 at effort xhigh or max

With an artifact, no gate or critical file this PR changes is changed again after its `reviewedSha` (a `main` merge that touches only `main`-side files is fine).

## Dependencies

<!-- Packages added or bumped, and why; "none" otherwise. -->

## Test plan

- [ ] Failing test first, then green (TDD); the failing test: <!-- name it -->
- [ ] `pnpm verify` (lint, typecheck, coverage, config:validate, gen:check)
- [ ] `pnpm audit --prod`
- [ ] Mock data only; no real person, vehicle or property records
