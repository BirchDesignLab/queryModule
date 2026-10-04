# Demo accounts

The live demo at https://querymodule.birchdesignlab.com uses these accounts. Passwords are derived from a secret held on the deploy host and are handed out on request; they are never committed.

| Username | Role |
|---|---|
| dispatcher@example.test | user |
| records@example.test | user |
| mobileunit@example.test | user (mobile-unit layout) |
| officer@example.test | trainingOfficer (mobile-unit layout) |
| admin@example.test | admin |
| implementer@example.test | implementer (site config only) |
| smoke@example.test | user (smoke tests only) |

All data behind these accounts is mock data (spec 5.4 fixture policy). No real person, vehicle or property record exists in this system.

## Demo runbook

[docs/demo/m1-v1.md](demo/m1-v1.md) is the M1 v1 click path, one section per persona: dispatcher,
officer, admin (builder, publish, history and roll back, users and roles, the forced password
change), implementer and the Status page, with what each step shows and what M1 does not do yet.
The config behind it is in [docs/site-config.md](site-config.md) and the routes are in
[docs/api.md](api.md).

## Submit and terminal, as far as M1 goes

1. Sign in as `dispatcher@example.test`.
2. Pick Vehicle, type a plate (`ZZ-0001`) and press Enter. The form sends `POST /api/v1/queries`.
3. The row in "Requests this shift" reads "Acknowledged" with the send time and a short reference.
   That is the end of a submit in M1 (the HTTP 202 and its correlation id); no source answers
   until dispatch lands (M2 P0.5, ADR-0012).
4. Choose "Terminal mode", type `VEH.ZZ-0001` and press Enter: the same query, typed. `XYZ.1` shows
   "Unrecognized command XYZ." and sends nothing.
5. Use the table below for more queries, each of which runs from the form and from the terminal.

## Example queries

Each example from the requirements ("Use Case Examples" and the Person, Vehicle, Property and Terminal scenarios) runs from the form and from the terminal. In M1 a submit ends at the acknowledgment (202); source answers arrive once dispatch lands (M2 P0.5). The default site uses `.` as the terminal delimiter; example-ok uses `/`.

| Example | Form (default site) | Terminal (default site) | What to show |
|---|---|---|---|
| Vehicle by plate | VEH: Plate `ZZ-0001`, State stays TX | `VEH.ZZ-0001` | the plate-only form; Enter submits |
| Vehicle, out-of-state plate | VEH: State `OK` | `VEH.ZZ-0001.OK` | Plate type appears and is required; the site's custom Plate color appears under More details |
| VIN lookup | VEH: VIN only | `VEH....ZZZZZZZZZZZZZZZZ0` | a VIN-only vehicle query |
| Person, standard | PER: Last `TESTERSON`, First `SAMPLE`, DOB `01011901` | `PER.TESTERSON.SAMPLE.01011901` | State defaults to TX; State `OK` makes DOB required |
| Person, ad hoc | as above | `NAM.TESTERSON.SAMPLE.01011901` | `NAM` is typed-only: the mode toggle produces `PER`, never `NAM` |
| Driver's license plus wanted check | DL: License number `ZZ1234567` | `DL.ZZ1234567` | a license number, or a name plus DOB, is required; with a name the wanted check (WNT) runs too |
| Wanted person | WNT: Last `WANTED` | `WNT.WANTED` | the high-priority quick query |
| Missing person | WNT: Last `MISSING` | `WNT.MISSING` | the `MISSING` keyword is critical once results arrive |
| Property, standard | PRO: Serial `ZZ123`, Type `FIREARM` | `PRO.ZZ123.FIREARM` | FIREARM requires Make and Caliber (the terminal leaves them to the form); ARTICLE requires Description; Agency has a site default |
| Property, multi-source | as above | `PROP.FIREARM.ZZ123` | `PROP` is typed-only: the mode toggle produces `PRO`, never `PROP`; State defaults |
| Stolen property | PRO: Serial `ZZSTOLEN1`, Type `ELECTRONICS` | `PRO.ZZSTOLEN1.ELECTRONICS` | `STOLEN` highlighted, `RECOVERED` shown as info once results arrive |

### Site variations (example-ok)

example-ok extends the default site and changes behaviour through config only (spec 7 overlay):

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
