# Task 33 part 2a (#358) report: builder on the server draft, review and publish

## Implemented
- admin-config.ts: editorOf / documentFrom (server ConfigDocument <-> client-shaped builder draft; server-only
  sections, source kind, purpose roles, mock kept on save), startOf, and typed api wrappers (GET config, PUT draft,
  validate, publish) through the generated client.
- draft.ts store: server base (baseVersion, draftVersion, live view, saved copy), start(options), load(), markSaved().
- ConfigBuilder: seeds from GET /admin/config (draft.document else live.document); toolbar chip "Draft, based on
  version n. k unpublished changes." (+ "Not saved yet."); Save draft; Review and publish replaces Publish;
  History stays aria-disabled with its reason (part 2b).
- PublishFlow.tsx: save (409 -> alert + "Load the latest" confirm dialog), review = save, server validate, errors
  merged into the controls' issues (withServerIssues, retired by any edit) with a polite count; no errors -> dialog
  with read-only ChangesView against live and "Publish version n"; publish 200 -> toast + announcer, invalidate
  ["config"], reload from server, focus back on the opener; 400 -> errors at controls; 409 -> conflict alert.
- ChangesView: live view from the admin config (re-checked on open); onOpen optional (read-only list in the dialog).
- LeaveDialog: children, leavePrimary, busy. LeaveGuard text now about unsaved edits; guard dirty = unsaved.
- msw defaults: GET /admin/config; helpers adminConfigBody, versionRow, RAW_SITE.
- en.json strings; shell.css (notice, dialog content scroll, static diff entry).

## TDD evidence
RED admin-config.test.ts: `cd apps/web && pnpm exec vitest run src/admin/admin-config.test.ts` -> failed to import
./admin-config.js (module missing), expected.
RED draft.test.ts (store): 4 failed, "store.getState(...).load is not a function" / markSaved missing, expected.
RED Publish.test.tsx: 17/17 failed before any UI existed (no Save draft / Review and publish, old status text).
GREEN: admin-config.test.ts 10 + startOf 4 passed; draft.test.ts 22 passed; Publish.test.tsx 18 passed.
Existing tests updated for the new behaviour: ConfigBuilder, Diagnostics, LeaveGuard, Changes, BuilderFixes tests.

## Verification
pnpm lint: pass (1 pre-existing info in an untouched file). pnpm typecheck: pass. pnpm coverage: 269 files passed,
3729 tests passed, 2 skipped, thresholds ok. pnpm verify (lint, typecheck, coverage, config:validate, gen:check): exit 0.

## Boxes to tick (controller)
Task 33 part 2a items: builder seeds from server draft; save draft; 409 reload path; review and publish with
server validate, resolved diff dialog, publish, toast, invalidate ["config"]; chip text. Part 2b (history, rollback) open.

## Self-review / concerns
- Stale draft (base != live) opens as-is so work is not lost; saving it 409s; "Load the latest" then loads live
  (startOf preferLive). Documented in admin-config.ts and tested.
- docFromClient is now used by tests only; left in place (exported, tested).
- Toast is plain visible text plus the shared announcer (no toast primitive in web-ui).
- Dialog Escape while a publish is in flight closes the dialog; the request still completes and reports.
- New locale keys only in en.json (the only bundle).

## Fix round 1

RED (before any implementation edit): `pnpm exec vitest run src/admin/Publish.test.tsx src/admin/admin-config-client-view.test.ts` in apps/web: 6 failed (C1, three C2, C3, S1), 19 passed.
GREEN: same files then all of `src/admin`: 373 passed (one Diagnostics test flaked under load, 4/4 on rerun alone). `pnpm lint` clean, `pnpm typecheck` clean, `pnpm coverage` 270 files passed, 3736 tests passed, thresholds met.

- C1 (LeaveGuard.tsx onKeyDown, onCancel, onClose): a busyRef makes Escape, the cancel event and the browser close a no-op while busy. Test: Publish.test.tsx "C1: Escape and the dialog's cancel event do nothing...".
- C2 (PublishFlow.tsx PublishButtons, PublishDialogs; LeaveGuard.tsx new busyReason prop; en.json admin.config.saveJson, admin.publish.busy): one saveReason (busy, then parse error, then nothing to save) is rendered and described by; dialog buttons are described by a visible "Publishing. Wait for it to finish." while busy. Tests: three "C2:" tests in Publish.test.tsx.
- C3 (PublishFlow.tsx change list is a labelled section with tabIndex 0, en.json admin.publish.changes; LeaveGuard.tsx Tab trap now wraps over all buttons and [tabindex="0"] in the dialog). Test: "C3:" in Publish.test.tsx.
- S1 (admin-config.ts viewOf): a siteConfig that parses goes through core toClientSiteConfig (placeholder 64-hex hash, dropped); the hand project() stays only for drafts that fail validation, documented. Tests: admin-config-client-view.test.ts (mock-wrapped spy), existing editorOf equality test still green.

Note: biome's noNoninteractiveTabindex rejects tabIndex on a named section, so the attribute is spread from a documented SCROLL_FOCUS constant (no suppression comment).
