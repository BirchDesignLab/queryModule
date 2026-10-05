---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "4c2e7447531ec55cb2bb4e772bd54865964f25c3"
verdict: "approve"
---

# Review: feat/m2-a-p05-wave-2

Date: 10-05-26.

## Scope

Branch feat/m2-a-p05-wave-2, range cc435f15ef93991be05629ffa48feddf930f2a91..4c2e7447531ec55cb2bb4e772bd54865964f25c3. Two tier slices in one run: gate slice (Opus 5.5 medium, approve) and critical slice (Opus 5.5 high, this verdict).

The wave (M2 P0.5 Track A, wave 2) delivers: sensitive paths for P0.5 (config/** critical, fixture-policy.ts gate); admin validate, publish, rollback and draft save enforce the mock fixture policy (#532); the event_log table (migration 0010), appendEvent, latestSeq and pruneEventLog (#533); Adapter API v1, Secret, the adapter registry and minimal dispatch/timers.ts (#534); the mock adapter answering from the pinned snapshot's stored mock, with LoadedConfig.mock (#493); AW1 and AW2 review minors. Nothing is wired into deps or the submit path yet (AW3 Task 8).

## Findings summary

- Critical: 0. Important: 0 (both slices).
- Critical slice Minors: 2 (below).
- Rulings kept as stands: IC1 (draft save refuses a schema-invalid mock, errors outside /mock still save), C1 (config.mockSchema reported once on validate, publish and rollback), Q1/Q2 (draft-save config.mockSchema carries file; fixture.* messages carry no values), S1 (prune keeps each user's newest row, D-A14), Manager S1 (AW1), and the Stands list (event_log.status plain nullable TEXT; migration count pinned; registry error texts omit the kind; apiVersion not checked at runtime; registry logger required, factories optional; versionId on VersionedConfig).
- Controller ruling checked: deviation (a), lazy stored-mock fixture check inside the mock factory. All three must-check points hold: every mock answer comes from an adapter built by the checked factory for that exact snapshot (WeakMap memo per snapshot, checked object is the served object, answers cloned); a finding fails closed per snapshot with SourceError("failed") on every call and never throws from the registry; the one log line carries ids, count and pointers only.

## Cross-cutting checks

1. packages/core/src/config/fixture-policy.ts: pointers carry source ids, indices and key names only, never leaf values; the walk cannot throw on a parsed mock.
2. packages/core/src/config/resolve.ts checkMockCoverage: it safeParses the same raw mock, so load.ts MockFileSchema.parse cannot throw after coverage passes.
3. packages/api/src/db/tx.ts: withTransaction is IMMEDIATE on the single connection, so appendEvent's max+1 seq allocation is race-free.

## Answers to the controller's questions

None asked.

## Remaining Minors

- m1 packages/api/src/adapters/mock.ts:62: createMockAdapter is exported and unchecked; document it as test-only or move the fixture check into it before Task 8 wires dispatch.
- m2 packages/api/src/adapters/mock.ts:121-130: the checked snapshot.mock is the mutable object later served; clone (or deep-freeze) it in create and check the clone.
