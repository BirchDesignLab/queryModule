## Summary

<!-- What changed and why. One PR per wave in P0 (ADR-0006). -->

Closes #

## Requirement IDs

<!-- BR-, FR-, UX-, SEC-, NFR- or story IDs, verbatim. -->

## Rulings and carries

<!-- Rulings made (plan versus spec), follow-ups created, carries for later tasks or tracks. -->

## Sensitive paths

- [ ] No path in `.github/sensitive-paths` is touched, or
- [ ] `docs/reviews/pr-<n>.md` (Opus 5.5, effort xhigh, verdict approve) is committed and no sensitive file changed after its `reviewedSha`

## Test plan

- [ ] Failing test first, then green (TDD)
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm coverage`
- [ ] `pnpm audit --prod`
- [ ] Mock data only; no real person, vehicle or property records
