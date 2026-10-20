---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "569363c01a3dd7cc1116cc0a15d3578abf9bd9fb"
verdict: "approve"
---

# Review: feat/m2-a-p3-wave-2

Date: 10-20-26.

## Scope

Branch `feat/m2-a-p3-wave-2`, range `e5deedc2bacd3756f04e8906df2f1df9733ef3f4..569363c01a3dd7cc1116cc0a15d3578abf9bd9fb`. M2 P3 Track A wave AW2:

- Task 7 (#792, CFG-4, D-M2P3-4): `config:import`, an ops command that validates the image's site config as boot does, keeps the published label overlay, compares with the published document, prints `diffConfig` lines, and on import saves a draft and publishes it through `publishDraft` and `activate()` with the normal `configPublished` row by a named admin and the note "Imported from the image" on the row only.
- Task 8 (#793, CFG-1, D-M2P3-5, option 3): `GET /api/v1/config` carries the published `versionId` (wire schema = base client schema plus `versionId: Uuid7Schema`), answered from one snapshot; `configHash` stays over siteConfig only (CFG-3); the client keeps parsing the base schema until Track B BW4.

Two slices in one run. Gate slice (Opus 5.5 medium): `package.json`, `packages/api/src/deps.ts`, `scripts/ci/boot-smoke.sh`, `scripts/ci/config-validate.ts`, `scripts/ops/config-import.ts`. Critical slice (Opus 5.5 high, manager ruling: critical behavior reviewed at critical): `packages/core/src/config/client-config.ts`, `packages/api/src/routes/config.ts`, `packages/api/src/ops/config-import.ts`.

## Findings summary

- Gate slice: approve, 0 critical, 0 important.
- Critical slice: approve, 0 critical, 0 important, 5 minor (listed below).
- No critical or important finding needed resolution.
- Ruling kept as stands: CV1 (the live store's version 1 was seeded by an older image; the dry run is the check and fails closed if that document does not parse).
- Q3 was fixed on the branch before review (5e01895, docs/deploy.md refused-import line).
- Controller questions ruled by this review: Q1 Minor (follow-up), Q2 Minor, Q4 to Q6 Minor follow-ups.

## Cross-cutting checks

1. Draft locking and cleanup (`admin/config/draft.ts`, `admin/config/publish.ts`): risk that the import's draft check and cleanup diverge from the store's own locking. `saveDraft` replaces any shared draft inside its own transaction with no expected-draft input, and `publishDraft` reads the draft by version, so two narrow check-then-act windows exist (Minor M1). Cleanup deletes only a draft that still holds the run's document (Minor M2 on error masking).
2. Audit rows and writes on the import path (`admin/config/activate.ts`, `deps.ts` boot, `seams.ts` `actorOf`): risk of a wrong actor, the note or document content in an audit row or log, or a partial write. One transaction supersedes, publishes (guarded on status and document) and writes `configLoaded` and `configPublished`; details carry ids, hashes, version and pointers only; the CLI log sink is a no-op. No defect.
3. SEC-010 attribution (`db/schema.ts` user columns, `auth/identity.ts`, a grep for host principals): risk that the import mislabels a host-identity admin. No host principal producer exists yet; the hardcoded `local` is correct today (Minor M4, latent).

## Answers to the controller's questions

1. Q1 (`config-import.ts:218-227`; the cited 404-413 maps here): Minor, follow-up. The window is a few awaits wide, needs a concurrent builder save on a single-operator demo host, and loses only an unaudited, non-history draft; the audit row stays truthful. The fix changes `saveDraft` in `admin/config/**` (critical tier). If the manager still wants it in this PR: an `expectDraftId` option checked inside `saveDraft`'s transaction, with a re-review of draft.ts.
2. Q2 (`config-import.ts:157-169`, `240-243`): Minor. A cleanup throw changes only the error class the CLI prints, never the store state. The near-duplicate is justified: `publish.ts` `removeDraft` is private and lacks the document guard.
3. Q4 to Q6: Minor follow-ups. Q6: SEC-010 attribution is correct for the seeded demo admin on the live host: the principal is built from that user row (id, audit email, verified admin role) and the account is local.
4. Task 7 on the live store: no path writes partial history or audit state. Dry run and unchanged write nothing; the import is the draft save then activate's one transaction; a refusal or throw removes the run's own draft, a kill between the two leaves only that draft and the next run refuses until `--replace-draft`; a throw after commit cannot delete the published row. The actor is the named admin. No document content reaches a log line or the `configPublished` details; stdout prints config values in the `diffConfig` lines, as the plan mandates.
5. Task 8: conforms to option 3 (wire schema base plus `versionId: Uuid7Schema`, one snapshot, `configHash` over siteConfig only, client base parse tolerates and strips `versionId`).

## Remaining Minors

- M1: check-then-act windows around the shared draft (`config-import.ts:218-227`; `publish.ts:236` reads the draft by version). Follow-up: `saveDraft` expected-draft option and a `publishDraft` expected document.
- M2: a throw in `removeOwnDraft` masks the publish error (`config-import.ts:240-243`). Follow-up: swallow the cleanup error and rethrow the original.
- M3: no test for the throwing-publish cleanup or the "not restored" text (`config-import.ts:236`, `240-243`).
- M4: `identitySource` hardcoded `local`, no `hostSubject` (`config-import.ts:148`). Follow-up when host identity lands: read both from the user row, or refuse a non-local admin.
- M5: boot's "site config file ignored" warning persists after an import with a published label overlay (`deps.ts:128-134`).
