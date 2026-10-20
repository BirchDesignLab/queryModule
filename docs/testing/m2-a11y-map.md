# M2 accessibility map

Spec 10.6 names the Playwright cases that must exist. This page names the test for each case and what it asserts. It also covers the spec 12.3 M2 P3 Track B row: STOLEN in a detail-only path at 1024x768, typing while a result arrives, and `setOffline`.

Every case also runs axe, through `expectNoSeriousAxeViolations` in `apps/web/e2e/fixtures.ts`, and fails on a serious or critical violation (spec 9.3). The helper scans under emulated reduced motion, so a transition cannot be caught midway (#773). The manual NVDA with Chrome pass is recorded in `docs/testing/nvda-m2.md` (Task 10).

IDs: UX-001, UX-002, FR-064, FR-065, NFR-003. Spec 6.1, 6.3, 6.6, 10.4, 10.6; D-M2P3-B7. All data comes from mock sources (spec 5.4).

Some titles below contain template literals. A `${persona.name}` value is `dispatcher` or `officer`, and a `${condition.name}` value is one of the `CONDITIONS` in `hardening.spec.ts`.

| Spec 10.6 case | Test file (`apps/web/e2e/`) | Test name | Asserts |
|---|---|---|---|
| Keyboard-only A1 | `a1-plate-form.spec.ts` | `[A1] the plate form shows Plate, State TX, Year and VIN, and Enter submits (FR-004, FR-006, FR-064)` | Plate is typed by keyboard and Enter submits. The POST body is VEH, the reply is 202, and the request lands in the list. |
| Keyboard-only A1, officer | `personas.spec.ts` | `officer: mobile-unit layout, 48x48 targets, header and themes, keyboard plate query` | The officer layout at 1024x768 runs a plate query by keyboard. |
| Keyboard-only A4 | `a4-terminal.spec.ts` | `[A4] VEH.ABC123..26 runs with State TX and Year 2026 (FR-050 to FR-056, FR-064)` | Slash opens the terminal and the command is typed and run with Enter. The body holds exactly what was typed, and focus stays in the terminal. |
| Keyboard-only A4, unrecognized | `a4-terminal.spec.ts` | `[A4] XYZ.123 gives unrecognized command, tied to the input (FR-055)` | Enter on an unknown code gives `aria-invalid` and a description tied to the input; focus stays. |
| Keyboard-only A4, examples | `example-queries.spec.ts` | describe `example queries, terminal, keyboard only (FR-050 to FR-056, FR-042)` | Each example command runs by keyboard only. |
| Typing while a result arrives | `source-status.spec.ts` | `typing into Plate while statuses arrive keeps focus, value and the live region (spec 6.6, 10.6)` | Focus and the typed value hold while both sources return. A burst typed after the arrival leaves the polite region's recording unchanged. The arrival summary is said once, no text is repeated, and nothing typed is said (D-M2P3-B7). The check was confirmed to fail against a local per-keystroke announcement (BW2 PR). |
| Typing while a result arrives, officer | `a8-mapping.spec.ts` | `[A8] typing in Plate while cards arrive keeps focus and value` | At 1024x768 in the officer layout, focus and value hold while cards arrive. |
| 1920x1080 at 200% zoom | `hardening.spec.ts` | `${persona.name}: 1920x1080 at 200% zoom keeps the persona and the response mapping (spec 6.1, 10.6)` | At 960x540 CSS px and twice the density, the persona (`data-persona`, layout class) and the ZZ-0001 card's heading, terms, values and badges equal those at 1920x1080. |
| 1920x1080 at 200% zoom, reflow | `hardening.spec.ts` | describe `${persona.name} at 1920x1080 at 200% zoom (960x540 CSS px)`, test `reflows whole, targets hold, focus is never hidden behind the action bar` | There is no horizontal overflow or clipping, targets hold the persona's minimum, and Tab never leaves a control under the action bar or outside the viewport. |
| 320 CSS px reflow | `hardening.spec.ts` | describe `${persona.name} at 320 px reflow (320x256 CSS px)`, test `reflows whole, targets hold, focus is never hidden behind the action bar` | The same checks at 320 CSS px wide (1280 at 400%). |
| 320 CSS px reflow, panel | `panel-layout.spec.ts` | `${mode}: no overflow, 24px targets, focus ring, axe` (320x800) | The panel at 320 px has no overflow, 24 px targets and a visible focus ring, in every theme. |
| Mobile unit 1024x768 | `personas.spec.ts` | `officer: mobile-unit layout, 48x48 targets, header and themes, keyboard plate query` | The layout class, 48 px targets, 88 px tiles and a 64 px Run; no overflow. |
| Mobile unit 1024x768, density | `visual.spec.ts` | describe `D0.3 officer touch density (1024x768)` | Controls are 56 px and the header's buttons 48 px, with no muted text. |
| Mobile unit 1366x768 | `hardening.spec.ts` | describe `officer at 1366x768`, test `reflows whole, targets hold, focus is never hidden behind the action bar` | The officer at 1366x768: no overflow, 48 px targets, an even action bar, and focus in the viewport after each Tab. |
| Mobile unit 800x600 | `hardening.spec.ts` | describe `officer at 800x600`, test `reflows whole, targets hold, focus is never hidden behind the action bar` | The same checks at 800x600. #645's "focus hidden after a request" race is fixed in BW1. |
| STOLEN detail-only at 1024x768 | `a7-highlight.spec.ts` | `[A7] a STOLEN only in a detail-only path still badges the summary card` | At 1024x768 the summary card carries the critical badge and class with no mark in the summary. The STOLEN mark shows after the detail toggle. |
| Offline (spec 10.4) | `offline.spec.ts` | `offline: submit is held with a visible reason, Enter sends nothing, values stay (spec 10.4)` | Submit stays focusable with `aria-disabled` and a visible reason. Enter in the form and in the terminal sends nothing and keeps the text. Offline and back online are each said once, with no typed value, and axe runs in both states. |
| Offline, reconnect (spec 10.4) | `offline.spec.ts` | `offline: a request pending when the connection dropped is refetched once it is back (spec 10.4, FR-064)` | A source that settles while the page is offline is refetched over HTTP when the page is back, and the row settles. |
