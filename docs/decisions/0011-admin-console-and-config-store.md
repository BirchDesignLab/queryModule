---
date: 09-29-26
status: proposed
track: A
phase: M1 P3
supersedes: none
---

# ADR-0011: Admin console with a versioned site-config store

Status: proposed (draft for the developer's rulings D-A19 to D-A30 in `docs/superpowers/plans/2026-09-29-track-a-p3.md`). Issue: #333.

## Context

Spec v2 meets BR-001 ("common site customizations through configuration, without code changes") with JSON site files loaded at startup (5.8), `config:validate` and a deploy; it states there is no admin UI, and user operations are ops scripts (`scripts/ops/seed.ts`, `grant-role.ts`). After the 09-29-26 demo the developer asked for forms that are configurable from an admin UI, a visual builder for implementers, and user administration, and asked that stakeholders see forms and admin configurability before the backend (#333 and its comments). This ADR records the design; the task plan is in the Track A P3 plan.

## Decision (recommended options; each is a D-* ruling)

1. **Storage (D-A19 a).** A versioned config store in the encrypted SQLite database: table `site_config_version` (`id` UUIDv7, `site_id`, `version` integer increasing per site, `status` `draft` | `published` | `superseded`, `document` JSON, `config_hash`, `base_version`, `created_by`, `created_at`, `published_by`, `published_at`, `rollback_of` nullable). Rows are insert-once except `status` and the publish columns on the draft row; a published row's `document` never changes (trigger). The `SITE_CONFIG` file stays the bootstrap: on first boot with an empty store, the resolved file becomes version 1 `published` (with a `configLoaded` row as today). Export and import of a version as JSON keep a git round trip for implementers.
2. **What a version holds (D-A20 a).** One document: the `SiteConfig`, a locale overlay (`{ [locale]: { [labelKey]: text } }` merged over the bundled locale files, so a new field's label is edited with the field), and, only where `ALLOW_MOCK_SOURCES=true`, the mock file. All three are validated together by the existing chain (`migrateConfig`, strict parse, `validateSiteConfig` with locales, mock coverage, fixture policy).
3. **Live activation (D-A21 a).** Publish runs validation, writes the version, and swaps the process's config snapshot in one step: `configHash` changes, requests already planned keep the snapshot they were planned against, and `configLoaded` is written for the activation. Open clients refetch `GET /api/v1/config` every 15 s (marked `X-Background: 1`, so the session idle clock is untouched) and on window focus; on a new hash the query panel re-evaluates the draft (user values kept, removed fields dropped from view) and announces the change politely. A stale submit still gets 409 `configHashMismatch` and refetches (spec 6.7, unchanged). No WebSocket push in M1 (a `configChanged` event replaces polling once the M2 feed client exists; a contract change then).

**The core loop.** Everything above serves one flow, which is the M1 P3 exit demo (developer target 09-29-26): an implementer edits the config in the visual builder, sees the change in a live preview that is the dispatcher's own query panel component fed with the draft config, publishes, and every open dispatcher form reacts within the refresh bound: fields, rules, required marks, defaults, picklists, subtypes (`role: "type"` fields), quick access and terminal commands. One renderer for preview and production is a requirement, not an optimisation: the preview proves exactly what dispatchers will see.
4. **Editor (D-A22 a, D-A23 a).** An `/admin` area in `apps/web`, lazy-loaded, visible only to its roles. The config builder has purpose-built editors for query types, fields, rules (a condition builder over the spec 4.2 JSON: field, operator, value, `$default`, `all`/`any`/`not`), picklists, commands (ordered positions, presets, rest), quick access and label text; a generic schema-driven form for the remaining `SiteConfig` sections; and a raw JSON tab validated by the same schema. A live preview renders the dispatcher's own query panel component from the draft (the panel takes an injected config; `evaluateForm` and the terminal functions run in the browser; submit disabled with a visible "Preview" reason). `validateSiteConfig` runs on every change in the browser (core is pure) and each diagnostic is shown at its JSON pointer's control. One shared draft per site with an optimistic lock on `base_version`; publish shows the resolved diff and requires the draft's base to be the live version; rollback publishes an older version's document as a new version (history is never rewritten).
5. **Roles (D-A24 a).** `ROLES` gains `implementer`: edits and publishes site config, nothing else. `admin`: users, roles, sessions and site config (and the M2 audit viewer). The single-role model stays (spec 5.5 actor snapshot).
6. **Audit (D-A25 a).** New types, additive: `configPublished { versionId, version, configHash, previousConfigHash, changedPointers[], rollbackOf? }` (JSON pointers only, never values), `userCreated { userId, role }`, `userDisabled { userId }`; `roleChanged` exists; `sessionRevoked` is pulled forward from the M2 P0 catalogue. Draft saves are not audited (the version table keeps who and when). Every publish also writes `configLoaded` on activation.
7. **User administration (D-A26 a).** No email in the prototype: an admin creates a user and the server shows a one-time temporary password once (derived from nothing stored in logs; never re-shown), with a forced change at first sign-in; disable (one transaction: flag, revoke sessions, close sockets through `EventBus.onSessionEnded`); role change; session list and revoke. The first admin is still bootstrapped by `scripts/ops/grant-role.ts`.
8. **Script-only (D-A27 a).** Key rotation, the lost-key runbooks, backup, restore, purge, seeding and the first-admin grant stay scripts: they need host access or key material and must work when the app does not.

## Consequences

- Spec 5.8 ("edit the file and restart"; no admin editing UI) is overridden: the file is the bootstrap and the store is the live source. Spec 5.8 and 12 get "Overridden by ADR-0011." lines in the PR that accepts this ADR. Master plan 4.1 gains the admin console in M1 P3 (D-A29) and moves #333 from M2.
- New contract PRs (critical tier where they touch `identity.ts`, `audit.ts`): the `implementer` role, the audit types, the admin route definitions, and `FEATURES` entries `adminConfig` and `adminUsers` (dark until their tests pass).
- New sensitive areas: `packages/api/src/admin/**` (config publish writes audit and swaps live config: critical; user admin: gate, with its audit writes critical), `site_config_version` migration (critical, `drizzle/**`).
- Clients gain a config refresh (15 s and on focus) and the `/admin` area; config still arrives only through `GET /api/v1/config`, with the 409 path as the backstop.
- Risk: a bad publish can break every form at once. Mitigations: publish is refused on any validation error; the preview renders the draft before publish; rollback is one action; `configLoaded` and `configPublished` make every change traceable.
- Risk: live activation mid-dispatch (once dispatch lands) must keep each in-flight job on its planning snapshot (Track A plan "Forward compatibility").

## Alternatives considered

- Files plus a validated write and reload (D-A19 b): simple and git-native, but the deploy mounts config read-only and bundles it in the image; history, drafts, concurrent edits and audit would all be ad hoc.
- Raw JSON editor only (D-A22 b): cheapest, but not the "visual builder" stakeholders asked for.
- Per-user drafts (D-A23 b): more merge work with no prototype need.
- Admin-only (D-A24 b): conflates people management with configuration; `implementer` matches FR-060's wording.
