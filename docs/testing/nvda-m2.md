# NVDA with Chrome: M2 exit script

The manual screen-reader pass for the M2 exit (spec 10.6, spec 12.7 M2 row, master plan 4.6). It is
the plan's Track B Task 10 ([#811](https://github.com/BirchDesignLab/queryModule/issues/811)). This
page is the script (Step 10.1). The agent pass with the speech viewer log (Step 10.2) and the
developer's listen (Step 10.3) fill in the results tables. The results are then summarized in
[docs/releases/m2.md](../releases/m2.md).

IDs: FR-043, FR-044, FR-055, FR-064, FR-065, UX-001, NFR-001. Spec 6.6, 6.7, 10.4, 10.6. Rulings
D-M2P3-B6, D-M2P3-B7, D-M2P3-B8 and the history drawer focus ruling
([Track B plan, Rulings](../superpowers/plans/2026-10-19-m2-track-b-p3.md#rulings)). Mock data only
(spec 5.4): every value below comes from the shipped mock scenarios in [demo.md](../demo.md).

The expected speech is taken from `packages/config/locales/en.json` and the components on `main` at
`c5c2ce6`. Quoted text is what the page gives the screen reader. NVDA adds role and state words of
its own ("button", "edit", "expanded", "heading level 2"), and their wording and order can differ
between NVDA versions. A step passes when the quoted words are spoken once, in the place and order
given, with nothing typed by the user and no payload value beyond the ones named. Role words alone
never fail a step.

## Setup

| Item | Value |
|---|---|
| NVDA | TODO(version, filled in when NVDA is installed) |
| Chrome | 155 (Windows 11) |
| NVDA settings | Speech viewer on (Tools, Speech viewer). Default synthesizer and voice. Browse mode on page load. Punctuation level "some". |
| Speech log | For the agent pass: the speech viewer text saved to a file after each flow, read back against this page. |
| Site | A local production build (`E2E_PORT=3100 pnpm e2e` builds and serves one; or `pnpm dev`), or the demo site https://querymodule.birchdesignlab.com. Note which one in each results table. |
| Accounts | From [demo.md](../demo.md): a dispatcher account for flows 1 to 8 and 11, `admin@example.test` for flows 9 and 10. Never write a password into this page or a results table. |
| Window | 1366x768 or wider (flow 7 needs at least 1280 px for the terminal pane). |
| Theme | Any. The pass is about speech, not color. |

Two live regions exist from the first render (spec 6.6): one polite (`role="status"`) and one
assertive (`role="alert"`). Everything below marked **polite** or **assertive** comes from them,
unless the step names another region.

Keys: NVDA+Space toggles browse and focus mode. Tab and Shift+Tab move between controls. The form
and the terminal are used in focus mode.

## Flow 1: Sign in

1. Load the sign-in page. Expected: the page title and the heading "Sign in". Tab to "Email, edit"
   and then to "Password, edit", then to the "Sign in" button.
2. Submit with both fields empty. Expected **polite**: "2 fields need attention". Focus moves to
   the first field with an error, and its error text is read as its description.
3. Submit a wrong password for the dispatcher account. Expected **polite**: "Sign-in failed. Check
   your email and password." The password itself is never spoken back.
4. Sign in with the right password. Expected: the query screen loads. The account menu button reads
   the signed-in email, collapsed. No live region repeats the email.

| Step | Result (pass, or issue with #) | Note |
|---|---|---|
| 1.1 | | |
| 1.2 | | |
| 1.3 | | |
| 1.4 | | |

## Flow 2: A1 plate query, keyboard only

Story A1. The vehicle form, without the terminal.

1. Pick the vehicle query type by keyboard (quick access). Expected: the form fields read with their
   labels: "Plate", "State" (value "Texas"), "Year", "VIN".
2. Type `ZZ-0010` into Plate and `26` into Year. Expected: each keystroke echoes as NVDA's own
   typing echo only. No live region speaks while typing.
3. Change State away from Texas. Expected **polite**, once, both reveals in field order: "Plate type
   is now shown and required. Plate color is now shown." Put State back to Texas.
4. Press Enter. Expected **polite**: "Vehicle query sent at <time>. Reference <8 characters>."
   (`submit.acknowledged`). Focus stays in the form.
5. Wait for the sources. Expected **polite**, once, coalesced: "Vehicle ZZ-0010: 2 of 2 sources
   done. 2 returned." Not one announcement per source.
6. Type `ZZ-0010` into Plate again (the form cleared after step 4), set State to Oklahoma, leave
   Plate type empty, and press Enter. Expected **polite**: "1 field
   needs attention." Focus moves to Plate type, and its error is read as its description.

| Step | Result | Note |
|---|---|---|
| 2.1 | | |
| 2.2 | | |
| 2.3 | | |
| 2.4 | | |
| 2.5 | | |
| 2.6 | | |

## Flow 3: A4 terminal command and an unrecognized command

Story A4. The terminal in the panel (the account menu's Terminal setting on "In the panel").

1. Press `/` to open the terminal. Expected: focus on "Command, edit", with the description "Type a
   command such as <example>, then press Enter."
2. Type `VEH.ABC123..26` and press Enter. Expected **polite**: "Vehicle query sent at <time>.
   Reference <8 characters>." Focus stays in the terminal.
3. Wait. Expected **polite**, once: "Vehicle ABC123: 2 of 2 sources done. 2 returned, info: NO
   RECORD." (spec 6.6 coalescing; the highest severity and its keyword come last).
4. Type `XYZ.123` and press Enter. Expected **polite**: "1 problem with the command." The input
   reads as invalid, and its description reads "Unrecognized command XYZ." Focus stays in the
   input, and the text is kept.
5. Type `XYZ` (an unknown command with no delimiter) and press Enter. Expected **polite**: "1
   problem with the command." The description reads "Separate the command and its values with .."
   (the shipped delimiter is "."; at punctuation level "some" NVDA may not speak it: record what it
   says).

| Step | Result | Note |
|---|---|---|
| 3.1 | | |
| 3.2 | | |
| 3.3 | | |
| 3.4 | | |
| 3.5 | | |

## Flow 4: A6 acknowledgment and correlation ID

Story A6. There is no toast: since M2 P1 (#675) the request entry carries "Acknowledged" and the
acknowledgment is announced.

1. Run `VEH.ZZ-0010..26`. Expected **polite**: "Vehicle query sent at <time>. Reference <8
   characters>." Once, before any source status.
2. In browse mode, move to the request list. Expected: the heading "Requests this shift", then the
   newest entry first, named "Vehicle ZZ-0010", with "Acknowledged", "Sent <time>" and "Reference
   <8 characters>".
3. Tab to the entry's copy control. Expected: "Copy reference <8 characters> for Vehicle ZZ-0010,
   button". Press it. Expected **polite**: "Reference copied."
4. Run the same command twice quickly. Expected: two acknowledgments, each with its own reference.
   No status sentence is attributed to the wrong reference.
5. Focus a request row, then run another query from the terminal (`/`, `VEH.ABC123..26`, Enter, then
   Shift+Tab back to the row). Expected: the row keeps its place and is read the same; a new entry
   arriving or a status changing never moves focus and never remounts the focused row (spec 6.6).

| Step | Result | Note |
|---|---|---|
| 4.1 | | |
| 4.2 | | |
| 4.3 | | |
| 4.4 | | |
| 4.5 | | |

## Flow 5: A7 STOLEN, critical announced once in words

Story A7. `VEH.ZZ-0001..26` returns STOLEN from both sources (demo story 1).

1. Run `VEH.ZZ-0001..26`. Expected **polite**: the acknowledgment as in flow 4.
2. As the first source's answer lands. Expected **assertive**, at once and not held by the
   1500 ms window: "Vehicle ZZ-0001: critical: STOLEN, State system." (`sourceStatus.criticalNow`).
   Then a second assertive line, "Vehicle ZZ-0001: critical: STOLEN, National system.", in arrival
   order. Neither line repeats, and no other payload value is spoken.
3. Then **polite**, once: "Vehicle ZZ-0001: 2 of 2 sources done. 2 returned, critical: STOLEN."
4. Focus did not move during steps 2 and 3. Check that it is still where it was.
5. In browse mode, read the card. Expected: the badge "Critical" (its marker is hidden from speech),
   then the summary. The keyword reads "STOLEN (critical)": the `!!` marker is not spoken.
6. The source line under the card. Expected: "State system: returned" read as one run of words,
   even though the name is set in bold (BW3b carry: the line spans two text nodes).

| Step | Result | Note |
|---|---|---|
| 5.1 | | |
| 5.2 | | |
| 5.3 | | |
| 5.4 | | |
| 5.5 | | |
| 5.6 | | |

## Flow 6: A8 summary, detail toggle and a table

Story A8. `WNT.WANTED` (demo story 4) has a warrants table in its detail. `DL.ZZDLTEST` (story 5)
shows a mapped card.

1. Run `WNT.WANTED`. A wanted check asks the National system only, and it is named by its short
   reference. Expected **assertive**: "Wanted check <8 characters>: critical: WANTED, National
   system." Then **polite**, once: "Wanted check <8 characters>: 1 of 1 source done. 1 returned,
   critical: WANTED."
2. Tab to the card's toggle. Expected: "Show detail <n> more items for National system, Wanted
   check <8 characters>, button, collapsed". Press it. Expected: "Hide detail <n> more items ...",
   expanded. Focus stays on the button.
3. Move into the detail in browse mode. Expected: the region "Warrants 1 row" (its caption with the
   hidden row count), then the column headers "Offense" and "Issued". Table navigation
   (Ctrl+Alt+arrows) reads the header with each cell.
4. Run `DL.ZZDLTEST`. Expected **polite**: "Driver's license <8 characters>: 2 of 2 sources done.
   2 returned, info: NO RECORD." (a driver's license is named by its short reference; with no last
   name the also-run wanted check is skipped and not counted). In browse mode the card reads its
   heading and its labeled rows.
5. Run `VEH.ZZ-0001` (no year). Expected: the assertive STOLEN line from the State system first,
   then **polite**: "Vehicle ZZ-0001: 1 of 1 source done. 1 returned, critical: STOLEN. 1 not run."
   The source line reads "National system: not run (plate only)".

| Step | Result | Note |
|---|---|---|
| 6.1 | | |
| 6.2 | | |
| 6.3 | | |
| 6.4 | | |
| 6.5 | | |

## Flow 7: The terminal pane

Account menu, Terminal: "Beside results". Needs a window at least 1280 px wide.

1. Open the account menu. Expected: the group "Terminal" (shown in capitals by CSS only) with the
   buttons "In the panel" and "Beside results", the current one pressed, each described by "Beside
   results needs a window 1280 px wide or more." Pick "Beside results".
2. Focus the pane's command input. Expected: "Command, edit" with its description. Type
   `VEH.ZZ-0010..26` and press Enter. Expected: the same acknowledgment and status sentences as
   flow 2.
3. Type `XYZ.123` and press Enter. Expected **polite**: "Unrecognized command", without the code
   (D-M2P3-B8). The description of the input still reads "Unrecognized command XYZ.".
4. Tab to the reference. Expected: the region "Command reference", reachable by Tab, holding the
   table "Commands" with the columns "Command" and "Positions" (headers hidden visually, read by
   NVDA).
5. A typing check while a result arrives (D-M2P3-B7): run `VEH.TIMEOUT..26`, then start typing a new
   command at once. Expected: no live region speech per keystroke. **Polite**, once: "Vehicle
   TIMEOUT: 1 of 2 sources done. 1 returned, 1 pending, info: NO RECORD." About 10 seconds later,
   once: "Vehicle TIMEOUT: 2 of 2 sources done. 1 returned, 1 timed out, info: NO RECORD." Focus and
   the typed text are kept.

| Step | Result | Note |
|---|---|---|
| 7.1 | | |
| 7.2 | | |
| 7.3 | | |
| 7.4 | | |
| 7.5 | | |

## Flow 8: Offline and back online

Spec 10.4. Take the network away (unplug, or Chrome DevTools Network "Offline" in a second window
that does not take focus from the page).

1. Go offline. Expected **polite**, once: "No connection to server". No typed value is spoken.
2. Tab to the submit button. Expected: "Run query, button, unavailable", with the description "No
   connection to server".
3. Press Enter in the form, then in the terminal. Expected **polite**: "No connection to server".
   Nothing is sent, and the typed text stays.
4. Go back online. Expected **polite**, once: "Connection restored".
5. Run `VEH.TIMEOUT..26` and go offline within 10 seconds (repeating steps 1 and 4). Back online,
   expected **polite**, once, within a few seconds: "Vehicle TIMEOUT: 2 of 2 sources done. 1
   returned, 1 timed out, info: NO RECORD."

| Step | Result | Note |
|---|---|---|
| 8.1 | | |
| 8.2 | | |
| 8.3 | | |
| 8.4 | | |
| 8.5 | | |

## Flow 9: History drawer and publish with a note (admin)

Sign in as `admin@example.test` and open Site configuration.

1. Make one small label change in the builder. Expected: the toolbar's unpublished count is
   readable in browse mode.
2. Open "Review and publish". Expected: the dialog reads its title "Publish version <n>", then "Open
   dispatcher and officer screens pick this up within 15 seconds. Their typed values are kept.",
   then the section "What changes" holding the changes as a bulleted list. (With nothing to publish
   the title is "Review and publish" and the body "There is nothing to publish: the draft matches
   the live version.")
3. Tab to "Change note (optional), edit". Expected description: "Shown in the version history with
   your name. Never put typed values or case details in it." Type a short note. Expected: no live
   region speech per keystroke. Near the limit, **polite** "<n> left". Over the limit, **polite**
   "Note can be at most 200 characters (<n> over)."
4. Press "Publish version <n>". Expected **polite**: "Published version <n>. Dispatchers see it
   within 15 seconds." Focus returns to a sensible control and is not lost to the page body.
5. Open the version history. Expected: focus on the heading "Version history" (level 3). The region
   "Versions", each item with "Version <n>", "Live" or "Previous", "Published by <name>" and the note or "No
   note".
6. Tab out of the drawer to the page. Expected: the drawer closes, and the focused control is never
   hidden behind it (history drawer focus ruling). Opening "Roll back to version <n>" from the
   drawer keeps the drawer open behind the dialog.
7. Roll back to the version before. Expected **polite**: "Published version <n> (roll back of
   version <m>). Dispatchers see it within 15 seconds."
8. With a dispatcher tab open in a second window, the label-only publish of step 4 reaches it within
   one poll. Expected there: no announcement at all (a label-only publish never announces "The form
   was updated by your administrator."), focus and typed values kept, the new label read on the
   next visit to the field.

| Step | Result | Note |
|---|---|---|
| 9.1 | | |
| 9.2 | | |
| 9.3 | | |
| 9.4 | | |
| 9.5 | | |
| 9.6 | | |
| 9.7 | | |
| 9.8 | | |

## Flow 10: Audit log and request view (admin)

1. Open "Audit log". Expected: the heading "Audit log", "Admin only", and "Viewing and exporting
   the audit log is recorded." When the rows load, **polite** "<n> rows loaded."
2. The filters region "Audit filters": "User", "Request ID", "Event", "From", "To", each with its
   hint read as a description. "From" and "To" both read the window hint "Times are local,
   MM-DD-YY HH:mm. The window defaults to the last 24 hours and can span at most 31 days."
3. Type a bad Request ID and "Apply filters". Expected **polite**: "1 filter needs attention. Enter
   a request ID like 0192f3a1-7c2e-7b10-9a4c-5d3e8f1a2b4c." Focus moves to the field. What was typed
   is not spoken back by the announcement.
4. Fix it, apply, and read the table. Expected: the caption "Audit events, newest first, <from> to
   <to>", then the columns "Time", "Event", "Actor", "Request", "Credential owner", "Details".
5. Paging: the "Audit pages" navigation with "Newer" and "Older". On the newest page, "This is the
   newest page." Press "Older". Expected **polite**: "<n> rows loaded."
6. "Export NDJSON". Expected: the description "Exports every row for: <summary>. One JSON object per
   line." After the download, the notice "Export saved." (a status paragraph that appears with its
   text: record whether NVDA speaks it).
7. Open a request from a row (", open this request"). Expected **polite**: "Request <reference>
   loaded." ("Loading request." may come first, from its own status line.) Then in browse mode the
   banner (a note) "This view is recorded in the audit log.", "Your name, the request ID and the
   time are saved as one entry each time you open it." and "Your filters are kept.", the copy
   control "Copy ID <8 characters> for <summary>", the
   intro "<type> query as it was sent and answered. Read only.", "Include hidden results" off with
   "Hide arrives in M3.", and the link "Back to audit log".
8. The request view's source lines and cards read as in flows 5 and 6 (the shared renderer).

| Step | Result | Note |
|---|---|---|
| 10.1 | | |
| 10.2 | | |
| 10.3 | | |
| 10.4 | | |
| 10.5 | | |
| 10.6 | | |
| 10.7 | | |
| 10.8 | | |

## Flow 11: Partial results and the timeout

Demo stories 7 and 8.

1. Run `VEH.FAIL1..26`. Expected **polite**, once: "Vehicle FAIL1: 2 of 2 sources done. 1 returned,
   1 failed, info: NO RECORD." The State system line reads "State system: failed" with "the source
   reported an error".
2. Run `VEH.TIMEOUT..26`. Expected **polite**: first "Vehicle TIMEOUT: 1 of 2 sources done. 1
   returned, 1 pending, info: NO RECORD.", then about 10 seconds later, once: "Vehicle TIMEOUT: 2 of
   2 sources done. 1 returned, 1 timed out, info: NO RECORD." The line reads "no answer in 10 s".

| Step | Result | Note |
|---|---|---|
| 11.1 | | |
| 11.2 | | |

## Coverage

| Requirement | Flows |
|---|---|
| Spec 6.6: polite acknowledgment, source status, timeouts, validation counts, rule-revealed fields, connection changes | 1, 2, 3, 4, 8, 10, 11 |
| Spec 6.6: assertive only for critical, never held by the window | 5, 6 |
| Spec 6.6: coalesced per correlation ID | 2, 3, 5, 11 |
| Spec 6.6: incoming events never move focus; the focused row is never remounted | 4, 5, 7, 8 |
| Spec 10.6 and D-M2P3-B7: typing while a result arrives | 2, 7 |
| D-M2P3-B8: the pane's unknown command | 7 |
| A1, A4, A6, A7, A8 screen states | 2, 3, 4, 5, 6 |
| A9 (audit), admin views | 10 |
| Label-only publish (CFG-1) | 9 |
| Offline (spec 10.4) | 8 |

Delegation changes (spec 6.6) are M3 and are not in this pass. The audible cue per severity (spec 6.6) is out of scope: `audibleCue` is false in the shipped sites.

## Findings

Findings from the passes go here with their issue numbers, and the summary goes to
[docs/releases/m2.md](../releases/m2.md).

| Date | Pass (agent or developer) | NVDA | Flows | Findings |
|---|---|---|---|---|
| | | | | |
