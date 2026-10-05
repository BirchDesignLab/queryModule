# M2 P0 Contracts Implementation Plan

Status: draft 10-05-26 (session "M2 planning 1"), written against `main` at `76464d8` (M1 exit, `m1` promoted); revised the same day after a plan critic, an adversarial review of the sensitive designs and a skeptic review of sequencing and scope. Decisions D-M2P0-1 to D-M2P0-5 ruled by the developer 10-05-26 (below).

> **For agentic workers:** Recommended: run each task through the `sdd-task` workflow (`.claude/workflows/sdd-task.js`) at the task's tier, a whole wave through `sdd-wave`, and each wave PR that touches sensitive paths through `wave-review` (ADR-0006, ADR-0007). Inline small, fully specified changes (CLAUDE.md "Inline small specified changes"). TDD is required whichever way a task runs. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the M2 contracts so M2 P0.5 (dispatch) and M2 P1 (feed) build against fixed shapes: the WS receipt policy and the `resultHidden` and `resync` messages, the `assessResult` contract, the M2 audit catalogue (admin audit, `adminViewed`, `passwordChanged`, `roleChanged.fromRole`, `sessionRevoked.targetUserId`), request-key versioning, the publish change note, and OpenAPI for `GET /api/v1/queries`, the admin audit routes and admin queries. First, fix the config store's boot hash check (CFG-3) so no schema addition can brick a deployed store.

**Architecture:** Contracts live in `packages/core/src/contracts/**` and `packages/core/src/config/schema.ts`, with generated `packages/api/openapi.json` and `packages/core/contracts/ws-events.schema.json` drift-checked in CI. Contract changes follow master plan 8 (one change per PR, recorded). The server sends none of the new WS messages yet (P1). New audit types are contract-only: `audit_event.type` has no CHECK constraint, so no migration is needed for a new type.

**Tech Stack:** Node 24 LTS, TypeScript strict, `zod` v4, `vitest`, `fast-check`. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-25-query-module-2-design-v2.md`: 4.5 (mapper, `assessResult`), 4.7 (contracts, WS messages, audit catalogue), 5.1 (routes), 5.2 (sweeper), 5.5, 6.8, 12.3, 12.7 M2 row. Master plan `2026-09-25-implementation-master-plan.md` 4.1 M2 P0 row, section 8. ADR-0011 (config store), ADR-0012 (P0.5 dispatch). Carry issue #511 (P0 items).

**Track:** Core and contracts, one owner session (master plan 3.3). Lane: **B** (`C:\git\queryModule`), because Track A's lane runs the longer M2 P0.5 dispatch chain beside it (ADR-0012: P0 may run before or beside P0.5).
**Phase:** M2 P0 contracts. Phase parent: #43 (epic "Contracts (M2 P0)").
**Gate:** Contracts frozen; OpenAPI diff (oasdiff) reviewed in the PR; `stories.json` has A6 to A9; master plan 8 log records each contract change; `pnpm verify` green on `main`.

## Decisions (ruled 10-05-26)

- **D-M2P0-1 WS receipt policy (#511 C-M4, #66): tolerant clients.** Clients drop a server message whose `type` they do not know and strip unknown keys from known types; the server stays strict on what it sends and receives. An additive WS change therefore needs no `MIN_CLIENT_VERSION` bump; a breaking change (removed or retyped field, changed meaning) still bumps it. Recorded as ADR-0013. The client half is built in M2 P0.5 Track B (feed socket parser); the heartbeat probe and `ApiError` parser half stays #66 (M2 P1 Track B).
- **D-M2P0-2 CFG-3: verify the stored document as stored (prototype shortcut).** Today the row's `config_hash` is the hash of the resolved `siteConfig` (`config/load.ts:258`), so it cannot verify stored bytes. Task 1 adds a nullable `document_hash` column (SHA-256 of the stored document's canonical JSON). It is set when a row becomes published (in `activate()`, the only path from draft to published, and in the seed insert), never on draft save, because drafts are updated in place (`admin/config/draft.ts:120-127`). Existing published rows are backfilled once at boot in JS (libsql has no `sha256`), only after they verify under today's rule. Boot verifies `document_hash` as the tamper check, then parses with the current schema (defaults applied) and recomputes the served `configHash`. The holder snapshot carries a non-null `versionId`; publish and rollback compare version ids instead of hashes (`admin/config/publish.ts:135`), so a recomputed hash never causes a permanent `draftConflict`. After an upgrade that adds a default, clients holding the old hash get one 409 and refetch (spec 6.7). This is knowingly not the right long-term fix: the right fix is a config schema version with an audited migration of stored rows, so stored documents always match the running schema. Chosen for the prototype because it is smaller and fixes the outage class now. The code comment, ADR-0011 addendum and release notes say so, and a follow-up issue holds the proper fix (label `decision`, no milestone).
- **D-M2P0-3 Request-key versioning (#511, from #311).** Task 5 starts with a narrow ruling (Opus 5.5 `low`): the comment at `packages/api/src/keys/request-keys.ts:9-14` says `key_version` deliberately records the wrapping DATA_KEY version, which is what a rotation needs; #511 asks for an independent `REQUEST_KEY_VERSION`. Recommended default: a separate row format version only if the AAD or wrap format changes; otherwise document the alias as intended and close the box. The ruling is recorded in the task report and on #511.
- **D-M2P0-4 Publish change note and "who" (#507, #511).** Contract only in P0: the publish request takes an optional `note` (plain text, at most 200 characters, never query values) and `ConfigVersion` exposes `note` and the publisher's display name. Persistence (column, store write) and the history drawer land with the M2 P2 audit viewer.
- **D-M2P0-5 Demo scope (developer 10-05-26).** The developer's demo comes at a thin M2 P1: live per-source status, plus results shown in display cards whose mapping is configured and published from the admin builder like the query form (mapper, generic dump fallback, severity badge). Replay, resync and the ack-receipt metric come after the demo. Therefore this plan runs Tasks 1, 2, 3, 7 and 8 before the demo (the M2 P1 inputs) and **Tasks 4, 5 and 6 after the demo** (wave P0-W3; audit catalogue, request-key ruling, publish note). CFG-4 moved to M2 P3.

## Session start

1. Root the session in the Track B lane folder `C:\git\queryModule`. Never root it in another lane's folder, the manager's worktree or a planning worktree; never switch branches or stash in another lane's folder.
2. Read `docs/superpowers/plans/STATUS.md` (Active sessions, M2 rows), this plan, and the manager's start brief. Claim the Active sessions row.
3. Caps (CLAUDE.md, #92, #391): no `xhigh` or `max`; per-task review is one Opus 5.5 `medium` reviewer with spec, quality and critic lenses; `wave-review` at the PR tier (critical Opus 5.5 `high`, gate Opus 5.5 `medium`); `maxRounds: 2` on every launch; set `model` and `effort` on every agent (Haiku: model only). State the role plan and agent count before each wave and wait for the manager's go.
4. Pushes and merges: ask before every push (the M2 manager session's push approvals count as the developer's); the developer merges every PR.
5. Limits and handover (developer 10-05-26; numbers are rough, plus or minus 10%):
   - Context window: an inline build session hands over near 35% of its context; a session that mostly runs `sdd-task` or `sdd-wave` workflows near 50%; the manager near 50%. Check with `get_usage` (session tools) at each task and wave boundary, before each workflow launch, and at each push request.
   - Usage limits: check the 5-hour window and the weekly limit at the same points. Do not launch a workflow (or a wave-review) that is unlikely to finish inside the remaining 5-hour window; past about 85% of the 5-hour window, or about 90% of the weekly limit, finish the current item and pause instead of starting the next. Tell the manager when pausing.
   - Hand over at a logical point near the line, never mid-task or mid-workflow: finish the current task or wave step, commit locally, write `.superpowers/sdd/<plan>/handover.md` (state, branch and sha, open rulings, next step), update the STATUS handoff note, and tell the manager, who writes the next session's start brief.

## Global Constraints

- Runtime Node 24 LTS (ADR-0001); TypeScript strict, no `any`; `packages/core` pure (no IO, clock or randomness).
- Contract first: every change under `packages/core/src/contracts/**`, `packages/core/src/config/schema.ts` or `packages/api/openapi.json` follows master plan 8 (record the change in the master plan 8 log in the same PR). Regenerate derived files with `pnpm gen` and commit them; `check-generated` must pass.
- Additive only, except where a task says otherwise. oasdiff runs in CI with `--fail-on ERR`; a response enum value added is ERR (label `api-breaking` plus a release-note line, memory: oasdiff enum ERR).
- Audit details hold identifiers, metadata and `role: "type"` values only; never query values, payloads, passwords or notes containing values.
- Required new audit fields ship with their writers in the same PR so no writer breaks (or are optional first, required in the PR that updates the writers).
- Migrations: P0-W1 (Task 1) adds `0009` (`document_hash` column and the recreated frozen-row trigger; the backfill runs at boot, not in SQL); M2 P0.5's `event_log` takes `0010`. Any other migration takes the next free number at branch time; whichever of P0 and P0.5 merges second renumbers (`drizzle-kit` regenerates `meta/`).
- Audit rows are append-only: rows written before M2 lack the new fields. Contract schemas for new fields keep stored rows readable: readers (M2 P2 viewer and export) parse with the tolerant read schema, writers must set the field (writer schema). Task 4 adds an old-shape-row test.
- Shared files across lanes: P0 Task 4 and P0.5 A Task 16 both touch `packages/api/src/auth/**`; whichever merges second rebases.
- Windows lane: Git Bash first on PATH; API tests use `openTempDatabase`; win32 teardown best-effort.
- Docs: no em dashes; dates MM-DD-YY in prose, ISO in code and file names.

### Model and effort plan (CLAUDE.md as amended by #92 and #391)

| Task tier | Implementer | Review (one reviewer: spec, quality, critic lenses) | Max rounds | Ruler |
|---|---|---|---|---|
| Ordinary | Sonnet 5.5 `medium` | Opus 5.5 `medium` | 1 | Opus 5.5 `low` |
| Gate | Sonnet 5.5 `medium` | Opus 5.5 `medium`, gate-risk focus | 2 | Opus 5.5 `low`, sensitive ruler rule |
| Critical | Opus 5.5 `medium` | Opus 5.5 `medium`, sensitive-code focus | 2 | Opus 5.5 `medium`, sensitive ruler rule |

Per wave PR: `wave-review` at the PR's tier (fast path when critical plus gate lines are 50 or fewer). Inline candidates (about 150 lines or fewer, design fixed): Tasks 6, 8. Wave critics: none (contracts; the critical wave-reviews cover P0-W1 and P0-W3). Enumeration: Haiku 4.5 (effort n/a). Verify one claim: Sonnet 5.5 `low`.

## Interfaces consumed (on `main` at `76464d8`)

| Item | Where |
|---|---|
| Config store boot check | `packages/api/src/admin/config/store.ts:135-139` throws `config.hashMismatch` when the stored `configHash` differs from the hash of the loaded (defaults-applied) document |
| Response mapping | `MappingElement` (discriminated union `value` \| `table`), `ResponseMapping` (`packages/core/src/config/schema.ts:105-123`, default `[]` at :202); `client-config.ts:48`; `validate-rules.ts:235` |
| WS | `packages/core/src/contracts/ws.ts:53-69`: strict objects, closed discriminated union; `WsEventSchema` = `sourceStatus` only; `MIN_CLIENT_VERSION` is env only (`packages/api/src/env.ts:85`, `MetaResponse.minClientVersion`, client gate `packages/client/src/meta/version.ts:28`) |
| Audit | `AUDIT_EVENT_TYPES` (`packages/core/src/contracts/audit.ts:43-59`); `RoleChangedDetails` (`audit-auth.ts:52-57`, no `fromRole`); `SessionRevokedDetails` (`audit-auth.ts:60-63`, `sessionId`, `reason`) |
| Keys | `REQUEST_KEY_VERSION = CURRENT_KEY_VERSION` (`packages/api/src/keys/request-keys.ts:14`, canary `keys/canary.ts:10`) |
| Admin config contract | `ConfigVersionSchema` (`packages/core/src/contracts/admin.ts:30-41`: `createdBy`, `publishedBy` ids, no note) |
| Routes | `packages/core/src/contracts/routes.ts` (`ROUTES`); `openapi.json` has `POST /queries` only for queries; admin config, users, sessions routes present |
| CI | oasdiff job `.github/workflows/ci.yml:166-189`; `scripts/ci/check-story-tags.ts`; `docs/testing/stories.json` (A1 to A5) |

## Interfaces produced

- ADR-0013 (WS receipt policy); master plan 8 log entries for each contract change.
- `ResultHiddenEventSchema { v, type: "resultHidden", seq, at, correlationId, resultIds: string[] }` in `WsEventSchema`; `ResyncMessageSchema { v, type: "resync", reason: "tooOld" | "tooMany" | "unknownCursor", latestSeq }` in the server message union (spec 4.7).
- `Assessment`, `AssessmentSchema`, `Severity`, `AssessResult` signature type (spec 4.5); `MappedResult` and `MapResponse` signature types.
- Audit types `auditViewed`, `auditExported`, `adminViewed`, `passwordChanged`; `roleChanged.details.fromRole`; `sessionRevoked.details.targetUserId`.
- Admin publish `note`, `ConfigVersion.note`, `ConfigVersion.publishedByName`.
- Routes and OpenAPI: `GET /api/v1/queries`, `GET /api/v1/queries/:correlationId`, `GET /api/v1/admin/audit`, `GET /api/v1/admin/audit/export`, `GET /api/v1/admin/queries/:correlationId`.
- `stories.json` entries A6 to A9.

## Interfaces from other plans

- M2 P0.5 Track A (`2026-10-05-m2-track-a-p0-5.md`) Wave AW2 edits `admin/config/**` and the config snapshot, and needs Task 1 (CFG-3, snapshot `versionId`, migration `0009`) merged first (P0-W1). AW4 does not depend on this plan (`welcome.latestSeq` is frozen since M0 P0).
- M2 P0.5 Track B Task 5 builds the tolerant client parser (D-M2P0-1) against the `ws.ts` union from Task 2 (P0-W1).
- M2 P1 consumes `GET /api/v1/queries`, `resync`, `assessResult`; M2 P2 consumes the audit types, publish note and admin audit routes.

## File Structure

| File | Action | Tier | Responsibility |
|---|---|---|---|
| `packages/api/src/admin/config/{store,publish}.ts`, `db/schema.ts`, `drizzle/0009_config_document_hash.sql`, `config/load.ts`, `deps.ts` (snapshot `versionId`), tests | Modify, Create | critical (gate for `deps.ts`) | CFG-3 |
| `docs/decisions/0011-admin-console-and-config-store.md` | Modify (addendum) | ordinary | CFG-3 shortcut note |
| `docs/decisions/0013-ws-receipt-policy.md`, `docs/decisions/README.md` | Create, Modify | ordinary | D-M2P0-1 |
| `packages/core/src/contracts/ws.ts`, `ws.test.ts`, `packages/core/contracts/ws-events.schema.json` | Modify, regenerate | critical | `resultHidden`, `resync` |
| `packages/core/src/contracts/assess.ts`, `assess.test.ts`, `index.ts` | Create, Modify | ordinary | `Assessment` and signatures |
| `packages/core/src/contracts/audit.ts`, `audit-auth.ts`, tests | Modify | critical | audit catalogue M2 |
| `packages/api/src/admin/users/users.ts`, `packages/api/src/ops/grant-role.ts`, `packages/api/src/auth/auth.ts` (after hook) | Modify | gate | writers for new fields and `passwordChanged` |
| spec audit table (`docs/superpowers/specs/2026-09-25-query-module-2-design-v2.md` 4.7) | Modify | ordinary | `passwordChanged` row, new fields |
| `packages/api/src/keys/request-keys.ts`, `keys/*.test.ts` | Modify (per D-M2P0-3) | critical | request-key versioning |
| `packages/core/src/contracts/admin.ts` | Modify | ordinary | publish note, publisher name |
| `packages/core/src/contracts/routes.ts`, `queries.ts`, `packages/api/openapi.json`, client generated types | Modify, regenerate | ordinary | GET queries, admin audit, admin queries |
| `docs/testing/stories.json`, `scripts/ci/check-story-tags.ts` (only if needed) | Modify | ordinary / gate | A6 to A9 |
| `docs/superpowers/plans/2026-09-25-implementation-master-plan.md` (section 8 log only), `STATUS.md` | Modify | ordinary | records |

## Waves

| Wave | Tasks | PR tier (review) | Blocked by | Notes |
|---|---|---|---|---|
| P0-W1 | 1, 2 | critical: `wave-review` Opus 5.5 `high` | none | CFG-3 (migration `0009`) and the WS contracts with ADR-0013: Track A's and Track B's only P0 blockers, in one critical review. Tell the manager when it merges |
| P0-W2 | 3, 7, 8 | ordinary: CI only (oasdiff reviewed in the PR body) | none (may run in parallel with P0-W1; rebase on it before merge) | `assessResult` and mapper contracts, routes and OpenAPI, stories: the M2 P1 inputs |
| Gate (demo) | 9 | ordinary | P0-W1, P0-W2 merged | freeze record for the demo path, STATUS |
| P0-W3 (after the demo) | 4, 5, 6 | critical: `wave-review` Opus 5.5 `high` (gate slice for `admin/users/**`, `ops/**` writers; Task 4 also touches `auth/routes.ts`) | the developer's demo done; P0-W1 merged | audit catalogue with writers, request-key ruling, publish note (optional fields). Must merge before M2 P2 starts |

Branches `feat/m2-p0-wave-<k>` from `main`. Scope freezes when the wave's review starts. `maxRounds: 2` on every launch.

### Task 0: Open the phase (done by the planning session)

Issues for this plan and both P0.5 plans are created by `scripts/pm/gh-create-m2-p0-issues.mjs` (as BirchDesignLab per call) in the planning PR; headings below carry their numbers. Carried issues are linked, not recreated: #511 (P0 boxes), #66 (policy only). STATUS M2 P0 cell `planned` -> `active` is the lane's first commit.

---

## Wave P0-W1: config store boot check and WS contracts (critical)

### Task 1: CFG-3: verify the stored document's hash as stored (#520)

**Files:** Modify `packages/api/src/db/schema.ts`; create `packages/api/drizzle/0009_config_document_hash.sql` (plus `meta/`); modify `packages/api/src/db/migrate.ts` (the pinned `CONFIG_VERSION_TRIGGER_SQL`, `:161-166`, so `checkConfigVersionTriggers` accepts the recreated trigger), `packages/api/src/admin/config/store.ts` (boot verify and one-time backfill, seed insert sets the hash), `admin/config/activate.ts` (publish sets `document_hash`; the swapped snapshot carries `versionId = done.id`, `:46,102`), `admin/config/publish.ts` (compare version ids at `:135`; `previousConfigHash` from `snapshot.configHash` at `:145`), `packages/api/src/config/load.ts` and `deps.ts:28-30` (`LoadedConfig.versionId: string`, non-null on the holder), `packages/core/src/contracts/audit.ts` (`configLoaded` details gain optional `versionId`), `startup.ts:91` (writes it), tests under `packages/api/test/admin/config/` and `test/db/`, `docs/decisions/0011-admin-console-and-config-store.md` (addendum). About 9 files: run it through `sdd-task` at the cap, or split 1a (column, trigger, publish-time hash, backfill, boot verify) and 1b (versionId compare, audit links); the report says which.
**Interfaces:**
- `document_hash` (nullable TEXT) = SHA-256 of `canonicalJson(document)` as stored (reuse `canonicalJson`, `store.ts:139-143`). Set in `activate()`'s publish UPDATE from `row.document` and in the seed insert; drafts keep NULL (they are updated in place, `draft.ts:120-127`).
- Migration `0009`: adds the column; drops and recreates `site_config_version_frozen` (from `0008`) with `OR (OLD.document_hash IS NOT NULL AND NEW.document_hash IS NOT OLD.document_hash)`, so a set hash is frozen and cannot be reset to NULL. No SQL backfill (libsql has no `sha256`).
- One-time boot backfill (in `bootstrap()` before the boot check, published rows with `document_hash IS NULL` only): accept a row only if `sha256(canonicalJson(stored siteConfig)) === config_hash` (seeded and published documents store the resolved `siteConfig`, `load.ts:322`; a test pins that), else if today's rule holds (hash of the defaults-applied resolve equals `config_hash`); then write `document_hash`. If both fail, refuse startup (`config.hashMismatch`). The production upgrade from `m1` runs this once.
- Boot (`store.ts:125-138`, the published row only, as today): verify `document_hash`, refuse with `config.hashMismatch` on a mismatch, then parse with the current schema and recompute `configHash` from the resolved `siteConfig` (spec meaning unchanged). `configLoaded` records `versionId` so the served hash joins to a stored version.
- Code comment at the check: "Prototype shortcut (D-M2P0-2): verify the stored document as stored, then apply defaults. The proper fix is a config schema version with an audited migration of stored rows; see #<follow-up>."
**IDs:** NFR-003, SEC-010 (tamper refusal kept); ADR-0011; #511 CFG-3; review `docs/reviews/m1-phase-review.md` CFG-3.
**Tier:** critical (`admin/config/**`, `db/**`, `drizzle/**`, `contracts/audit.ts`, `startup.ts`; `deps.ts` gate).

- [ ] **Step 1.1: Failing tests:**
  - a stored published row whose document omits a field that the current schema defaults (a fixture written without it): startup succeeds, the loaded document has the default, a publish right after boot succeeds (no `draftConflict`), and a second publish after that also succeeds (snapshot `versionId` set by `activate`);
  - save the draft twice (in place), publish, restart: boot succeeds (the hash was taken at publish);
  - a published row whose stored document was altered after publish (the test drops the frozen trigger in its temp DB to tamper) refuses with `config.hashMismatch`;
  - an `UPDATE` of `document_hash` on a published row, or setting it to NULL, aborts (trigger); `checkConfigVersionTriggers` accepts the new trigger;
  - backfill: a migrated temp DB with an `0008`-era published row gets `document_hash` at first boot; a row whose `config_hash` matches neither rule refuses startup;
  - `previousConfigHash` in `configPublished` equals the served hash; `configLoaded` carries `versionId`.
- [ ] **Step 1.2: Run** `pnpm --filter @querymodule/api exec vitest run test/admin/config`. Expected: FAIL, `config.hashMismatch` on the defaulted-field case.
- [ ] **Step 1.3: Implement** (`drizzle-kit generate --name config_document_hash`, then the store); `check-audit-migrations` passes; file the follow-up issue for the proper fix (schema version plus audited migration; `decision`, no milestone) and put its number in the comment.
- [ ] **Step 1.4: Run** the API suite (PASS); full `pnpm verify`.
- [ ] **Step 1.5: Commit** `fix(api): config store verifies the stored hash before defaults (CFG-3, prototype shortcut)`; PR body `Refs #511`.

### Task 2: WS receipt policy (ADR-0013); `resultHidden` and `resync` contracts (#521)

**Files:** Create `docs/decisions/0013-ws-receipt-policy.md`. Modify `docs/decisions/README.md`, `packages/core/src/contracts/ws.ts`, `ws.test.ts`, regenerate `packages/core/contracts/ws-events.schema.json`; master plan 8 log entry.
**Interfaces (spec 4.7):** `ResultHiddenEventSchema` joins `WsEventSchema` (it carries `seq`; replayable); `ResyncMessageSchema` joins the server-to-client union (no `seq`). The server union stays strict. ADR-0013 records D-M2P0-1: clients parse receipt tolerantly (drop unknown `type`, strip unknown keys, drop and count a known type that fails its schema), additive changes need no `MIN_CLIENT_VERSION` bump, breaking changes do; the client implementation is M2 P0.5 Track B Task 5 (feed socket) and #66 (heartbeat probe, `ApiError`). Clients dedup by `seq` high-water mark (spec 4.7), so the server must publish each user's events in `seq` order; M2 P0.5 Track A Task 9 guarantees that (two T2 commits for one user could otherwise publish out of order and the client would drop the lower one).
**IDs:** FR-065, NFR-003; spec 4.7, 6.8; #511 C-M4; #66 (policy).
**Tier:** critical (`contracts/ws.ts`, `ws-events.schema.json`).

- [ ] **Step 2.1: Failing tests** `ws.test.ts`: a `resultHidden` with two result ids parses in `WsEventSchema` and `WsServerMessageSchema`; one with an extra key fails (server strict); `resync` with each reason parses; an unknown reason fails; `sourceStatus` parsing is unchanged (existing cases pass).
- [ ] **Step 2.2: Run** `pnpm --filter @querymodule/core exec vitest run src/contracts/ws.test.ts`. Expected: FAIL.
- [ ] **Step 2.3: Implement**; `pnpm gen`; write ADR-0013; **Step 2.4: Run** `pnpm verify` (PASS, generated files match).
- [ ] **Step 2.5: Commit** `feat(core): resultHidden and resync WS contracts; ADR-0013 tolerant client receipt (spec 4.7)`.

---

## Wave P0-W2: assessResult and mapper contracts, routes, stories (ordinary)

### Task 3: `assessResult` and mapper contracts; response mapping freeze review (#522)

**Files:** Create `packages/core/src/contracts/assess.ts`, `assess.test.ts`. Modify `packages/core/src/contracts/index.ts`.
**Interfaces (spec 4.5):**

```ts
export const SEVERITIES = ["none", "info", "caution", "critical"] as const;   // exact list per spec 4.5; reviewer checks
export type Severity = (typeof SEVERITIES)[number];
export const AssessmentSchema: z.ZodType<Assessment>;   // { severity, hits: { keyword, severity, marker, pointer }[] }
export type AssessResult = (payload: SourcePayload, keywords: readonly KeywordRule[]) => Assessment;
export type MapResponse = (payload: SourcePayload, mapping: ResponseMapping, view: "summary" | "detail") => MappedResult;
```

Field names follow spec 4.5 exactly (the implementer reads 4.5 lines 470-520 and the reviewer cites them). Implementations are M2 P1 (Track B plan, Core cells). Freeze review: compare `MappingElement` and `ResponseMapping` (`schema.ts:105-123`) with spec 4.5; list each delta in the task report; fix only additive deltas here (an additive config default is safe once Task 1 is merged).
**IDs:** FR-045 to FR-049 as cited by spec 4.5 (reviewer checks the exact IDs); spec 4.5.
**Tier:** ordinary.

- [ ] **Step 3.1: Failing tests:** `AssessmentSchema` parses a spec 4.5 example; rejects an unknown severity; type-level tests (`expectTypeOf`) for both signatures.
- [ ] **Step 3.2: Run** `pnpm --filter @querymodule/core exec vitest run src/contracts/assess.test.ts`. Expected: FAIL.
- [ ] **Step 3.3: Implement**; **Step 3.4: Run** `pnpm verify`; **Step 3.5: Commit** `feat(core): assessResult and mapResponse contracts (spec 4.5)`.

### Task 7: Routes and OpenAPI: queries, admin audit, admin queries (#526)

**Files:** Modify `packages/core/src/contracts/routes.ts`, `queries.ts` (or a new `admin-audit.ts` contract module), tests; regenerate `packages/api/openapi.json` and client generated types.
**Interfaces (spec 5.1):** `GET /api/v1/queries` (session; caller's requests, newest first, cursor and limit, hidden rows excluded), `GET /api/v1/queries/:correlationId` (session, owner policy; parts, sources, status, payloads for `returned`), `GET /api/v1/admin/audit` (admin; filters user, correlation ID, type; window at most 31 days; cursor; limit at most 200), `GET /api/v1/admin/audit/export` (admin; same filters; NDJSON), `GET /api/v1/admin/queries/:correlationId?includeHidden=true` (admin). Response schemas exactly as spec 5.1 and 5.5 describe; the admin audit and export responses carry audit rows through the tolerant **read** schema (stored rows written before M2 lack later fields; a strict response parse would 500 on them; test with an old-shape row once P0-W3 adds fields). The API mounts none of them yet (contract only; a route-matrix row asserts 404 until P1/P2 if the matrix enumerates `ROUTES`, else the matrix skips unmounted routes, the reviewer checks which).
**IDs:** FR-062, FR-063, FR-065, SEC-012; spec 5.1.
**Tier:** ordinary (`routes.ts`, `openapi.json` are not sensitive paths).

- [ ] **Step 7.1: Failing tests:** each route present in `ROUTES` with method, path, auth and schemas; OpenAPI generation includes them.
- [ ] **Step 7.2: Run** (FAIL); **Step 7.3: Implement**, `pnpm gen`; **Step 7.4: Run** `pnpm verify`; paste the oasdiff result (additive only) in the PR body.
- [ ] **Step 7.5: Commit** `feat(core): GET queries, admin audit and admin queries route contracts (spec 5.1)`.

### Task 8: Stories A6 to A9 (#527)

**Files:** Modify `docs/testing/stories.json`; `scripts/ci/check-story-tags.ts` only if it cannot hold planned stories (gate; then the change is the smallest that keeps the check strict for milestones at or below the highest tagged one).
**Interfaces:** A6 to A9 entries, milestone `m2`, files as named by master plan 4.1 M2 rows (`submit.a6.test.ts`, `a6-ack.spec.ts`, and the A7 to A9 files the implementer reads from spec 10.2). Step 8.0 checks how `check-story-tags` treats a story whose files do not exist yet (it requires tags only at or below the highest milestone tag; confirm by running it).
**IDs:** spec 10.2; master plan 4.1 M2 P0 row.
**Tier:** ordinary (gate only if the checker changes). Inline candidate.

- [ ] **Step 8.1:** add the entries; run `pnpm tsx scripts/ci/check-story-tags.ts` (PASS); **Step 8.2: Commit** `docs(testing): stories A6 to A9 (m2)`.

---

### Task 9: P0 gate (#528)

Demo-path gate (after P0-W1 and P0-W2):
- [ ] `pnpm verify` green on `main`.
- [ ] Master plan 8 log has one entry per contract change so far (Tasks 1 `configLoaded.versionId`, 2, 3, 7).
- [ ] oasdiff output reviewed in P0-W2's PR (additive only).
- [ ] `stories.json` lists A6 to A9.
- [ ] #511 boxes for CFG-3 and C-M4 ticked with PR numbers; #66 notes "policy decided in ADR-0013; implementation M2 P0.5 B and M2 P1 B".
- [ ] `STATUS.md` M2 P0 cell `active (P0-W3 after the demo)`; manager told.

Full gate (after P0-W3, before M2 P2 starts): log entries for Tasks 4, 6 (and 5 if option b); the remaining #511 P0 boxes ticked; STATUS M2 P0 `done`.

---

## Wave P0-W3 (after the demo, D-M2P0-5): audit catalogue, request keys, publish note (critical)

### Task 4: M2 audit catalogue (#523)

**Files:** Modify `packages/core/src/contracts/audit.ts`, `audit-auth.ts` and their tests; writers: `packages/api/src/admin/users/users.ts` (role change `:258`, session revoke `:323`; gate), `packages/api/src/ops/grant-role.ts` (`roleChanged` `:75`; gate), `packages/api/src/auth/routes.ts` `changePassword()` (`:222-236`; gate) for `passwordChanged`, and their API tests. The user-disable path writes no `sessionRevoked` (spec 5.6: it counts).
**Interfaces (spec 4.7, 5.1, 5.6; the spec audit table at lines 632-675 is authoritative for field names):**
- `roleChanged.details` gains `fromRole: Role` (non-null: `user.role` is NOT NULL, `db/schema.ts:27`; writers must set it; G-m3: demoting an admin now records `fromRole: "admin"`, not only "granted implementer").
- `sessionRevoked.details` gains `targetUserId: Uuid7` (writers must set it; the admin revoke route sets the session owner; the M2 P2 sweeper sets it on expiry).
- Both fields: writer schemas require them; the read schema (used by the M2 P2 viewer and export over stored rows) accepts rows without them (append-only rows written before M2).
- New `passwordChanged { targetUserId, via: "self" | "adminReset" }` (no password material, no hash). Better Auth changes the password outside our transaction (`changePassword()` hands it to `d.auth.handler`), and `createAuth` (`auth.ts:191-197`) has no AuditService, so the row is written in `changePassword()` after `res.ok`, inside `withTransaction`, the way the login rows are written around the handler (`routes.ts:166-190`). If that audit write fails, the change cannot be rolled back: delete the caller's session (the AUD-2 rule used for login), log `audit write failed` with ids only, and return the fixed error. Test that the forced-change flag cleared by the hook and the audit row agree. `adminReset` is reserved until an admin reset route exists. Add `passwordChanged` to the spec audit table in the same PR.
- New `auditViewed { filters: { userId?, correlationId?, type?, from, to }, cursor?, rowCount }`, `auditExported { filters, format: "ndjson", rowCount }`, `adminViewed { correlationId, viewerBasis: "admin" | "credentialOwner", includeHidden: boolean }` (exact names per the spec table; writers in M2 P2).
**IDs:** SEC-010, SEC-011, SEC-012, SEC-013; spec 4.7, 5.6; #511 audit boxes (G-m3, password change, revokeSession target).
**Tier:** critical (contracts) with a gate slice (`auth/**`).

- [ ] **Step 4.1: Failing tests:** contract tests for each new type and field (valid parse; a writer-schema parse without a required field fails; the read schema accepts an old-shape stored `roleChanged` and `sessionRevoked` row; no value-shaped field accepted); API tests: demoting an admin writes `roleChanged` with `fromRole: "admin"`; `grant-role` writes `fromRole`; admin revoke writes `sessionRevoked { sessionId, reason: "admin", targetUserId }`; a self password change writes one `passwordChanged { targetUserId, via: "self" }`; a failed change (wrong current password, `res.ok` false) writes none; an audit stub that throws on `passwordChanged` ends the caller's session; no log line or audit detail carries the password (`captureLogger`).
- [ ] **Step 4.2: Run** the core contract tests and the touched API tests. Expected: FAIL.
- [ ] **Step 4.3: Implement**; master plan 8 log entry; `pnpm gen` if OpenAPI shapes change.
- [ ] **Step 4.4: Run** `pnpm verify` (PASS); **Step 4.5: Commit** `feat(core,api): M2 audit catalogue: fromRole, revoke target, passwordChanged, admin audit types (spec 4.7)`; PR body `Refs #511`.

### Task 5: Request-key versioning (D-M2P0-3) (#524)

**Files:** `packages/api/src/keys/request-keys.ts`, `keys/canary.ts` (read), tests under `packages/api/test/keys/`; #511 comment.
**Interfaces:** Step 5.0 rules the design (Opus 5.5 `low`, given the comment at `request-keys.ts:10-13`, `canary.ts:10` and the #311 thread). Option (a), recommended: keep `key_version` = the wrapping DATA_KEY version, document why (rotation re-wraps by `key_version`; the canary and request keys move together), add a test that pins `REQUEST_KEY_VERSION === CURRENT_KEY_VERSION` with that reason (TDD n/a: no behaviour change; the report says so), and tick the #511 box as "decided: intended". Option (b): a separate format version constant used in the AAD, with the DATA_KEY version kept in `key_version`; needs a migration only if a new column is added (then the migration rule in Global Constraints applies).
**IDs:** SEC-006, SEC-011; #511 (from #311).
**Tier:** critical (`keys/**`).

- [ ] **Step 5.0: Ruling** recorded in the task report and on #511.
- [ ] **Step 5.1: Test** for the chosen option (a: the pin test, TDD n/a; b: failing first, a row written under format version 1 still opens after the constant split).
- [ ] **Step 5.2: Run** `pnpm --filter @querymodule/api exec vitest run test/keys`. Expected: (b) FAIL before the change; (a) PASS.
- [ ] **Step 5.3: Implement**; **Step 5.4: Run** `pnpm verify`; **Step 5.5: Commit** `docs(api): request key version records the wrapping DATA_KEY (#511)` (a) or `feat(api): request key format version independent of DATA_KEY version (#511)` (b).

### Task 6: Publish change note and publisher name (D-M2P0-4) (#525)

**Files:** Modify `packages/core/src/contracts/admin.ts`, its test, regenerate `openapi.json`.
**Interfaces:** publish request body gains `note?: string` (trimmed, 1 to 200 characters, no control characters); `ConfigVersionSchema` (a `z.strictObject`) gains **optional** `note?: string` and `publishedByName?: string`, so `toConfigVersion` (`admin/config/draft.ts:24`, critical) needs no change now. The server ignores `note` until M2 P2 (documented in the route description), which makes the fields present and the writer critical.
**IDs:** #507, #511; ADR-0011.
**Tier:** ordinary. Inline candidate.

- [ ] **Step 6.1: Failing tests** for the schema bounds; **Step 6.2: Run** (FAIL); **Step 6.3: Implement**, `pnpm gen`; **Step 6.4: Run** `pnpm verify`; **Step 6.5: Commit** `feat(core): publish note and publisher name in the admin config contract (#507)`.

## Self-review

- Spec coverage: master plan 4.1 M2 P0 row (mapping union, `assessResult`, `resultHidden`, `resync`, admin, ops and `sessionRevoked` audit schemas, OpenAPI for `GET queries`, admin audit and queries; A6 to A9) maps to Tasks 2, 3, 4, 7, 8. "Ops" audit schemas: `grant-role` is covered by `roleChanged.via`; `purge` is M3 P2 (not added).
- #511 P0 boxes: C-M4 (Task 2), `REQUEST_KEY_VERSION` (Task 5), change note and "who" (Task 6), CFG-3 (Task 1), audit schema boxes (Task 4).
- Ordering: Task 1 before any schema default and before P0.5 AW2; Task 2 before P0.5 Track B Task 5. Tasks 4, 5, 6 after the demo (D-M2P0-5).
- Review passes 10-05-26: plan critic (20 findings), adversarial review of the sensitive designs (CFG-3 publish-time hash, boot backfill, frozen trigger, versionId, audit hash links, passwordChanged writer, fromRole non-null, tolerant read schema), skeptic review (wave packing, demo path). Applied.
