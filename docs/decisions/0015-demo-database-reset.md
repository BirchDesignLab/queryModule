---
date: 10-20-26
status: superseded
track: a
phase: m2-p3
supersedes: ["spec 5.5", "spec 8.5"]
---

# 0015 Demo database reset: a demo-only audit exception

## Context

The live demo has to be seeded, wiped and reseeded on demand (#821). Today the seed runs once against an empty database and refuses on every later run (spec 8.5), and `docs/demo.md` says there is no reset, by ruling. Spec 5.5 makes `audit_event` append-only: the `audit_event_no_update` and `audit_event_no_delete` triggers abort any change, and the server refuses to serve without them. The audit requirements SEC-010 to SEC-013 ("Every query shall be logged ..."; acknowledgment, response and delete-from-view records) assume the audit trail survives. A reset that empties the database removes that trail, so it needs a recorded exception.

The demo runs on mock data only (spec 5.4, 10.8): no real person, vehicle or property record and no real CJIS data is ever in it. The developer ruled the design on 10-20-26 (#821, ruling comment, relayed by M2 Manager 10).

## Options

1. No reset (the current ruling). The demo database keeps every rehearsal row forever; a clean demo needs a manual drop and recreate with no guard. Cost: a cluttered demo, and an unguarded manual step when a clean one is needed.
2. Delete rows in place (truncate audit and request tables). Needs the delete trigger dropped and recreated around the wipe, so the append-only guard would have a code path that turns it off. Risk: that path is reachable on any site, not only the demo.
3. An ops command `db:reset` that replaces the whole database file, after a backup, on mock data only. The triggers are never dropped: the old file is removed whole and a fresh one is migrated, which recreates them. The history stays recoverable from the backup it took.

## Decision

Option 3. `db:reset` (`packages/api/src/ops/db-reset.ts`, wrapper `scripts/ops/db-reset.ts`) is the only path that removes audit rows, and it removes them only by replacing the whole demo database:

- It refuses unless the mock gate is on: `ALLOW_MOCK_SOURCES` is on and the loaded site's sources are mock only (`LoadedConfig.mock`), and `--confirm <site>` names the loaded site.
- It refuses while the app runs: it probes the compose `app` service's health route and stops if it answers, and it takes an exclusive write lock on the database before deleting anything and stops if the database is busy. No lock file is used.
- It takes a backup through the existing backup path (`takeBackup`, spec 8.6) first. If the backup fails, nothing is deleted. Its output names the backup file, so a restore is one command (`docs/deploy.md`).
- It then deletes the database, runs migrations (which recreate both audit triggers), runs the seed and then `add-demo-users`. The only secrets it prints are the seed's own one-time passwords, to its stdout.
- The developer runs it on the host. No session ever runs it against the host.

Outside this command, audit rows are still never updated or deleted, on every site. This exception covers the demo on mock data only; a site with real sources can never pass the mock gate.

## Consequences

- New ops command `db:reset` with its tests (CW3, #821). `docs/deploy.md` and `docs/demo.md` get the reset, reseed and restore steps, and the `docs/demo.md` "no reset" lines point here.
- Spec 5.5 and spec 8.5 carry `Overridden by ADR-0015.`
- The append-only triggers, the startup trigger check and the CI migration checks (`check-audit-migrations.ts`, `check-schema-writes.ts`) are unchanged.
