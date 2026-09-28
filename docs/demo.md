# Demo accounts

The live demo at https://querymodule.birchdesignlab.com uses these accounts. Passwords are derived from a secret held on the deploy host and are handed out on request; they are never committed.

| Username | Role |
|---|---|
| dispatcher@example.test | user |
| records@example.test | user |
| mobileunit@example.test | user |
| officer@example.test | trainingOfficer |
| admin@example.test | admin |
| smoke@example.test | user (smoke tests only) |

All data behind these accounts is mock data (spec 5.4 fixture policy). No real person, vehicle or property record exists in this system.

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
  (`admin@example.test admin` or `officer@example.test trainingOfficer`).
- To seed the remaining demo users, either grant their roles by hand the same way, or reset the
  demo database (drop and recreate it, or restore from a pre-seed snapshot) and rerun
  `scripts/ops/seed.js` from empty.
