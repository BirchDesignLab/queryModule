---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "97050086245d4ee25b50680b307890ef7580fe27"
verdict: "approve"
---

# Review: feat/a-p3-ac1 (10-02-26)

## Scope

Branch feat/a-p3-ac1, range bf79e90e53ec32f366cb5ff95ecdc65c10841e10..97050086245d4ee25b50680b307890ef7580fe27, reviewed in two tier slices (gate Opus 5.5 medium, critical Opus 5.5 high).

The wave delivers ADR-0011 items 1 to 3: the versioned site config store (`site_config_version`, migration 0007, triggers that keep published history unrewritten, a startup trigger check), version 1 seeded from the SITE_CONFIG file with the store as the live source afterwards, full validation of the stored document on every boot (including a stored config_hash check), live activation of a draft in one transaction with configLoaded and the caller's event and a swap after commit, and in-flight submits keeping the snapshot they were planned against. Riders: #339 (replay integrity error with fixed text) and #337 (Task 19), plus the narrow pnpm audit ignores tracked by #492.

## Findings summary

- Critical: 0. Important: 0.
- Minor: 4 (gate slice 2, critical slice 2), all left for follow-up.
- Rulings kept as they stand: checker 09-29-26 rulings 1 and 2; sdd IC1 (activate refuses auth.mfaRequired); controller 10-02-26 (frozen authorship and lineage, startup refuses a stored hash mismatch); developer 10-02-26 (audit ignores, #492); #337 ruling (idle-expired sign-out records reason logout).
- Controller rulings accepted as non-blocking: seeding race between two processes, no seed audit row, Better Auth boot expiry, empty configLoaded.extendsChain (#494), mock not carried in LoadedConfig (#493).

## Cross-cutting checks

- New critical files under packages/api/src/admin/config/ are classified: .github/sensitive-paths lists admin/config/** as critical and admin/** as gate. The CLAUDE.md path list lags (minor).
- In-flight snapshot (ADR-0011 item 3): buildDeps runs checkConfigVersionTriggers before loadLiveConfig. Only prepareSubmit reads config on the submit path, and it carries the snapshot into acknowledge. No dispatch path reads live config yet.
- Fail-closed coverage: tests exist for a missing or altered trigger, a stored hash mismatch, a failed activation rollback, a stale draft and a 409 across a swap. Snapshot 0007 chains to 0006.
- Gate slice cross-cutting checks: see the gate report. It approved with no open critical or important finding.

## Answers to the controller's questions

None asked.

## Remaining Minors

- packages/api/drizzle/0007_site_config_version.sql:19-23: the frozen trigger lets a superseded row return to published in place when none is published. The app never does this, since rollback creates a new version. Harden in a follow-up migration with `OR (OLD.status = 'superseded' AND NEW.status <> 'superseded')` and re-pin it in migrate.ts.
- CLAUDE.md: add packages/api/src/admin/config/** (critical) and packages/api/src/admin/** (gate) to the landed paths list.
- packages/api/src/log/logger.ts:138 (gate): a literal line break replaced `\n` in the default sink template. Behaviour is the same; restore the escape.
- scripts/ops/board-model.mjs:124,138 (gate): marker dates are only shape-checked. Reject non-calendar dates and a finish before start.
