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

`opacity.inert` (0.55) is how far inert content recedes: the paused preview and the skeleton pulse. `opacity.scrim` (0.8) is how strongly `color.surface.scrim` draws behind a modal. Neither is site-overridable, like every scale token. Three fixed layout constants are not tokens (not in `TOKEN_NAMES`, no theme or config override): `layout.wide` (64rem), from which each admin pane scrolls on its own under the toolbar (below it the page flows as one column); `layout.stack` (54rem), from which the admin rail sits beside the section (below it the rail is stacked above it at its own height); and `layout.toolbar` (45rem), the section width from which the builder's heading and toolbar share a row. shell.css writes them literally in its `@media` and `@container` conditions, which cannot read `var()`; `shell.css.test.ts` accepts a literal length only there, and only when it equals a constant.

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
- **Buttons**: primary (accent fill), secondary (raised, bordered), ghost (text only), danger (ghost with error colour). `aria-disabled` buttons stay focusable: dashed edge, muted text, visible reason (spec 6.2). Full-width buttons only on the sign-in panel and the officer's run action.
- **Segmented control**: a group of `aria-pressed` buttons in a sunken track; used for form or terminal, theme, preview persona, editor view.
- **Source chips**: a checkbox inside a bordered label; checked fills with `accent.subtle`; each shows its timeout in mono.
- **Badges**: condensed uppercase text; severity badges use the severity tokens; status badges (pending, acknowledged) are outlined.
- **Motion**: 120 ms colour transitions; a rule-revealed field flashes `accent.subtle` once. All motion drops under reduced motion.

## Screens

### App shell and header (Track B)

52 px bar: product mark and name, site name, main navigation (Queries, Status, Admin for admin and implementer), connection pill (icon plus text, spec 6.8), and an account menu (email, role, preferences, shortcut sheet, sign out). The theme choice moves into preferences and the menu; the officer header keeps it as a three-icon segmented control. Each page still owns its h1.

### Dispatcher query panel (Track B)

Two panes at desktop width: the query panel (640 px of content, a 682 px card, so the five quick-access buttons fit one row) and "Requests this shift". Panel order: title with the form or terminal switch; quick access as a compact button row with the type code in mono (`aria-pressed`, `aria-keyshortcuts`, one Alt+1 to Alt+5 hint); the subtype bar as a segmented control when the type has a type field (Property); the command echo; the form on a 12-column grid (fields sized by content: state 2, plate 3, VIN 5); "More details" as a disclosure; sources as chips; a sticky action bar with Run query (Enter), Clear and the status line (validation count, spec 6.2). Terminal mode keeps the same draft and shows the command reference. The acknowledgment becomes an entry in the requests list (type, values in mono, ack time, correlation ID with copy, sources pending); response details arrive with M2 dispatch.

### Officer, mobile unit (Track B)

Designed at 1024x768 (spec 6.3). Header: unit ID, connection, theme, account; no navigation. Quick access becomes five 88 px tiles. One card holds the form at touch density, a 6-column grid, and a full-width 64 px Run query. The last request sits under it, condensed. Muted text is not used for anything the officer must read.

### Admin shell (Track A)

A left rail: "Back to queries" first, then Configure (Site configuration), People (Users and roles), and the audit log shown as coming in M2 (`aria-disabled` with reason). The app header stays, with Admin current. This rail supersedes the minimal back link and Config/Users bar from Track B's 09-29-26 fix batch; the Track A shell task replaces it and keeps its tests' accessible names where they still fit. Users and roles: one table, role as an inline select, status badge, last sign-in, row actions (sign out everywhere, disable).

### Builder (Track A)

- **Toolbar**: title, draft chip ("Draft, based on version 7. 2 unpublished changes."), issue count badge, Form or JSON switch (the raw tab), History, "Review and publish".
- **Left, tree**: search, query types with sections and fields (warning marks per item), add field and add query type; then site items: terminal commands, quick access, lists, sources, theme, labels and translations.
- **Centre, editor**: breadcrumb, item name, then plain-language groups: "Label shown to users" with translations, "Choices come from", "When is it shown?" (Always, Only when a rule matches, Never) with a sentence rule ("Show when State is not the site default (TX)"), "Is it required?", default, terminal commands. Keys, role, pattern and the JSON pointer sit under a collapsed "Advanced settings". Diagnostics appear on the item as plain sentences with a fix action.
- **Right, live preview**: the dispatcher's own panel renderer fed with the draft (ADR-0011 item 4), a Dispatcher or Officer switch, and run disabled with "Preview: queries are not sent".
- **History and publish, ready for AC2**: a history drawer lists versions (who, when, note) with roll back; "Review and publish" opens a dialog listing changes in plain language, an optional change note, and "Publish version 8"; the toast says "Published version 8. Dispatchers see it within 15 seconds." Until AC2 lands, publish and roll back stay `aria-disabled` with the reason, as today.

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

## Implementation plan

Written after approval, split by track with tiers, as plan tasks (the developer's step 4).
