# Audit console, request view, note, purged and terminal pane (M2 P2 design note)

Date: 10-18-26 (Track B lane, BW1 Task 1, #724). Scope: the screens M2 P2 Track B builds. Plan: `docs/superpowers/plans/2026-10-18-m2-track-b-p2.md` (D-M2P2-5 design first, D-M2P2-6 terminal pane in P2). Spec: 4.7, 5.1, 5.5, 5.6, 6.2, 6.4, 6.6, 6.7, 10.6, 12.3; FR-050, FR-062, FR-063, FR-064, UX-004, UX-014, SEC-012, SEC-021, BR-001.

Status: approved by the developer 10-18-26, all eight open questions ruled as recommended (see "Rulings" at the end).

Mockup: Artifact "Query Module Redesign", tabs "v6 draft: Audit log", "v6 draft: Request view", "v6 draft: Note and history", "v6 draft: Purged" and "v6 draft: Terminal pane" (link in the PR and on #724). Every v4 and v5 tab is unchanged, except the three builder rulings from #698 (below). Each tab has frames, a theme switch (Day, Night, Red shift), and keyboard, screen reader and rules notes under the frame. Mock data only: `example.test` addresses, synthetic ids and names, ZZ- plates, 1901 dates.

## Reused, not redesigned

Everything here uses the v5 tokens and components: `.rail`, `.toolbar`, `.field`, `.select`, `.btn`, `.badge`, `.chip`, `.re` and `.rc` result cards, `.src-line`, `.drawer`, `.ver`, dialogs, the 36 px dispatcher density and the 48 px officer density. No new color token, no literal color. New classes are layout only (`aud-*`, `rq-*`, `dlg6`, `tp-*`).

## Audit log (`/admin/audit`)

- **Where it lives.** A new "Oversight" rail group below People, holding Audit log. Why not under People: People is account administration; the audit log is a read-only record of activity, with its own audience (admin only) and room to grow in M3 (delegations). Users and roles and Audit log have the same audience today, so this is a grouping choice, not a permission one. The rail entry exists only for the `admin` role with `features.adminAudit` on. An implementer's rail (as `AdminLayout.tsx` draws it) has only Configure: no way back to queries, no People, no Oversight; a typed URL shows the 403 state. With the feature off a typed URL shows the 404 state.
- **Filters** (one `form` named "Audit filters"; Enter or the Apply submit button applies): User (a picker over users when `adminUsers` is on, an id field otherwise; matches the actor or the credential owner), Request ID (a UUIDv7, with the expected shape in the error), Event (a select over `AUDIT_EVENT_TYPES` in plain words: "Request viewed by an admin", never `adminViewed`), From and To (local `MM-DD-YY HH:mm`, default the last 24 hours). The 31-day limit is stated next to the window and checked before any request ("Window can span at most 31 days."). Only Apply (or Enter) fetches, because every fetch writes an `auditViewed` row; User and Event change the form only, Rows per page pages at once. While a filter has an error the table, its caption and paging keep the last applied filters, and Export NDJSON is `aria-disabled` ("Fix the filters above to export."); otherwise a line under it says exactly which filters it will use.
- **Table.** A real `<table>` with a caption (including the window) and column headers: Time (`MM-DD-YY HH:mm:ss`, mono), Event (words), Actor (email and a role tag; "System" when there is no email), Request (the 18-character short id the query screen uses, as a link to the request view, or "None"; the first 8 digits of a UUIDv7 repeat for a minute), Credential owner (id or "None"), Details. Details is a native disclosure ("8 items") that lists the keys and values of the stored details, per the schemas in `audit.ts` and `audit-auth.ts`: identifiers and metadata only (spec 5.5), never typed values or payloads. Epoch keys (`olderThan`, the audit filters' `from` and `to`) are stored as epoch ms and shown with the local time beside them. A row with no details says "No details". Newest first, Newer and Older, Rows per page (25, 50, 100, 200; the API cap is 200).
- **States.** Loaded; filter errors (field level, nothing is sent); empty ("No audit events match", with Reset filters); loading (a skeleton, `aria-busy`, a status line); server error (a bordered `role="alert"` box with Try again, filters kept); 403; 404.
- **1024.** Below the admin section width of 920 px the Credential owner column folds under the Actor ("Credentials: usr-0003") so the table never scrolls sideways. It reuses the value of `layout.toolbarRow`; if the developer wants that to be its own constant, it is a Task 3 call.
- **Recorded.** "Viewing and exporting the audit log is recorded." sits in the toolbar, so no admin is surprised that the viewer is audited (`auditViewed`, `auditExported`).

## Admin request view (`/admin/queries/:correlationId`)

The query screen's request entry, read only: the type and short id, values, a severity badge, each part with its source cards and status lines, exactly as the v5 Results tab draws them (same renderer, mapped with the live config). Above it: the breadcrumb, the banner "This view is recorded in the audit log." (placed before the content so it is read first), Back to audit log (filters kept, in memory only), and "Include hidden results", shown as a disabled checkbox chip (dashed, `aria-disabled`) with the reason "Hide arrives in M3." A request that does not exist shows "No such request". The page shows nothing the contract does not carry: no "sent by" line (the admin detail has no actor); the actor is in the audit row.

## Publish note and history drawer

- **History drawer.** Each version shows its publisher's name and its note, or "No note". When the server has no name the id shows in mono with "(name not available)". Notes are plain text (wrapping, never markup). The drawer's hint says notes and names are what the publisher entered. A rollback shows a "Rollback" tag and "Rolled back to version N", written from `rollbackOf` by the system and styled apart from a typed note.
- **Publish dialog.** An optional "Change note" after the What changes list. It is a four-row text area (a 200-character note is unreadable in a one-line field). Control characters (Enter, tab, pasted line breaks) become spaces as they are typed, because `PublishNoteSchema` forbids them, so that rule cannot fail from this field. The count follows zod (UTF-16 units: an emoji counts 2). The count sits beside the label: "37 of 200", then "8 left" with an info icon from 180, then "13 over" with an error icon. Over the limit: `aria-invalid`, the message "Note can be at most 200 characters (13 over).", and Publish is `aria-disabled` with its reason in the footer. The hint ("Shown in the version history with your name. Never put typed values or case details in it.") makes no claim about the audit log: `configPublished` has no note key today (open question 7).
- **Rollback.** A confirmation with no note field; the history line is written by the system from `rollbackOf` ("Rolled back to version 6").

## Purged results and values

Retention purges the payload first, then the values. A purged result is a dashed card headed "State system: returned" with the line "Purged under retention" and a one-sentence note; no severity badge, no mapped elements, no generic dump, no Show detail, and it never reaches the mapper or the highlighter. A request whose values are purged keeps its type values (role `type`, such as the property type) and shows "Other values purged under retention" beside them. Edit as new query on a request with purged values is disabled (dashed edge, muted text, focusable) with its reason in text. The dashed edge and the words carry the state; color only reinforces it. The officer frame uses the touch density (16 px reason text in body color, 48 px targets).

## Terminal pane (`layout.terminal: "pane"`)

- **Layout.** At 1366: the form in the 480 px panel, the results in the middle (they keep width priority: 566 px), the terminal on the right (320 px). The pane is a complementary region named Terminal: a Command input, the error list ("Command problems", text "Unrecognized command VAX.", the existing locale strings), the command reference. The polite announcement says "Unrecognized command" without the typed text. The panel's Form and Terminal toggle is hidden in pane mode; "Edit as command" becomes "Edit in terminal pane" and moves focus to the pane's input. One shared draft (spec 6.7).
- **Narrow.** The pane needs 1280 px. Below that the toggle returns and the draft is kept; the preference control says so ("Beside results needs a window 1280 px wide or more."). The mockup frame at 1024 shows the fallback. This is a new layout constant, `layout.terminalPane` (1280 px), proposed in the same way as `layout.toolbarRow`: documented in the visual system, written literally in `shell.css`, accepted by `shell.css.test.ts`.
- **Preference.** The account menu gets "Terminal: In the panel | Beside results" under Theme. It saves with `PUT /api/v1/me/preferences` (`layout.terminal`); unset stays `null`. A failed save reverts the control and shows an alert in the menu ("Could not save the layout. It stays on In the panel.").

## Builder rulings from #698 (applied to the v5 builder tabs)

Developer 10-18-26 (comment on #698): `layout.toolbarRow` = 920 px; only the selected type expanded in the Result cards tree; the default answer reads "<Type> default response" (for example "Vehicle default response") in Try a match and the card preview, "Scenario n of <Type>" unchanged. The mockup's builder tabs now match. Differences from the mockup that the manager accepted as the app's: tree type rows keep their +/- toggles; card rows read "1. All results"; the order arrows are text glyphs; the "Which card wins" hint keeps the app's wording; the "This card" chip stays a chip.

## Open questions, ruled 10-18-26 (all as recommended)

1. **Rail group.** Audit log under a new "Oversight" group (this design) or under People?
2. **Terminal pane width.** A new `layout.terminalPane` = 1280 px, with the toggle below it (this design), or no constant and the pane at any width that fits?
3. **Table fold.** Reuse the 920 px of `layout.toolbarRow` for folding Credential owner under Actor at 1024, or give the audit table its own constant?
4. **Edit as new on a purged request.** Disabled with a reason (this design), or prefill the kept type values only?
5. **Rollback note.** A rollback has no note field and the server writes "Rolled back to version N"; is that the wording?
6. **Note field.** A wrapping text area with control characters turned into spaces (this design) rather than a one-line input?
7. **Audit of the note (Track A).** The v4 and v5 publish dialogs say the audit log records the change note, but `configPublished` has no note key. Add one (`PublishNoteSchema`, an additive details change), or drop that sentence from the existing dialogs?
8. **Client address in the disclosure.** `loginSucceeded` stores `sessionId` and `clientIp`. Show them to an admin as stored (this mockup), or mask the last part of the address (GDPR)?

## Rulings

Developer 10-18-26, via the M2 manager ("i'll take your recs"), on the eight open questions of `docs/design/2026-10-18-audit-console.md`; mockup v6 approved the same day (the developer also likes the terminal pane).

- **D-M2P2-B1.** Audit log sits under a new "Oversight" rail group below People (admin only, `features.adminAudit` on).
- **D-M2P2-B2.** New layout constant `layout.terminalPane` = 1280 px: the terminal pane shows from that width, below it the Form and Terminal toggle returns and the draft is kept. Documented in the visual system and written literally in `shell.css` with the `shell.css.test.ts` rule, as `layout.toolbarRow` was (BW4).
- **D-M2P2-B3.** The audit table folds Credential owner under Actor below an admin section width of 920 px (1024 viewport), reusing the value of `layout.toolbarRow`; no new constant.
- **D-M2P2-B4.** Edit as new query on a request with purged values is disabled (`aria-disabled`, focusable) with the reason in text; no partial prefill.
- **D-M2P2-B5.** A rollback has no note field; the system writes "Rolled back to version N" (from `rollbackOf`), shown with a Rollback tag apart from typed notes.
- **D-M2P2-B6.** The publish note is a wrapping text area; control characters (Enter, tab, pasted line breaks) become spaces as typed; the count follows zod (UTF-16 units).
- **D-M2P2-B7.** `configPublished` gets no note key (frozen critical audit contract). BW3 drops the sentence "The audit log records ... your note" from the existing publish dialogs (v4, v5 builder, mock responses) and uses the history-only hint.
- **D-M2P2-B8.** `loginSucceeded` `clientIp` and `sessionId` show to admins as stored in the audit details disclosure (admin only; every view is audited by `auditViewed`; CJIS investigation need).
