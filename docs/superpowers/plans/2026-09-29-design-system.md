# Design system implementation plan (M1 P3 UI polish, both tracks)

Status: approved 09-29-26 (checker rulings below; developer approved self-hosted IBM Plex). Design target: `docs/design/2026-09-29-visual-system.md` and the approved mockup (private Artifact https://claude.ai/artifact/9eV85kHA7ZxDeupDfiz9Ys, version 3). Developer rulings 09-29-26: amber night focus ring; IBM Plex self-hosted; dispatcher controls 36 px, officer targets 48 px or more.

**Goal:** make the shipped app match the design target without changing behaviour: every existing accessible name, role, keyboard path and test contract stays; the look, layout and density change.

**Scope rules**

- Behaviour stays phase-true: publish and roll back stay `aria-disabled` with their visible reason until AC2 (Tasks 27, 33 part 2) lands; the response card and source outcomes arrive with M2 dispatch. The mockup's target states for those are not built here.
- Components use tokens only (spec 6.5); `styles.no-unknown-vars.test.ts` and the contrast tests stay green and gain the new tokens.
- Accessible names and roles used by e2e (A1 to A5, Task 17, personas Task 21, admin-config Task 35) do not change unless the task says so and updates the spec in the same commit.
- No new runtime dependency. Fonts are committed OFL woff2 files, not a package (no `package.json` change, so no gate tier).
- Docs: no em dashes; dates MM-DD-YY in prose.

**Tiers:** every task below is ordinary (`packages/tokens`, `packages/web-ui`, `packages/client` stores, `apps/web/src/**`, `apps/web/public/**` are not in `.github/sensitive-paths`). CI only, no review artifact. Any task that finds it must touch a gate or critical path (for example `vite.config.ts`, any `package.json`, `packages/api/src/config/load.ts`) stops and asks the checker.

**Execution (budget-aware, as T31 part 2 ran):** inline per task (TDD, `pnpm verify`, `pnpm audit --prod`), one PR per wave below, one Opus 5.5 `medium` critic per PR before the push request (UI rule: an Opus critic on every UI change set). `sdd-task` only if a task grows past about 300 lines or opens a design question. Sizes: S up to 150 changed lines, M 150 to 400, L over 400 (L tasks are split into commits by concern).

## Order and ownership

| Wave | Track | Tasks | Blocked by | PR |
|---|---|---|---|---|
| D0 | B | D0.1 to D0.4 foundation | none | `feat/b-design-d0` |
| B-D1 | B | B1 shell, B2 dispatcher panel, B3 requests list | D0 | `feat/b-design-d1` |
| B-D2 | B | B4 officer layout | D0, B1 | `feat/b-design-d2` |
| A-D1 | A | A1 admin shell, A2 builder layout and tree | D0 | `feat/a-design-d1` |
| A-D2 | A | A3 editor sections, A4 preview states and issue navigation | A-D1 | `feat/a-design-d2` |
| A-D3 | A | A5 publish and history UI | A-D2, AC2 (Tasks 27, 33 part 2) | rides AC2's UI PR |

D0 goes to Track B (it owns `packages/web-ui` and the shell). Track A starts A-D1 after D0 merges. See "Rulings" for the budget order around the Thu 10-01 reset.

## Wave D0 (Track B): foundation

### D0.1 Tokens: palette, type, spacing, density (S to M)

**Files:** `packages/tokens/src/tokens.ts`, `contrast.ts`, `tokens.test.ts`, `contrast.mobile-unit.test.ts`, `generated/tokens.css` (regenerated), `packages/web-ui/src/styles.contrast.test.ts` if it lists pairs.
**Change:** add the new colour tokens and the changed values from the design doc's colour table, verbatim (`color.surface.sunken`, `color.surface.overlay`, `color.border.subtle`, `color.text.muted`, `color.accent.fill`, `color.accent.onFill`, `color.accent.subtle`, `color.status.ok`; changed night, day values; red shift `focus.ring` #ffe0a8). Scale: `type.size.xs` to `type.size.3xl` (12, 13, 14, 16, 20, 24, 32), `type.family` (IBM Plex Sans stack), new `type.family.label` and `type.family.data`, `space.5`, `space.8`, `space.12`, `radius.control` 6, `radius.panel` 10, `control.height.dense` 36, `control.height.touch` 56, `focus.ring.width` 2. `CONTRAST_PAIRS` gains every pair in `scripts/design/contrast-check.ts`, then that script is deleted (the tokens tests take over; say so in the commit).
**Tests first:** a contrast test per new pair and mode (fails until the values land); a test that red shift `focus.ring` differs from `field.required` (E1); the existing unknown-token config validation accepts the new names (`packages/core` validate tests use the tokens list supplied by the API/CLI; check `scripts/ci/config-files.test.ts`).

### D0.2 Fonts, self-hosted (S)

**Files:** `apps/web/src/fonts/` (IBM Plex Sans 400, 500, 600; Sans Condensed 600; Mono 400, 500; latin woff2 from the IBM Plex GitHub release, OFL; commit `OFL.txt` beside them), `@font-face` rules in `apps/web/src/shell.css` (`font-display: swap`), tests.
**Step 0:** the developer approves the font download (source URL and total size stated in the ask).
**Tests first:** `shell.css.test.ts` asserts one `@font-face` per shipped file, each `src` under `/fonts/`, and every font stack ends in a system fallback.

### D0.3 Primitives restyle (M)

**Files:** `packages/web-ui/src/styles.css` and tests beside it.
**Change:** controls, buttons (primary, secondary, ghost, danger; `aria-disabled` dashed with muted text), segmented control (`.qm-seg`, `aria-pressed` buttons in a sunken track), chips (`.qm-chip` for source checkboxes), badges (severity and status), tags (Default, Shown; IBM Plex Sans Condensed 12 px, `type.size.xs`), kbd. Focus: 2 px `focus.ring`, 2 px offset, on `:focus-visible` and on `:focus` for inputs and selects (programmatic focus after a blocked submit). Invalid: 2 px `field.required` edge inside the control (border plus inset shadow), icon and message; ring and edge both visible (E1). Chips and radio cards draw one ring. Density from `data-persona`/layout class: dispatch uses `control.height.dense`, mobile unit `control.height.touch` and 48 px targets. Reduced motion: no transitions; a revealed field keeps a static "Shown" tag.
**Tests first:** computed-style tests (existing helper) for E1 in each mode: focused invalid input has outline colour `focus.ring` and border colour `field.required`; mobile-unit targets at least 48 px; dispatch control height 36 px; `aria-disabled` button keeps focusability.

### D0.4 Visual regression baseline (S)

**Files:** `apps/web/e2e/visual.spec.ts` (Playwright screenshots of login, dispatcher panel, officer layout, admin config at 1440x900 and 1024x768, three themes), baseline images.
**Ask the checker first:** e2e uses port 3000 (Track B's). If the checker prefers, fold this into Task 21's persona e2e instead.

## Wave B-D1 (Track B): shell and dispatcher

### B1 App shell and header (M)

**Files:** `apps/web/src/app/AppChrome.tsx`, `shell.css`, `AppChrome.test.tsx`, `packages/web-ui/src/theme/ThemeModeSelect.tsx` if the menu reuses it.
**Change:** 52 px header: prompt mark and product name, site name, console position when the host context provides one (standalone: omit; no invented value), main nav (Queries, Status, Admin link via `AdminLink` for admin and implementer), connection pill (icon plus text), account disclosure button (email, role, theme segmented control, preferences, shortcut sheet, sign out; Esc closes and returns focus; not `aria-haspopup`). The theme select leaves the bar on dispatch; the mobile-unit header keeps a three-button theme control.
**Tests first:** header landmarks and names; sign out reachable by keyboard inside the disclosure; Esc closes; theme change from the menu still saves the preference (existing test moves); `AdminLink` visibility unchanged.

### B2 Dispatcher query panel (L, split into commits)

**Files:** `apps/web/src/query/QueryPanelView.tsx`, `packages/web-ui/src/panel/*` (QuickAccessBar, TypeFieldBar, SourceCheckboxes, SubmitButton, AckStatus), `packages/web-ui/src/field/QueryForm.tsx`, `FieldRenderer.tsx`, `styles.css`, tests.
**Change, one commit each:**
1. Panel head: type name as h2 ("Vehicle query"), form or terminal segmented control (`aria-pressed`, existing names kept).
2. Quick access as a compact `role="group"` button row with the type code in mono, `aria-keyshortcuts` only where the shortcut is bound, one Alt+1 to Alt+5 hint.
3. Subtype bar (TypeFieldBar) as a segmented control when the type has a type field.
4. Command echo: a mono strip showing `formatCommand` of the current draft, live, with "Edit as command" switching to the terminal (same draft store, spec 4.4). Uses the existing core formatter; no new core code.
5. Form on a 12-column grid; field width from a per-field size class derived from the field type and `maxLength` (no per-type UI code, BR-001); "More details" as a disclosure whose open state survives re-render.
6. Sources as chips with timeout in mono; sticky action bar: Run query (Enter), Clear, status line (validation count).
7. Focus retention (from the critic): Run, Enter and Clear leave focus on the first field (terminal: the command input); a rule that shows or hides fields never loses focus; a click on Run is never swallowed by a re-render.
**Tests first:** each commit's behaviour in `QueryPanelView.test.tsx` / web-ui tests: echo text equals `formatCommand(draft)`; Edit as command lands in the terminal with that text; focus after Run and after Clear; A2 reveal keeps focus on State and shows the "Shown" tag; existing A1 to A5 and Task 17 e2e names unchanged (run the e2e once per PR with the checker's go).

### B3 Requests this shift (M)

**Files:** `packages/client` (an in-memory requests store, reset by `ResetController`; no persistence, spec 6.7), `packages/web-ui/src/panel/RequestList.tsx` (new), `QueryPanelView.tsx` layout (two panes at desktop width), tests.
**Change:** each submit adds a Sending row, which becomes Acknowledged on the 202 (type, values in mono, ack time MM-DD-YY HH:mm:ss, correlation ID with copy, each source "pending"). An error outcome shows its text and, where the submit controller allows, retry. Newest first; replaces the single AckStatus block on dispatch (mobile unit keeps the last request only).
**Tests first:** store reset on logout, 401 and user change; Sending then Acknowledged; copy button falls back to selecting text when the clipboard write rejects; list uses stable keys (spec 6.6).

## Wave B-D2 (Track B): officer

### B4 Officer mobile-unit layout (M)

**Files:** `packages/web-ui/src/styles.css` (`.qm-layout--mobile-unit`), `QueryPanelView.tsx`, `AppChrome.tsx` compact header, tests; builds on Task 20's class.
**Change:** header with unit context (when provided), connection, theme buttons, account; quick access as five 88 px tiles; one card with the form at touch density on a 6-column grid; full-width 64 px Run query; last request condensed below. No muted text for anything the officer reads; 16 px minimum; every target 48 px or more.
**Tests first:** extend Task 20's tests: tile targets, Run height, no `text.muted` in the mobile-unit layout (computed colour), 1024x768 without horizontal scroll (Playwright in Task 21).

## Wave A-D1 (Track A): admin shell and builder layout

### A1 Admin shell (S to M)

**Files:** `apps/web/src/admin/AdminLayout.tsx`, `AdminLink.tsx`, `shell.css`, `AdminShell.test.tsx`.
**Change:** left rail: "Back to queries" first, Configure (Site configuration), People (Users and roles), Audit log `aria-disabled` with visible "Arrives in M2". Replaces the minimal back link and Config/Users bar from Track B's 09-29-26 fix batch, keeping their accessible names where they still fit (check Track B's tests and Task 35's spec before renaming).
**Tests first:** rail landmark and order; `aria-current="page"`; audit item focusable with its reason; back link returns to the query panel.

### A2 Builder layout and tree (M to L)

**Files:** `apps/web/src/admin/ConfigBuilder.tsx`, `FormTab.tsx`, `TypeEditors.tsx`, `shell.css`, new `BuilderTree.tsx`, tests.
**Change:** toolbar (title, status strip: live version and draft state, issue button, Form or JSON switch, History, Publish with its reason); three panes: tree (search, query types, sections, fields with issue marks as text for screen readers, site items), editor, preview (Task 32's preview moves here). The tree selects what the editor shows; the generic form stays reachable for sections without a purpose-built editor. The editor renders only the item selected in the tree (a query type's editor scrolled to the field, or one site section); no list of raw top-level keys. Site items use plain labels with the key in mono. At desktop width the three panes fill the viewport height and scroll independently; query types in the tree collapse, with the selected one expanded.
**Tests first:** tree keyboard navigation (buttons in lists, `aria-current`), selection drives the editor, issue marks announce "1 warning" or "1 error", issue button focuses the first issue's control; the builder performance helpers (legend-based `group()`, `fill()`, `preloadAdminRoutes`) stay in use.

## Wave A-D2 (Track A): editor and preview

### A3 Editor sections and plain language (L, split by editor)

**Files:** `TypeEditors.tsx`, `RulesEditor.tsx`, `CommandsEditor.tsx`, `PicklistEditor.tsx`, `controls.tsx`, `GenericForm.tsx`, en.json labels, tests.
**Change:** ruled sections with a label column; plain-language labels ("Label shown to users", "Choices come from", "When is it shown?" as radio cards with the rule as a sentence, "Is it required?"); keys, role, pattern and JSON pointer under a collapsed "Advanced settings"; diagnostics as plain sentences at their control (existing `aria-describedby` wiring kept). No schema change: the sentence rule writes the same `Condition` (PR2 ruling: no new condition syntax).
**Tests first:** each editor's existing tests keep passing with new labels (update names in one commit per editor); advanced settings collapsed by default and its controls still reachable; round trip of editor output through `validateSiteConfig` unchanged.

### A4 Preview states and issue navigation (S to M)

**Files:** `Preview.tsx`, `ConfigBuilder.tsx`, tests.
**Change:** preview empty (site item selected), loading (type switch, `aria-busy`, which Task 32 already exposes), paused (draft has errors: "Preview paused: n errors", "Go to the error"); Preview as Dispatcher or Officer (layout class only).
**Tests first:** each state; paused never renders a stale form; Go to the error focuses the control.

### A5 Publish and history UI (M, after AC2)

Built with AC2 (Tasks 27, 33 part 2), not before: publish review dialog (changes in plain language from `changedPointers`, change note, "Publish version n"), toast "Published version n. Open screens update within 15 seconds.", history drawer (named region, Esc closes) with roll back. Until then A2's toolbar keeps publish `aria-disabled` with the reason.

## Checks per PR

`pnpm verify` (Git Bash first on PATH), `pnpm audit --prod`, e2e once per PR with the checker's go, one Opus 5.5 `medium` critic (a11y, E1, focus retention, design-target match against the mockup), then the push request with head sha and critic disposition. Visual baselines (D0.4) update only in the PR that changes the look, with the images in the PR.

## Rulings (checker, 09-29-26)

1. D0 goes to Track B.
2. D0.4 visual baselines are their own spec inside D0 (`apps/web/e2e/visual.spec.ts`); Task 21 is already merged. Ask the checker before each e2e run (port 3000).
3. B3 requests list is in M1 P3: it fills the dispatcher's right pane, and submit already ends at the acknowledgment, so it is phase-true.
4. Budget order: before the Thu 10-01 2 PM reset only D0, B-D1 and A-D1 run; A-D2 and B-D2 run after it.
5. Fonts: the developer approved self-hosted IBM Plex, downloaded from the github.com/IBM/plex releases, with its `OFL.txt` shipped beside the woff2 files in `apps/web/src/fonts/` (D0.2 Step 0 is done).
6. Roles: Track B implements D0, B-D1 and B-D2; a Track A builder session implements A-D1, A-D2 and A-D3; session "M1P3 A W3" is design lead (no implementation): it answers design questions and reviews diffs and screenshots against the target on request.
