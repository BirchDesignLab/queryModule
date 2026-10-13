# Query Module visual system and screens (design pass 09-29-26)

Status: approved 09-29-26 as the design target (developer, via the checker). No product code changes with this document.
Mockup: clickable, private Artifact https://claude.ai/artifact/9eV85kHA7ZxDeupDfiz9Ys (not in the repo: Biome lints HTML, and the mockup is prototype code, not product code).
Contrast proof: `CONTRAST_PAIRS` in `packages/tokens/src/contrast.ts`, checked in every mode by `packages/tokens/src/tokens.test.ts` (the proposal script `scripts/design/contrast-check.ts` was deleted when D0.1 moved the palette into the tokens package).

## Why

The developer's verdict on release 77ad8c5: it works, but it reads as a developer tool. The builder shows JSON paths as labels, nested fieldsets and full-width buttons. The target is a console that stands next to the leading CAD products: dense, calm, dark-first, with one clear accent and nothing decorative.

## Direction

An operations console. Four surface steps carry the hierarchy, so panels need few borders. One signal accent marks what is selected or actionable. Severity colours are reserved for responses and badges. Everything an operator reads back character by character (plates, VINs, commands, correlation IDs) is set in a monospace face.

Signature element: the **command echo**. Under every query form a mono strip shows the terminal command the form is building (`VEH.ZZ-0001.TX`), live as the user types, with an "Edit as command" action. It teaches the terminal syntax (FR-050 to FR-055) and makes the form and terminal read as one draft (spec 4.4, 6.7).

## Tokens

All values stay in `packages/tokens` (spec 6.5: components use no literal colour or size). Existing names keep their meaning; new names are marked. Night is the design reference; day and red shift get the same care.

### Colour (per mode: night / day / red shift)

| Token | Night | Day | Red shift | Status |
|---|---|---|---|---|
| `color.surface.sunken` | #0a0e13 | #eceff3 | #080000 | new: app background |
| `color.surface.base` | #10151c | #ffffff | #0d0000 | changed night; panels, inputs |
| `color.surface.raised` | #161d26 | #f7f9fb | #1a0500 | changed night, day |
| `color.surface.overlay` | #1e2733 | #ffffff | #240900 | new: menus, dialogs |
| `color.surface.scrim` | #0a0e13 | #1c2430 | #080000 | modal backdrop, drawn at 0.8; day is dark so a white page dims |
| `color.border` | #66768a | #7a8494 | #a05a00 | changed night, day; control edge 3:1 |
| `color.border.subtle` | #263140 | #dde2e8 | #3a1600 | new: dividers (decorative) |
| `color.text.body` | #e7ecf2 | #121820 | #ffb000 | changed night, day; 7:1 on every surface |
| `color.text.muted` | #9eabbc | #4d5968 | #d98f1a | new: secondary text, 4.5:1 |
| `color.accent` | #8ab4ff | #0b4a9e | #ff8c1a | changed night; links, selection, 7:1 |
| `color.accent.fill` | #8ab4ff | #0b4a9e | #ff8c1a | new: primary button |
| `color.accent.onFill` | #0a0e13 | #ffffff | #0d0000 | new: primary button label |
| `color.accent.subtle` | #1b2f4d | #e1ebfa | #3a1800 | new: selected row, pressed chip |
| `color.status.ok` | #5fd39a | #0f6b44 | #e0b84a | new: connected, acknowledged |
| `focus.ring` | #ffd24d | #1f5fbf | #ffe0a8 | changed red shift (see E1) |
| `field.required` | #ff8080 | #a00000 | #ff4d4d | unchanged; invalid edge, error text |
| `color.severity.*` | unchanged | unchanged | unchanged | reserved for responses |

Red shift keeps its rule: amber and red on near-black, no blue-dominant colour. Its focus ring moves from #ff4d4d to pale amber #ffe0a8, because a red ring beside a red invalid edge breaks E1.

Contrast pairs (checked by the script for every mode; the tokens package tests take them over in the implementation task): body text 7:1 on all four surfaces and on `accent.subtle`; muted text 4.5:1, also on `accent.subtle`; accent text 7:1 on base and raised, 4.5:1 on `accent.subtle` (a pressed button's type code); primary label 4.5:1 on its fill; control edge and focus ring 3:1 on every surface; error text and status text 4.5:1. The focus ring sits outside a 2 px gap, so its neighbour is always a surface, never the button fill.

### Type

| Role | Face | Use |
|---|---|---|
| Interface | IBM Plex Sans 400, 500, 600 | everything by default |
| Labels | IBM Plex Sans Condensed 600, uppercase, 0.06em tracking | section labels, badges, table headers |
| Data | IBM Plex Mono 400, 500 | plates, VINs, commands, IDs, keys (separates 0 and O, 1 and I) |

Scale (px): 12, 13, 14, 16, 20, 24, 32. New tokens `type.size.xs` to `type.size.3xl`, `type.family.label`, `type.family.data`. Fonts are OFL: self-host the woff2 files (no CDN at runtime; CJIS networks are often closed). Adding them is a `chore/deps-*` PR if we use `@fontsource`, or committed files under `apps/web/src/fonts/` with no dependency. System fallbacks stay in every stack.

### Spacing, radius, density

`opacity.inert` (0.55) is how far inert content recedes: the paused preview and the skeleton pulse. `opacity.scrim` (0.8) is how strongly `color.surface.scrim` draws behind a modal. Neither is site-overridable, like every scale token. Three fixed layout constants are not tokens (not in `TOKEN_NAMES`, no theme or config override): `layout.wide` (1024 px), from which each admin pane scrolls on its own under the toolbar (below it the page flows as one column); `layout.stack` (864 px), from which the admin rail sits beside the section (below it the rail is stacked above it at its own height); and `layout.toolbar` (720 px), the section width from which the builder's heading and toolbar share a row. shell.css writes them literally in its `@media` and `@container` conditions, which cannot read `var()`; `shell.css.test.ts` accepts a literal length only there, and only when it equals a constant. Breakpoints are px because the tokens they guard are px: a media-query rem follows the browser default font size, which the px tokens ignore (#484).

4 px grid: existing `space.1` to `space.6` plus new `space.5` (20), `space.8` (32), `space.12` (48). Radius: `radius.sm` 4, new `radius.control` 6, `radius.md` 8 to `radius.panel` 10. Focus: `focus.ring.width` 3 to 2 px, offset stays 2 px.

Density is chosen by the persona layout (spec 6.1), never by width:

| | Dispatcher, admin | Officer (mobile unit) |
|---|---|---|
| Control height | 36 px (`control.height.dense`, new) | 56 px (`control.height.touch`, new) |
| Primary action | 36 px | 64 px |
| Minimum target | 24 px (WCAG 2.2 2.5.8) | 48 px (`target.min`, spec 6.3) |
| Input text / label / body | 14 / 13 / 14 | 20 / 16 / 16 |

## Controls and states

- **Inputs and selects**: 1 px `color.border` edge on `surface.base`, 6 px radius; hover lifts the edge to `text.muted`; read-only is dashed on `surface.raised`.
- **Focus and invalid (E1)**: focus is a 2 px `focus.ring` outline with a 2 px offset, outside the control. Invalid is a 2 px `field.required` edge inside the control (border plus inset shadow), an error icon and a message linked by `aria-describedby`. Both show together. Checkbox chips carry the ring on the chip.
- **Required**: red asterisk (`aria-hidden`), visually hidden "required", `aria-required` (spec 6.2, UX-004). A site default shows a small "Default" tag (IBM Plex Sans Condensed 12 px, `type.size.xs`).
- **Buttons**: primary (accent fill), secondary (raised, bordered), ghost (text only), danger (ghost with error colour). `aria-disabled` buttons stay focusable: dashed edge, muted text, visible reason (spec 6.2). Full-width buttons only on the sign-in panel. The officer's Run query is 64 px tall and shares its row with Clear and the status line.
- **Segmented control**: a group of `aria-pressed` buttons in a sunken track; used for form or terminal, theme, preview persona, editor view.
- **Source chips**: a checkbox inside a bordered label; checked fills with `accent.subtle`; each shows its timeout in mono.
- **Badges**: condensed uppercase text; severity badges use the severity tokens; status badges (pending, acknowledged) are outlined.
- **Motion**: 120 ms colour transitions; a rule-revealed field flashes `accent.subtle` once. All motion drops under reduced motion.

## Screens

### App shell and header (Track B)

52 px bar: product mark and name, site name, main navigation (Queries, Status, Admin for admin and implementer), connection pill (icon plus text, spec 6.8), and an account menu (email, role, preferences, shortcut sheet, sign out). The theme choice moves into preferences and the menu; the officer header keeps it as a three-icon segmented control. Each page still owns its h1.

### Dispatcher query panel (Track B)

Two panes at desktop width: the query panel (640 px of content, a 682 px card, so the five quick-access buttons fit one row) and "Requests this shift". Panel order: title with the form or terminal switch; quick access as a compact button row with the type code in mono (`aria-pressed`, `aria-keyshortcuts`, one Alt+1 to Alt+5 hint); the subtype bar as a segmented control when the type has a type field (Property); the command echo; the form on a 12-column grid (fields sized by content: state 4, because it shows the state's name, plate 3, VIN 5); "More details" as a disclosure; sources as chips; a sticky action bar with Run query (Enter), Clear and the status line (validation count, spec 6.2). Terminal mode keeps the same draft and shows the command reference. The acknowledgment becomes an entry in the requests list (type, values in mono, ack time, correlation ID with copy, sources pending); response details arrive with M2 dispatch.

### Officer, mobile unit (Track B)

Designed at 1024x768 (spec 6.3). Header: unit ID, connection, theme, account; no navigation. Quick access becomes five 88 px tiles. One card holds the form at touch density, a 6-column grid, and a 64 px Run query that shares its row with Clear and the status line (not full width). The last request sits under it, condensed. Muted text is not used for anything the officer must read.

### Admin shell (Track A)

A left rail: "Back to queries" first, then Configure (Site configuration), People (Users and roles), and the audit log shown as coming in M2 (`aria-disabled` with reason). The app header stays, with Admin current. This rail supersedes the minimal back link and Config/Users bar from Track B's 09-29-26 fix batch; the Track A shell task replaces it and keeps its tests' accessible names where they still fit. Users and roles: one table, role as an inline select, status badge, last sign-in, row actions (sign out everywhere, disable).

### Builder (Track A)

- **Toolbar**: title, draft chip ("Draft, based on version 7. 2 unpublished changes."), issue count badge, Form or JSON switch (the raw tab), History, "Review and publish".
- **Left, tree**: search, query types with sections and fields (warning marks per item), add field and add query type; then site items: terminal commands, quick access, lists, sources, theme, labels and translations.
- **Centre, editor**: breadcrumb, item name, then plain-language groups: "Label shown to users" with translations, "Choices come from", "When is it shown?" (Always, Only when a rule matches, Never) with a sentence rule ("Show when State is not the site default (TX)"), "Is it required?", default, terminal commands. Keys, role, pattern and the JSON pointer sit under a collapsed "Advanced settings". Diagnostics appear on the item as plain sentences with a fix action.
- **Right, live preview**: the dispatcher's own panel renderer fed with the draft (ADR-0011 item 4), a Dispatcher or Officer switch, and run disabled with "Preview: queries are not sent".
- **History and publish, ready for AC2**: a history drawer lists versions (who, when, note) with roll back; "Review and publish" opens a dialog listing changes in plain language, an optional change note, and "Publish version 8"; the toast says "Published version 8. Dispatchers see it within 15 seconds." Until AC2 lands, publish and roll back stay `aria-disabled` with the reason, as today.

### Mock responses editor (Track B, M2 P0.5)

Designed 10-05-26 (#547, CFG-2; spec 5.4). Mockup tab "Admin: mock responses"; each frame there carries its keyboard model and announcements. It is a branch of the builder, not a new screen: same toolbar, tree, editor and right pane, same draft and publish.

- **Tree**: a "Mock responses" group under Site: "Coverage" first, then one node per mock source, each with its responses (query type, plus the type match such as "Property, Firearm") and "Add mock response". Error marks per row as elsewhere (`aria-hidden` mark, visually hidden ", n errors").
- **Coverage grid** (the "Coverage" node): a real table, query types as rows, mock sources as columns (header shows the source's response time in mono). A cell is covered (button: "Default + 2 scenarios", "No record by default", error badge if any), Missing (dashed `field.required` edge, error icon, the word "Missing" and an "Add mock response" button whose name carries source and query type), or Not asked (muted italic text, hidden reason). Missing is the error `config.missingMockResponse` and blocks publish.
- **Source node**: Response time as two numeric inputs, Shortest wait and Longest wait (`latencyMs` lives on the source), the source's responses, and an "Add mock response" form (query type, then the type field when the type has one; Add is `aria-disabled` with "already has this response" and an "Open it" button).
- **Response editor**, ruled sections stacked (the label column is dropped here; the editor is narrower beside a 380 px right pane):
  - Matches: query type read-only (fixed per response); the type-field select ("Any property type" or one code) with the most-matching-types rule as the hint.
  - When no scenario matches: radio list, No record or Returns a record. The default is always a payload.
  - Scenarios, in match order (first match wins): a bordered card per scenario with heading "Scenario n", a one-line summary ("When Plate is `ZZ-0001`: returns a record."), and Edit or Close, Move up, Move down, Remove (36 px, named with the number; the end moves stay focusable with `aria-disabled`). The body holds trigger fields (field select, "is", mono value; all must equal), the Result radio list (Returns a record, No record, Source error, Times out, Credentials rejected; each with a one-line effect) and, for a record, the payload editor.
  - Payload editor: key and value rows in mono. Groups and lists nest by a 20 px indent plus a 1 px `color.border` guide; group and list rows show a condensed tag ("Group, 3 fields", "List, 1 item") and an "Add inside" button; list items read "Item n". Keys come from the fixture allowlist (a datalist). No record writes `{ status: "NO RECORD" }`; Returns a record starts with one `status` row.
  - Advanced settings: JSON pointer in the mock file and the file path.
- **Fixture policy at the row**: one diagnostic per payload row from the `checkFixturePolicy` keys, as E1 at admin density: `aria-invalid` on the exact input (the key for `fixture.unknownKey`, else the value), message plus a fix button under the row ("Use ZZ-0001", "Use 1901-01-01", "Use TESTERSON", "Remove row"). The scenario card turns its edge `field.required` and its summary, tree row, coverage cell and toolbar badge all count it. Messages name the rule, never the value (spec 5.9). Trigger values are exempt. The server check on publish stays the authority.
- **Right pane, "Try a match"** (post-demo, #565; until then the right pane on mock nodes is a static "Select a response" note; replaces the live preview on mock nodes): the query type's fields, the outcome badge (Returns a record info, No record ok, Source error critical, Times out and Credentials rejected warning, always with text), which entry matched ("Scenario 1 of Vehicle" or "Default"), the wait, and the payload as read-only JSON. Same matching as the adapter; nothing is sent. Announces the outcome kind once typing pauses, never values.
- **Adding responses**: from a Missing cell (creates a no-record default, focus to the new response's heading, toast "Mock response added: State source, Driver's license. Default: no record."); from a source's "Add mock response"; from the new query type flow ("Start each mock source with a no-record response", checked) and the new source flow (response time, query types that ask it, "Start with a no-record response for each", checked). Scaffolds carry no person, vehicle or address leaves.
- **Review step**: the publish dialog lists "Form and fields" and "Mock responses" as two lists of plain sentences ("National source, Vehicle: 1 scenario added", "State source, Driver's license: response added (default no record, 0 scenarios)", response time changes). Lines never carry trigger values or payload content; the audit record and the default change note use the same lines.
- **Announcements** (one polite region, no values): scenario added, moved ("Scenario 2 moved to position 1"), removed ("... 1 scenario left"); error count when it changes on leaving a field ("2 errors in mock responses"); "Fixed. n errors left". Focus never drops to the page: after a removal it goes to the next scenario's Edit, the next row, or the Add button.
- **Payload visibility**: payload content shows only inside the admin console (admins and implementers), never in announcements, logs or analytics.

### Result cards and the cards builder (Track B, M2 P1; v5 approved 10-13-26)

Designed 10-13-26 (BW1 Task 1, #596; FR-060, UX-010, UX-011, UX-015, UX-016; spec 4.5, 6.2, 6.6, 6.7; design note `docs/design/2026-10-07-result-card-config.md`). Mockup tabs "v5 draft: Result cards" and "v5 draft: Builder cards" (approved by the developer 10-13-26 with the rulings below); every v4 tab is unchanged. Each frame carries its keyboard model, announcements and rules under it.

**Request entry.** A `<section>` named by its heading: query type code, type name and the primary typed field (plate for VEH, name for PER; the short correlation ID when that field is empty), never payload content (ruling 12). Other typed values show beside the heading in mono. The header carries the request's highest severity badge (`assessResult` over every returned source). Meta row: ack time (MM-DD-YY HH:mm:ss), full correlation ID, Copy ID (hidden text names the type and primary typed field, ruling 12), and the status summary in words ("1 of 1 sources done. 1 failed, 1 not run."; #587 counts dispatched sources only).

**Parts.** Part 0 lists its sources directly. A nested part is its own `<section>` headed "Wanted check, also run from Person". A skipped nested part shows a Not run badge and its reason as a sentence from the `skipReasons` message keys.

**Source states.**

- `returned`: a card (below). No record is a card too: its NO RECORD status carries the info mark and badge.
- `pending`, `timedOut` ("no answer in 10 s"), `failed` ("the source reported an error"), not run ("not run (plate only)", #587) and `interrupted`: one status line each, icon (`aria-hidden`) plus "Source: status" in text plus a muted reason. Never a card, never colour alone.

**Card.** `<section aria-labelledby>` headed "State system: returned" (h4 in part 0, h5 in a nested part), the response time in mono, and the severity badge at the end of the header row. A 4 px start edge in the severity colour repeats the badge; it never replaces it.

- Summary: the mapping's `summary` and `both` elements as one `<dl>` grid (`<dt>` condensed uppercase label, `<dd>` mono value), 140 px minimum columns at dispatcher density.
- Toggle (UX-015): a ghost button directly under the summary, "Show detail" plus "n more items", `aria-expanded` and `aria-controls`; hidden text adds the source, type and primary typed field. The detail region (detail-only elements and detail tables) opens below the toggle, so the toggle and everything above it stay put. Focus stays on the toggle. Summary is the default view for every persona; open state lives in memory per card.
- Table (UX-016): `<div role="region" tabindex="0" aria-labelledby>` around a `<table>` with `<caption>` (label plus hidden row count) and `<th scope="col">`; it scrolls in its own box and the page never scrolls sideways.
- Keyword hit: `<mark>` in the severity style's token colours, the style's icon (`aria-hidden`), the word, the visible marker (`!!`, `!`, `i`; `aria-hidden`) and a visually hidden "(critical)". Elements with `highlight: false` (the plate) render plain; the badge still scans them.
- Severity badge: icon (`aria-hidden`), text ("Critical"), marker (`aria-hidden`), severity colours.
- Generic dump (no candidate mapping): a note under the header ("No card is set up for this result, so every field shows under its path."), then every leaf in payload order with its path as the `<dt>` in mono, keyword marks on, no toggle.

**Officer (1024x768).** Same renderer with the `.touch` class: summary in two columns, values 20 px mono, labels, meta, status lines and reasons 16 px in body colour (no muted text), Copy ID and Show detail 48 px, table text 16 px. Detail is one tap behind the toggle (spec 6.3).

**Announcements (spec 6.6).** Polite, coalesced per correlation ID within 1500 ms: "VEH ZZ-0001: 2 of 2 sources done. 2 returned, critical: STOLEN." A critical result goes to the assertive region at once: "VEH ZZ-0001: critical: STOLEN, State system." Announcements carry the query type, the primary typed field (the short correlation ID when it is empty), counts, status words, severity and configured keyword text; never payload content (ruling 12). Incoming events, fetches and re-maps never move focus or re-create the focused element (stable keys: correlation ID, part, source).

**Builder: Result cards group.** A collapsible top-level group between Query types and Site (#586 pattern). Per query type: its cards in config order, numbered, each named by its narrowing ("All results", "National system", "Mobile unit", "when State is not TX") with the card key in mono; then "Add Vehicle card". Last child: "Keywords and severity". Error and warning marks as elsewhere (`aria-hidden` mark, hidden ", 1 warning").

**Card editor.** Ruled sections with the label column:

- Head: "Vehicle: All results", card key, position ("1 of 2 Vehicle cards"), Move card up and down, Remove card.
- Applies to: Source (Any source or one), Shown to (Everyone or one persona), and Always or "Only when a rule matches" with the `ConditionEditor` sentence ("Use when State is not TX"). Equal keys show `config.duplicateMapping` under the rule with "Open <other card>"; Review and publish is blocked.
- Which card wins: a table over fixed contexts (each source; Dispatch and Mobile unit; State TX and OK when a card of the type has a rule) with the winning card, its score and why ("source +2", "earlier in the list", "only card that fits"). The rows this card wins carry a "This card" tag. Same rule as `mapResponse` (rule +4, source +2, persona +1, ties to config order).
- Rows: one bordered item per element, as the mock editor's scenarios: heading is the row label, a one-line summary (path in mono, kind, view, "keywords not marked"), Edit or Close, Move up, Move down, Remove (36 px, named with the label). Body: Kind (Value or Table radios), Path (text input with a datalist) plus pick buttons for the paths found in the draft's mock payloads (list paths only for a table), Label shown to users (required, E1), Show in (Summary, Detail, Both segmented control), Format (As sent, Upper case, Phone number, Date MM-DD-YY, Template), Mark keywords (checkbox with the hint that the badge still scans everything). Table rows swap Format for a Columns table (path relative to one entry, label, format, mark, remove; Add column).
- A path found in no mock payload is a warning at the row ("A real source may still send it; until then the card leaves this row out."), not an error.
- Advanced settings: card key (read-only once published), JSON pointer, label key prefix `mapping.<cardId>.*`.

**Card preview (right pane).** "Card preview" with Dispatcher or Officer. Result from (source), then "Pick a scenario" (default, from the draft's mock list) or "Type values" (matched through `matchMockScenario`). A line shows the outcome badge and which entry matched. The body renders the production card (one renderer, ADR-0011 decision 4) with the toggle working; a behaviour scenario renders the status line. Under it: which card was used and whether it is this card. Payloads come only from the draft's mock; typed values stay in the pane.

**Keywords and severity editor.** Keywords as a table: Keyword (mono, upper case), Severity, Except phrases (chips with 28 px remove buttons; type and press Enter to add), Remove; Add keyword. `config.exceptWithoutKeyword` shows under the phrase. Severity styles per level: a live badge and mark sample, Text colour and Background token pickers, Marker, Bold, Icon, and contrast ratios for Night, Day and Red shift. Below 4.5:1 in any theme is an error on Background (blocks publish); 4.5 to 7:1 is shown as "(under 7:1)" without blocking (ruling 7). The shipped severity styles are at least 7:1 in every theme. Audible cue stays off in M2 P1. Right pane: "Keyword preview" with an editable sample line (pane state only), its severity, and a sample Vehicle card.

**Review lines.** Two lists in the publish dialog, "Result cards" and "Keywords and severity", one plain sentence per change: "Vehicle, card veh-summary: row Make (vehicle.make) added, summary", "Vehicle, card veh-national added: National system, 2 rows", "Keyword TESTMAKE added, warning", "Info style: background is now color.surface.raised". Configuration only; never payload content or typed values. The dialog says open cards are redrawn with the new settings (Q2).

**Try a match (refines v4).** Source and Query type are selects (default: the selected response's source and type), then the type's fields, the outcome badge, which entry matched, the wait, and the answer as "Result card" (production renderer, draft cards) or "Payload" (read-only JSON). Announces the outcome kind once typing pauses, never values. Values live in component state only.

**Developer rulings (10-13-26, mockup v5 approved).**

1. The Show detail toggle sits directly under the summary; detail opens below it (UX-015).
2. Summary is the default view for every persona; open state lives in memory per card.
3. Keyword marks: the visible marker and icon are `aria-hidden`; a visually hidden "(critical)" names the severity (UX-010, UX-011). The markers (`!!`, `!`, `i`) stay for now; removing them later needs a non-colour mark style and a spec 4.5 and 6.6 amendment.
4. A skipped part's reason is one sentence per `skipReasons` key with the field label as a param (`field.required`: "Wanted check not run: needs Last name."; `plan.noPlateOnlySource`; `plan.nestedNoSources`).
5. No size or depth cap on the generic dump in M2 P1.
6. Card preview: "Pick a scenario" by default, "Type values" second.
7. Contrast: below 4.5:1 blocks publish, 4.5 to 7:1 shows a hint. Info severity rises to at least 7:1 (Day and Night background `#1a4fa3`, 7.80; Red shift `#d09050`, 7.66) and Red shift critical to `#ff7070` (7.67); BW2 Task 6.
8. A 4 px start edge in the severity colour reinforces the badge.
9. No Retry button in M2 P1 (spec 5.7 work).
10. Richer default cards for all five query types (summary and detail rows), plus one synthetic DL record mock scenario, config only (BW3 Task 9).
11. Results keyboard joins M2 P1 (BW2 Task 7b): ArrowUp and ArrowDown select, Enter toggles detail (spec 6.4). Delete from view stays in M3.
12. Announcements and the fieldset, Copy and Retry accessible names carry the query type and the primary typed field (the short correlation ID when it is empty), never payload content. This replaces the 10-08-26 Q4 ruling; spec 6.6's example already uses the plate.

## Revision 2 (design critic, 09-29-26)

One Opus 5.5 medium critic read the mockup and this document (25 findings: 1 blocker, 12 important, 12 minor; fixtures clean). Changes, which also bind the implementation tasks:

- **Mockup notes stay out of product UI.** They live in the frame captions. (A Today / AC2 stage switch was tried and then removed by the developer's ruling below: the mockup shows the target experience.)
- **Focus is never lost.** Run, Enter and Clear put focus on the first field (or keep it in the terminal input). A change that shows or hides fields re-renders after focus has moved and restores it; any other change patches in place, so a click on Run is never swallowed. The builder never rebuilds the control the user is on. Every focusable element has a stable id.
- **One draft for form and terminal.** Switching to the terminal writes the command; switching back parses it into the draft. The terminal validates like the form: unknown command or missing required value sets `aria-invalid` on the input and lists the errors under it.
- **Requests pane is populated.** Run shows a Sending row that becomes Acknowledged on the 202. Seeded examples show a timed-out source with "Retry State source" and, as an M2 preview, an expanded response card: severity banner, one tile per source (outcome and time), values in mono, keyword in `<mark>` with its severity text.
- **Builder.** Ruled sections with a label column replace stacked cards. A status strip shows the live version (who, when) and the draft ("kept in this tab only" today, "saved" after AC2). The issue badge is a button that goes to the first issue; an empty label is an error at its control (E1 at admin density). The preview has empty (site items), loading (type switch) and paused (draft has errors, with "Go to the error") states. JSON view and Preview as Officer work.
- **Officer.** Touch density is a class (`.touch`) shared with the preview's Officer view; meta text, chip timeouts and badges are 16 px body colour; every target is 48 px or more.
- **Smaller fixes.** Disabled items show their reason (audit log "Arrives in M2"); the account menu holds the theme choice and closes on Esc, as does the history drawer (a named region); quick access and tiles are `role="group"`; shortcuts are declared only where bound; a revealed field keeps a static "Shown" tag under reduced motion; chips draw one focus ring; programmatic focus shows the ring on selects; row actions carry the user's name; the header shows the console position (DSP-03) and a prompt mark instead of a letter.

## Developer rulings (09-29-26, via the checker)

1. Night focus ring: amber #ffd24d.
2. Fonts: IBM Plex (Sans, Sans Condensed, Mono), self-hosted in the product. The mockup may keep Google Fonts.
3. Dispatcher controls: 36 px. Officer stays at 48 px targets or more (56 px controls, 64 px primary action).
4. The mockup is the shared target vision: publish, history and roll back work in it as designed, the M2 response card stays, and one small "Design target" label marks it. The product still ships each capability with its own phase: until AC2 lands, publish and roll back stay `aria-disabled` with a visible reason (spec 6.2), and response cards arrive with M2 dispatch.

## Developer and design lead rulings (10-05-26, via the M2 manager)

1. Mock responses editor mockup (tab "Admin: mock responses") approved. A response's query type is fixed once it exists. Review and audit lines omit trigger values. A scenario needs at least one trigger field with a value; the default response is the catch-all. No `mock_credential_state` UI: the "Credentials rejected" result is enough for the demo (M3 P1 owns credentials). "Try a match" comes after the demo (#565).
2. Builder panes (#486, design lead): editor and preview stay `surface.base` panes (#436). The preview body is an edge-to-edge sunken well under a ruled head. The editor takes the mockup's 20 px block inset; its inline inset stays 12 px, because 24 px would push a section's label column above its controls at 1366.
3. Breakpoints are px (#484, design lead): see Spacing, radius, density.
4. Builder toolbar (#546, re-ruled 10-05-26): two rows, every control on the first row and the status line with the reasons for the disabled buttons on the second; 8 px between controls so the first row holds at 1366. At 1366 a long status line (a later version number) may wrap the second row's text onto one more line; the controls row never wraps.

## Implementation plan

Written after approval, split by track with tiers, as plan tasks (the developer's step 4).
