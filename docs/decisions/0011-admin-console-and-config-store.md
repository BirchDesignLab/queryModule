---
date: 09-29-26
status: accepted
track: a
phase: m1-p3
supersedes: ["spec 5.8 (config from files at startup; no admin editing UI)"]
---

# 0011 Admin console with a versioned site-config store

## Context

Spec v2 meets BR-001 ("common site customizations through configuration, without code changes") with JSON site files loaded at startup (5.8), `config:validate` and a deploy; it has no admin UI, and user operations are ops scripts (`scripts/ops/seed.ts`, `grant-role.ts`). After the 09-29-26 demo the developer asked for forms that are configurable from an admin UI, a visual builder for implementers (FR-060 names implementers as the ones who configure), and user administration (#333). The developer's target for the end of M1 P3 is a demoable v1 whose core loop is: an implementer builds site config visually, publishes it, and the dispatcher's query form reacts (fields, rules, required, defaults, picklists, subtypes, commands). Rulings D-A19 to D-A27 and D-A21 (revised) in `docs/superpowers/plans/2026-09-29-track-a-p3.md`, all as recommended (developer via checker, 09-29-26).

## Options

1. Storage: (a) a versioned config store in the encrypted database, seeded from the site file; (b) files with a validated write and a reload. (b) is git-native but the deploy mounts config read-only and bundles it in the image, and drafts, history, rollback, concurrent edits and audit would be ad hoc.
2. Editor: (a) purpose-built editors plus a generic schema-driven form, a raw JSON tab and a live preview; (b) a raw JSON editor only; (c) a fully generic schema form. (b) is not the visual builder asked for; (c) makes rules and commands hard to edit.
3. Change propagation: (a) publish activates in-process and open clients refetch config every 15 s and on focus; (b) publish then restart; (c) a WebSocket `configChanged` push (a contract change on top of the parked feed socket).
4. Roles: (a) a new `implementer` role for config only, with `admin` also allowed; (b) admin only; (c) multi-role users.

## Decision

1. **Storage.** Table `site_config_version` (`id` UUIDv7, `site_id`, `version` integer increasing per site, `status` `draft` | `published` | `superseded`, `document` JSON, `config_hash`, `base_version`, `created_by`, `created_at`, `published_by`, `published_at`, `rollback_of` nullable). A published row's `document` and `config_hash` never change (trigger). The `SITE_CONFIG` file is the bootstrap: an empty store seeds version 1 from the resolved file; afterwards the store is the live source. Export and import as JSON keep a git round trip.
2. **Version content.** One document holding the `SiteConfig`, a locale overlay (`{ [locale]: { [labelKey]: text } }` over the bundled locale files) and, only where `ALLOW_MOCK_SOURCES=true`, the mock file; validated together by the spec 5.8 chain (migrate, strict parse, `validateSiteConfig` with locales, mock coverage). Nothing is served or activated unvalidated, including at startup.
3. **Live activation.** Publish validates, writes the version and swaps the process's config snapshot in one step: `configHash` changes; requests already planned finish on the snapshot they were planned against; `configLoaded` is written for the activation. Open clients refetch `GET /api/v1/config` every 15 s (with `X-Background: 1`, so the idle clock is untouched) and on window focus; on a new hash the query panel re-evaluates the draft (user values kept, removed fields no longer rendered) and announces the change politely without moving focus. A stale submit still gets 409 `configHashMismatch` (spec 6.7). A WebSocket push replaces polling once the M2 feed client exists.
4. **The core loop.** The builder's live preview is the dispatcher's own query panel component (`QueryPanelView`) fed with the draft config, submit disabled with a visible "Preview" reason. One renderer for preview and production is a requirement: the preview shows exactly what dispatchers will see.
5. **Editor.** An `/admin` area in `apps/web`, lazy-loaded, visible only to `admin` and `implementer`. Build order: a generic schema-driven form over `SiteConfig`, a raw JSON tab validated live, the preview, inline diagnostics and the publish loop first; purpose-built editors (query types, fields, rules as a condition builder over the spec 4.2 JSON, picklists, commands, quick access, label text) after. `validateSiteConfig` runs in the browser on every change and each diagnostic is shown at its JSON pointer's control. One shared draft per site with an optimistic lock on `base_version`; publish shows the resolved diff and requires the draft's base to be the live version; rollback publishes an older version's document as a new version; history is never rewritten.
6. **Roles.** `ROLES` gains `implementer` (edit and publish config only). `admin` manages users, roles and sessions and may also edit config (and gets the M2 audit viewer). One role per user (the actor snapshot model of spec 5.5 stays).
7. **Audit.** Additive types: `configPublished { versionId, version, configHash, previousConfigHash, changedPointers[], rollbackOf? }` (JSON pointers only, never values), `userCreated { userId, role }`, `userDisabled { userId }`; `roleChanged` exists; `sessionRevoked` is pulled forward from the M2 P0 catalogue. Draft saves are not audited (the version table records authors). Every activation also writes `configLoaded`.
8. **User administration.** No email: an admin creates a user and the server returns a one-time temporary password once (never logged, never re-shown); the user must change it at first sign-in. Disable is one transaction (flag, delete sessions, `userDisabled`), then the sessions' sockets close through `EventBus.onSessionEnded`. Role change, session list and revoke. The last admin cannot demote or disable themselves. The first admin is still bootstrapped by `scripts/ops/grant-role.ts`.
9. **Script-only.** Key rotation, the lost-key runbooks, backup, restore, purge, seeding and the first-admin grant stay scripts: they need host access or key material and must work when the app does not.

## Consequences

- Spec 5.8 carries `Overridden by ADR-0011.` (files are the bootstrap; the store is the live source; config changes without a restart).
- Contract PRs: the `implementer` role (`identity.ts`, critical), the audit types (`audit.ts`, critical), the admin route definitions and `FEATURES` entries `adminConfig` and `adminUsers` (ordinary; off in shipped sites until their tests pass).
- New sensitive paths, added with their first file: `packages/api/src/admin/config/**` (critical: swaps live config and writes audit), `packages/api/src/admin/users/**` (gate, auth), the `site_config_version` migration (critical, `drizzle/**`).
- `AppDeps.config` becomes a holder read at use (`current()`), so a swap is atomic; any later dispatcher keeps each in-flight job on its planning snapshot.
- The query panel becomes config-injectable (`QueryPanelView`), used by the live route and the builder preview.
- Admin UI files live in `apps/web/src/admin/**` and `packages/web-ui/src/admin/**`, built by Track A as a declared exception to master plan section 2 (D-A28), disjoint from Track B's panel files.
- Risk: a bad publish reaches every form within 15 s. Mitigations: publish is refused on any validation error, the preview is the production renderer, rollback is one action, and `configPublished` plus `configLoaded` make every change traceable.
- Issue #333 moves from M2 to M1 P3 (D-A29).
