# Demo accounts

The live demo at https://querymodule.birchdesignlab.com uses these accounts. Passwords are derived from a secret held on the deploy host and are handed out on request; they are never committed.

| Username | Role |
|---|---|
| dispatcher@example.test | user |
| records@example.test | user |
| mobileunit@example.test | user (mobile-unit layout) |
| officer@example.test | trainingOfficer (mobile-unit layout) |
| admin@example.test | admin |
| implementer@example.test | implementer (site config only; its header has no Queries link) |
| smoke@example.test | user (smoke tests only) |

All data behind these accounts is mock data (spec 5.4 fixture policy). No real person, vehicle or property record exists in this system.

## Demo stories

Every story below is one command away on the default site, with mock data only (ZZ- plates, ZZ
serials, 1901 dates, synthetic names). Type the command in the terminal ("Terminal mode", or `/`
from outside a field), or fill the same values in the form. Each command was run end to end against
a local build with the mock sources, and the results below are what that run showed. The "State
system" and the "National system" are the two mock sources: both answer from canned files, and
neither is connected to a real system.

**Accounts.** The passwords are handed out on request.

| Account | Use it for |
|---|---|
| `dispatcher@example.test` | every story below; the dispatcher layout |
| `officer@example.test` | the same stories in the 48 px officer layout |
| `admin@example.test` | the publish that makes the config-changed story (story 9) |

**A plate on its own asks only the State system.** `VEH.ZZ-0001` shows the State card and the line
"National system: not run (plate only)". Add a year (`..26`) to ask both sources, as the commands
below do.

| # | Story | Command | What it shows |
|---|---|---|---|
| 1 | Record hit, critical | `VEH.ZZ-0001..26` | `STOLEN` on both sources: critical badge, `!!` mark, the request header badge |
| 2 | Record hit, calm | `VEH.ZZ-0010..26` | `REGISTERED`, plate `ZZ-0010`, remarks `REGISTRATION CURRENT` on both sources; no keyword, so no severity (until a keyword such as `TESTMAKE` is published: the make is in the detail rows) |
| 3 | No record | `VEH.ABC123..26` | `NO RECORD` on both sources, the info mark, nothing critical |
| 4 | Critical WANTED | `WNT.WANTED` | National system card, `WANTED`, critical; Show detail opens the warrants table |
| 5 | Driver's license ZZDLTEST | `DL.ZZDLTEST` | State card `VALID`, the license number in the summary; National system `NO RECORD` |
| 6 | Person record | `PER.EXAMPLESON.SAMPLE.01011901` | State card `RECORD FOUND` for EXAMPLESON, SAMPLE; National system `NO RECORD`; the "Wanted check, also run" card reads `NO WANTS OR WARRANTS` with the info mark and badge. `PER.TESTERSON.SAMPLE.01011901` is the no-record person |
| 7 | Partial result | `VEH.FAIL1..26` | State system `failed` with the reason "the source reported an error" (a status line, no card); National system `NO RECORD` |
| 8 | Slow source, then timeout | `VEH.TIMEOUT..26` | State card at once; "National system: pending" for about 10 seconds (the source deadline), then "timed out". The other source never waits for it. This is the wait story: the mock has no slow-but-returns scenario (that needs per-source-scenario latency in the mock contract), so the timeout is how the wait is shown |
| 9 | Config changed: Edit as new query | click path below | A "Failed" row, "The site configuration changed. Check the form and submit again.", and "Edit as new query" instead of Retry |

**After a run the form starts over; every row can bring its query back (G32).** Once a request is
acknowledged, the query type stays and the form returns to the site defaults (State is TX again,
every source is checked again) with the typed values gone, in the form and the command line alike, so
nothing from the last query rides into the next. A run that does not reach an acknowledgment (a
failure, a server 400) keeps what was typed. Every settled row, acknowledged or failed, offers "Edit
as new query": it loads that row's values into the form, moves focus to the first field, shows the
"Values loaded from the earlier request" line (read out, not shown) and names anything the current
configuration no longer has; nothing is sent. A row listed after a reload offers it once the request's
details arrive. Use it in the demo to re-run a query with one change, for example the same plate with
a year added. The form and the command line share one draft; switching between them is not what
clears it. A row listed after a reload, and a seeded row, rebuilds its command from the values the
server stored, where a two-digit year is kept in its four-digit form, so `VEH.ZZ-0001..26` reads
`VEH.ZZ-0001..2026` there; the same row read `..26` while it was fresh.

**A database that already ran keeps its published settings.** The site file only seeds an empty
store (version 1). A demo database that published a version before the four-digit birth and warrant
dates and the `NO WANTS OR WARRANTS` info keyword landed keeps the old two-digit dates and the plain
card until a version with the new settings is published (builder, or Roll back to a seeded one) or
the database is reset.

Stolen property is `PRO.ZZSTOLEN1.ELECTRONICS` (`STOLEN` on both sources) and a missing person is
`WNT.MISSING`; both are in "Example queries" below.

**Story 9, config changed (#477).** The open form follows a newer configuration within 15 seconds, so
the publish and the submit have to fall inside that window. **The publish changes the live site
configuration** for everyone on that site, so do it on a rehearsal site or put it back afterwards
(step 5).

1. Window A: sign in as `dispatcher@example.test`, choose the form, type plate `ZZ-0001` and leave
   the cursor in the field.
2. Window B (a private window or a second browser; a plain second window shares window A's session
   and would sign the dispatcher out): sign in as `admin@example.test`, open
   the builder, Keywords and severity, Add keyword `TESTMAKE`, Review and publish, and stop on the
   Publish button.
3. Press Publish in window B, go straight to window A and press Enter. Both have to happen within 15
   seconds; slower, window A has already picked up the new configuration and the query just runs.
4. The row reads "Failed" with the config-changed line and an "Edit as new query" button, no Retry.
   Press it: the plate comes back into the form, focus lands on it, and nothing is sent. If the
   publish had removed a field the form had a value for, a note under the form names what was not
   loaded.
5. Put the live configuration back: History, pick the version that was live before your publish and
   Roll back. That publishes the earlier version again as a new version (the history only grows), so
   the demo is back to a calm story 2. The failed row stays in the list.

**Rehearsal rows stay.** "Requests this shift" keeps every request an account has made, across
sign-ins; nothing in the app or the repository clears it, and there is no reset (by ruling). So a
rehearsal on `dispatcher@example.test` is still in that list on the day. Rehearse with another
account, for example `records@example.test` (also role `user`), or accept the rows. The demo
dispatcher's list should hold only what you want the audience to see: the seed below is how it gets
its history.

## Seed once

`scripts/dev/demo-seed.ts` fills the request list so the demo opens with history. It signs in as
`dispatcher@example.test` and submits stories 1 to 8 (and the stolen property), each once through
`POST /api/v1/queries`, so every row is a real, audited request. It never deletes, never resets and
never touches the database directly: it only signs in, reads the config, reads the list and submits.
The vehicle stories send the year `26`, as the story table's `..26` commands do, so both sources
run (a plate alone would ask only the State system). There is no reset: run it once against the demo database, then leave it.

**Which database it targets.** The one behind the base URL you pass as the argument, and nothing
else: the script has no database connection of its own. For the live demo that is
`https://querymodule.birchdesignlab.com`. To rehearse, start a local production build on a throwaway
data directory, the way `scripts/dev/smoke-local.ts` does: `pnpm --filter @querymodule/web build` and
`pnpm --filter @querymodule/api build`, then `node packages/api/dist/main.js` with `NODE_ENV=production`,
`PORT=3100`, `PUBLIC_ORIGIN=http://localhost:3100`, `DATA_DIR=<a new empty folder>`,
`SECRETS_DIR=.dev/secrets` (created by the first `pnpm dev` or `pnpm e2e`), `ALLOW_MOCK_SOURCES=true`, `SITE_CONFIG=packages/config/sites/default.json`,
`MIGRATIONS_DIR=packages/api/drizzle` and `WEB_DIST=apps/web/dist`. Run
`node packages/api/dist/ops/seed.js` once with the same variables for the demo users, run the seed
script with `http://localhost:3100`, and delete the folder when done. The sign-in sends the base URL as
its `Origin`, so it must be the address the server was started with as `PUBLIC_ORIGIN`.

```
DEMO_PASSWORD=<the dispatcher password> node scripts/dev/demo-seed.ts https://querymodule.birchdesignlab.com
```

**Another account (#679).** `DEMO_EMAIL` seeds a different demo account the same way, for example the
admin account a live demo is given from: `DEMO_EMAIL=admin@example.test DEMO_PASSWORD=<the admin
password> node scripts/dev/demo-seed.ts <baseUrl>`. Only `@example.test` accounts are accepted, and the
account's role must be allowed to query (user, trainingOfficer or admin; the implementer is refused by
the API). Idempotency keys are per user, so each account can be seeded once.

On a machine that can read the seed secret file, `SEED_PASSWORD_SECRET_FILE=<file>` replaces the
password variable (the password is derived for the chosen account as `scripts/ops/smoke.sh` derives
it). `DEMO_DISPATCHER_PASSWORD` still works in place of `DEMO_PASSWORD`. The password is read from the
environment, never from argv, and is never printed. The script needs Node 24 and the repository
checkout.

- It refuses when the account already has any request (exit code 3, nothing sent). The API only
  shows a user their own requests, so that is what it can see: it does not check other accounts.
- It waits up to 30 seconds for every source to settle (story 8 needs about 10) and says so when one
  is still pending. The requests are recorded either way.
- If it stops part-way (a rejected submit, a lost connection), the rows already recorded stay, and a
  second run refuses. Run the missing commands by hand from the table above.
- It submits 9 queries, well under the limit of 30 submits per user per minute (a rerun that gets
  past the guard would not hit it either).
- It ends with the critical `STOLEN` vehicle on top, because the list is newest first.

## Demo runbook

[docs/demo/m1-v1.md](demo/m1-v1.md) is the M1 v1 click path, kept as the record of what M1 showed:
one section per persona (dispatcher, officer, admin, implementer and the Status page). It predates
source answers, result cards and per-source status, so its "does not do yet" table and its phase
limits describe M1, not this demo, and it has not been re-checked against M2. For the M2 demo use
"Demo stories" above and the sections below. The config behind the demo is in
[docs/site-config.md](site-config.md) and the routes are in [docs/api.md](api.md).

## Dry run

`scripts/demo/dry-run.ts` rehearses this runbook before a live demo: it builds, serves the production
build with mock sources and demo users on `E2E_PORT` (default 3000), and walks the runbook by keyboard
only (Tab, arrows, Enter and the app's own shortcuts) as the dispatcher and the admin at 1366x768 and
1024x768, the officer at 1024x768 and the implementer at 1366x768. It writes screenshots, `report.json` and
`report.md` (steps that cannot be done by keyboard, waits over 2 s, console errors, failed requests) to
`DRY_RUN_OUT` (default `.superpowers/sdd/2026-10-14-demo-dry-run`, not committed):

```bash
E2E_PORT=3200 node scripts/demo/dry-run.ts
```

`DRY_RUN_SKIP_BUILD=1` reuses the last build, `DRY_RUN_ONLY=officer-1024` limits the walks and
`DRY_RUN_STEPS=<regex>` limits the steps. Keep other lanes off the same port.

## Submit, live source status and terminal

1. Sign in as `dispatcher@example.test`.
2. Pick Vehicle, type a plate (`ZZ-0001`) and a Year (`26`) and press Enter. The form sends
   `POST /api/v1/queries`. (A plate on its own asks only the State system; the Year makes it a full
   query that asks both.)
3. The row in "Requests this shift" reads "Acknowledged" with the send time and a short reference
   (the HTTP 202 and its correlation id; "Copy reference" copies the full id). There is no separate
   acknowledgment panel: the row is the visible record, and a screen reader hears "Vehicle query sent
   at ... Reference ..." once. Under it, one line per source the query asks reads "State
   system: pending" and "National system: pending".
4. Within a second or so each line settles on its own, as that source answers (the mock waits a
   random time in the source's `latencyMs` range). A source that has answered reads "loading
   result" until its card arrives, then the card takes the line's place (its heading says "State
   system: returned"). The calm tone is a returned source; anything else
   (failed, timed out, interrupted, credentials missing or rejected) reads as a problem and says why in words ("the source reported an error", "no answer in 10 s",
   "the server restarted before it answered"). The text
   carries the status, never the icon alone, and a screen reader hears a summary such as "Vehicle
   <last 8 characters of the reference>: 1 of 2 sources done. ..." after each change. The lines come over the WebSocket feed, so they
   update without a refresh.
5. Choose "Terminal mode", type `VEH.ZZ-0001..26` and press Enter: the same query, typed (the empty
   position is State, which keeps its default). `XYZ.1` shows "Unrecognized command XYZ." and sends
   nothing.
6. Use the table below for more queries; each runs from the form, and from the terminal unless its row says otherwise.

Each returned source then draws a result card inside the request (see "Result card scenarios"
below). The mock data behind it is canned and synthetic ([site-config.md](site-config.md) has the fixture policy). The deploy smoke script
(`scripts/ops/smoke.sh`, steps 3 and 4) runs a shorter path: it opens the feed, submits a plate-only
`VEH` `ZZ-0001` (step 3) and, in step 4, waits for one settled `sourceStatus` per source the 202
lists. A plate-only query lists the State system only (the National system is dropped), so that is
one source.

### Live status scenarios

Each scenario is a trigger in the default site's mock files (`packages/config/mock/default.json`,
generated by `scripts/mock-data/generate.ts`). Use the form or the terminal as in the tables below.

| Query (terminal) | What each source line does |
|---|---|
| `VEH.ZZ-0001..26` | both sources settle `returned` (the answer is `STOLEN`) |
| `VEH.ABC123..26` | both settle `returned` (`NO RECORD`); the clean run |
| `VEH.FAIL1..26` | State system settles `failed`, National system `returned` |
| `VEH.TIMEOUT..26` | National system stays `pending` until the source deadline (10 s by default), then `timed out`; State system `returned` |
| `PER.WANTED.SAMPLE.01011901` | part 0 on both sources `returned` (`NO RECORD`), then a "Wanted check, also run" part with National system `returned` (`WANTED`) |

The `..26` on the vehicle commands is a Year. A query with only a plate (`VEH.ZZ-0001`, or the form
with only a plate) asks the State system alone and shows "National system: not run (plate only)", so
`VEH.TIMEOUT` on its own never times out: the timeout is a National system scenario.

The timeout case is the one to show live: the other line has long settled while the slow source
keeps showing "pending", and one source never holds up another. If the server restarts while a
line is pending, the startup sweep marks that row `interrupted` in the database and the audit log
(nothing is re-run). The feed replays it when the browser reconnects, so the line reads
"interrupted" without a reload.

## Example queries

Each example from the requirements ("Use Case Examples" and the Person, Vehicle, Property and Terminal scenarios) runs from the form, and from the terminal except the two rows that say otherwise (the out-of-state plate and FIREARM). A submit shows the 202 acknowledgment, the live per-source status above and the result cards below. The default site uses `.` as the terminal delimiter; example-ok uses `/`.

| Example | Form (default site) | Terminal (default site) | What to show |
|---|---|---|---|
| Vehicle by plate | VEH: Plate `ZZ-0001`, State stays TX | `VEH.ZZ-0001` | the plate-only form; Enter submits; only the State system is asked ("National system: not run (plate only)"); add a Year (`VEH.ZZ-0001..26`) to ask both |
| Vehicle, out-of-state plate | VEH: Plate `ZZ-0001`, State `Oklahoma`, then Plate type (required; for example Passenger car) | not in the terminal | Plate type appears and is required; the site's custom Plate color appears under More details. The form runs and both sources answer `STOLEN`. `VEH.ZZ-0001.OK` is refused with "Plate type is required." because the terminal has no Plate type position (the builder warns about the same) |
| VIN lookup | VEH: VIN only | `VEH....ZZZZZZZZZZZZZZZZ0` | a VIN-only vehicle query |
| Person, standard | PER: Last `TESTERSON`, First `SAMPLE`, DOB `01011901` | `PER.TESTERSON.SAMPLE.01011901` | State defaults to TX; State `OK` makes DOB required |
| Person, ad hoc | as above | `NAM.TESTERSON.SAMPLE.01011901` | `NAM` is typed-only: the mode toggle produces `PER`, never `NAM` |
| Driver's license plus wanted check | DL: License number `ZZDLTEST` | `DL.ZZDLTEST` | a license number, or a name plus DOB, is required; with a name the wanted check (WNT) runs too; `ZZDLTEST` is the one synthetic record the state source returns |
| Wanted person | WNT: Last `WANTED` | `WNT.WANTED` | the high-priority quick query |
| Missing person | WNT: Last `MISSING` | `WNT.MISSING` | the `MISSING` keyword is critical (critical badge and mark) |
| Property, standard | PRO: Serial `ZZ123`, Type `FIREARM`, then Make and Caliber (any text) | `PRO.ZZ123.ELECTRONICS` | FIREARM requires Make and Caliber and the terminal has no position for them, so `PRO.ZZ123.FIREARM` is refused with "Make is required. Caliber is required." and FIREARM runs from the form only; the terminal command that runs is the ELECTRONICS one (no extra required field); ARTICLE requires Description; Agency has a site default |
| Property, multi-source | as above | `PROP.ELECTRONICS.ZZ123` | `PROP` is typed-only: the mode toggle produces `PRO`, never `PROP`, and the row is listed as `PRO.ZZ123.ELECTRONICS`; State defaults. `PROP.FIREARM.ZZ123` is refused the same way as the FIREARM command above |
| Stolen property | PRO: Serial `ZZSTOLEN1`, Type `ELECTRONICS` | `PRO.ZZSTOLEN1.ELECTRONICS` | `STOLEN` marked critical on both sources; the description reads `SAMPLE ELECTRONICS` |

## Result card scenarios

Sign in as `dispatcher@example.test`, submit each query from the form or the terminal and read the
card in the request entry. Cards are collapsed to the summary; Show detail opens the detail rows
(Enter on a selected card toggles it; the Up and Down arrows select the previous or next card).
Everything here is synthetic.

| Query | What the request shows |
|---|---|
| `VEH.ZZ-0001..26` | Both sources return (`VEH.ZZ-0001` alone shows the State card only). Each card has a critical badge and a `!!` mark on `STOLEN` (the plate renders plain); the request header carries the critical badge; a critical result is announced at once. Show detail on the State system card for make, model, year, VIN and the owner. |
| `VEH.ABC123..26` | A clean no-record: `NO RECORD` with the info mark and badge on each card. No critical result, nothing announced as critical. |
| `WNT.WANTED` | National system card, critical on `WANTED`. Show detail opens the date of birth (`01-01-1901`) and a warrants table (offense, issued) in its own scroll box. |
| `PER.WANTED.SAMPLE.01011901` | The Person card plus an also-run "Wanted check" card, critical on `WANTED`. |
| `WNT.MISSING` | `MISSING PERSON`, critical. |
| `PRO.ZZSTOLEN1.ELECTRONICS` | Both sources return `STOLEN` (remarks `STOLEN PROPERTY`, description `SAMPLE ELECTRONICS`), critical. |
| `DL.ZZDLTEST` | State system card, `VALID`, the license number in the summary, name, date of birth and state in the detail. National system: no record. |
| `VEH.FAIL1..26` and `VEH.TIMEOUT..26` | A status line for the failed or timed-out source, with the reason ("State system: failed, the source reported an error", "National system: timed out, no answer in 10 s"), never a card; the other source's card shows. |

**Generic dump.** A result with no card shows every field under its path, with the note "No card is
set up for this result, so every field shows under its path." To show it, remove a card in the
builder (for example the `dl-summary` card), preview it, publish, and submit `DL.ZZDLTEST` again;
rolling back restores the card. The open request redraws with the new settings at the next config
refresh.

**Reconnect and reload.** Submit a query, reload the page: the request entry returns with its command
(rebuilt from the values the server planned, so it can read slightly fuller than what you typed, for
example with the default state) and its cards (the list route, then the detail route per returned
source). A Retry pressed while the connection is marked down asks the server at once: if it
answers, that one press sends the request (no second Enter, no wait for the "Connection restored"
poll). If it does not answer, or a submit is in flight, nothing is sent and the failed row says "No
connection to server" or "Submitting" until the gate lifts. An acknowledged Retry starts the form
over like any acknowledged run, unless you have typed something else meanwhile. Stop and restart the API during a
dispatch: the source line settles to `interrupted` and the page shows it after it reconnects.

### Builder: cards, keywords and Try a match

Sign in as `admin@example.test` or `implementer@example.test`, open the admin console and the
builder. (The implementer's rail has no "Back to queries": that account cannot query.) Two skip
buttons ahead of the panes, "Skip to editor" and "Skip to preview", move keyboard focus past the tree
in one step. Between 1024 and 1279 px wide the tree sits on the left and the editor and the card
preview share the column beside it, so the preview stays in view.

1. **Move a row to the summary.** Result cards, Vehicle, "All results" card: edit the Make row
   (`vehicle.make`) and set Show in to "Summary". The card preview opens on the first scenario that
   answers with a record, "Scenario 1" (the plate `ZZ-0001`): it says "Returns a record" and
   "Scenario 1 matches" and shows the card with Make in the summary at once, as dispatchers will see
   it. The Scenario list picks another answer, "Default answer" among them. The Dispatcher and
   Officer buttons above the preview switch the layout.
2. **Add a keyword.** Keywords and severity: Add keyword `TESTMAKE`, severity Warning. The sample
   line marks it; the contrast under each severity style shows per theme.
3. **Which card wins.** Add a second Vehicle card with Source "National system": the table now shows
   it winning for the national source ("score 2, source +2") and the first card for the rest.
4. **Try a match.** Mock responses, State source, Vehicle: type plate `ZZ-0001`; the pane says
   "Returns a record" and "Scenario 1 matches" and shows the result card as dispatchers would see
   it. The Payload button switches to the payload as read-only JSON and Result card switches back.
   Type `ABC123`: it says "NO RECORD" and "Scenario 2 matches". A plate that matches nothing (for
   example `NOPE`) says "No scenario matches, so the default answers".
5. **Review and publish.** The dialog lists the changes as plain sentences, never payload
   content: "Make moves to the summary.", "Keyword TESTMAKE added with warning severity." and
   "Vehicle card added, with 1 row." under the new card (the count is the card's rows); the setting
   keys sit in a small line under each. Publish (the dialog stays open, "Publishing", until the
   draft has reloaded; the toolbar then reads "No unpublished changes" under "Published version
   2"), then submit `VEH.ZZ-0001` in a dispatcher tab that was already open: Make
   is in the summary with a warning mark on `TESTMAKE`, and cards already on screen redraw at the
   next config refresh. History, Roll back restores the old card.

### Site variations (example-ok)

example-ok extends the default site and changes behavior through config only (spec 7 overlay):

| Variation | How to see it |
|---|---|
| Terminal delimiter `/` | `NAM.` is refused with a missing-delimiter error; use `NAM/...` |
| `NAM` in the terminal order last, first, race, sex, DOB | `NAM/TESTERSON/SAMPLE/W/M/01011901` fills race `W`, sex `M` |
| Plate color required off the default state (OK) | VEH with State `TX`: Plate type and Plate color are both required |
| Narrowed property types | the Type picklist has no BOAT |
| Custom field | VEH shows Tag sticker under More details |

An overlay replaces a query type's whole `rules` list, so example-ok restates the VEH rules it keeps before adding its own.

## Recovery

`scripts/ops/seed.ts` runs once against an empty database and refuses on every later run
(`SeedRefusedError`, spec 8.5), even a run that only partly completed. If a seed run fails
part-way (for example a transient database error while granting a role), it does not leave the
database silently seedable again:

- The failed run prints the same `email\trole\tpassword` table, for only the demo users whose row
  was actually created, to its own stdout before exiting non-zero (never to the service log).
  Save that output; it is the only place those passwords are shown.
- A user in that table exists and can sign in, but may still need its role. Use
  `scripts/ops/grant-role.ts <email> <role>` to finish any role grant the failed run did not reach
  (`admin@example.test admin`, `officer@example.test trainingOfficer` or
  `implementer@example.test implementer`).
- The officer accounts also get a stored `mobileUnit` persona. If the run stopped before that, the
  account works with the device layout until the demo database is reset and seeded again.
- To seed the remaining demo users, either grant their roles by hand the same way, or reset the
  demo database (drop and recreate it, or restore from a pre-seed snapshot) and rerun
  `scripts/ops/seed.js` from empty.
