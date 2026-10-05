---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "5ce31aba77602e59fe71bd2236c9767530bd42b5"
verdict: "approve"
---

# Review: feat/m2-p0-wave-1 (critical slice)

Date: 10-05-26.

## Scope

Branch feat/m2-p0-wave-1, range 2ee749e3d7a445cada175374d53ed61b55fa141c..5ce31aba77602e59fe71bd2236c9767530bd42b5. The wave delivers M2 P0 Wave 1:

- Task 1 (#520, #511 CFG-3, D-M2P0-2 prototype shortcut): `site_config_version.document_hash` (migration 0009 plus the recreated frozen trigger), set at seed and publish, verified at boot before schema defaults apply, one-time boot backfill of pre-0009 published rows, version-id stale-snapshot check in publish and rollback, optional `versionId` on `configLoaded`. Follow-up for the proper fix: #558.
- Task 2 (#521, D-M2P0-1): `resultHidden` and `resync` WebSocket contracts per spec 4.7, regenerated `ws-events.schema.json`, ADR-0013 (tolerant client receipt, strict server).

Critical files reviewed in full: the 0009 migration and meta, `admin/config/activate.ts`, `publish.ts`, `store.ts`, `db/migrate.ts`, `db/schema.ts`, `startup.ts`, `contracts/audit.ts`, `contracts/ws.ts`, `ws-events.schema.json`. The gate slice ran first and approved with no open critical or important finding.

## Findings summary

- Critical: 0. Important: 0. Minor: 2 (below).
- Ledger rulings kept as they stand: Task 1 checker rulings (gen:check, check-audit-migrations) verified; controller ruling on deferred minors S1 (release-note line at M2 exit) and Q1 to Q3 (cosmetic) stand.
- S2 (0009 over a populated 0008 store): the controller let it stand, and the manager asked for it to be verified. I verified it with a run, not by reasoning alone (see Cross-cutting check 3). It holds, so no finding.

## Cross-cutting checks

1. Backfill writing under an unverified trigger: `deps.ts:71-77` runs migrations and all three trigger checks before `loadLiveConfig`. No gap.
2. A leftover stored-hash comparison causing a permanent `draftConflict` or 409: the only other `configHash` comparison in `packages/api/src` is `queries/prepare.ts:49` (request hash against served hash, the intended spec 6.7 one-time 409 and refetch). No gap.
3. Upgrade of a populated 0008 store: a disposable probe migrated a fresh encrypted database to 0008 and filled it with superseded, published and draft rows. It then booted through `buildDeps` with 0009. The test showed:
   - Every non-hash column was unchanged.
   - Only the published row got `document_hash`, and it equals sha256 of canonical JSON.
   - A set hash could not be changed or reset to NULL.
   - A row whose `config_hash` matched neither rule refused boot with `config.hashMismatch` and wrote nothing.

## Answers to the controller's questions

1. Fail-open: no.
   - A published row cannot boot without either a verified `document_hash` (`store.ts:162`) or a verified backfill, which throws before any write (`store.ts:93-94`).
   - Seed and publish always set the hash (`store.ts:129`, `activate.ts:128`).
   - The 0009 trigger freezes a set hash for every status, including a reset to NULL (`0009_config_document_hash.sql:6`).
   - `checkConfigVersionTriggers` compares the collapsed stored SQL exactly against the pin (`migrate.ts:69-76, 408`).
2. Publish and rollback after a schema default: both succeed.
   - Both compare version ids (`publish.ts:137`), and the snapshot `versionId` is set at boot (`store.ts:180`) and after each activate (`activate.ts:162`).
   - `previousConfigHash` is the served hash (`publish.ts:147`).
   - `configLoaded` and `configPublished` carry ids, hashes and pointers only (`activate.ts:146-154`, `startup.ts:89-96`, `audit.ts:220-226`, `publish.ts:155-163`).
3. WebSocket contracts: they match spec 4.7.
   - `resultHidden` and `resync` are exactly the spec 4.7 shapes, as strict objects (`ws.ts:53-69`). `resultIds` is narrowed to non-empty UUIDv7.
   - `resync` is in the server union only, not in `WsEventSchema` (`ws.ts:79-92`).
   - ADR-0013 matches D-M2P0-1, and spec 4.7 carries "Overridden by ADR-0013."
4. S2: yes.
   - 0009 has no row effect.
   - The backfill verifies under today's rule (the current-schema resolve) or the stored-siteConfig rule, and fails closed with no write.
   - It writes only `document_hash` with an `IS NULL` guard (`store.ts:95-99`), which is the trigger's one-time NULL-to-value allowance.

## Remaining Minors

- `packages/api/src/admin/config/store.ts:95-99`: the backfill UPDATE does not check the number of rows changed. If 0 rows change, the published row stays NULL until the next boot re-verifies it. This does not fail open. Fix: assert one row changed.
- `packages/core/src/contracts/ws.ts:59`: `resultIds` has no upper bound. Fix: add `.max(n)` at the per-query source cap.
