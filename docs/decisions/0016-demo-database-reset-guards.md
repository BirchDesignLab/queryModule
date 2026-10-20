---
date: 10-20-26
status: accepted
track: a
phase: m2-p3
supersedes: [0015, "spec 5.5", "spec 8.5"]
---

# 0016 Demo database reset: a demo-only audit exception, guards as built

## Context

ADR-0015 records the developer's ruling on #821 (10-20-26): `db:reset` may remove audit rows on the demo, on mock data only, and only by replacing the whole database after a backup. The CW3 review (#829 C-m1, G-m1) found that ADR-0015 overstates one guard and understates what the command prints. It says the command "takes an exclusive write lock on the database before deleting anything", but the code takes the write lock and releases it at once, after opening the database and before the backup and the delete (CW3 ruling 1, M2 Manager 10); the health probe is the main guard. It also says the only secrets printed are the seed's one-time passwords, but the `add-demo-users` accounts print too. Accepted ADRs are not edited (`docs/decisions/README.md`, lifecycle rule 4), so this ADR restates the decision with the guards as built and supersedes ADR-0015 (ruling M2 Manager 10, 10-20-26, on #829). It is accepted on the developer's [ruling on #821](https://github.com/BirchDesignLab/queryModule/issues/821#issuecomment-6290982005), which it restates with the facts corrected and no change to the decision.

The rest of ADR-0015's context stands: spec 5.5 makes `audit_event` append-only (the `audit_event_no_update` and `audit_event_no_delete` triggers, checked at startup); SEC-010 to SEC-013 assume the audit trail survives; the demo runs on mock data only (spec 5.4, 10.8), with no real person, vehicle or property record and no real CJIS data.

## Options

1. No reset. A cluttered demo, and an unguarded manual drop when a clean one is needed.
2. Delete rows in place. Needs the delete trigger dropped and recreated around the wipe, a code path that turns the append-only guard off on any site.
3. An ops command `db:reset` that replaces the whole database file, after a backup, on mock data only. The triggers are never dropped: a fresh database is migrated, which recreates them. The history stays recoverable from the backup.

## Decision

Option 3, as ADR-0015 ruled. `db:reset` (`packages/api/src/ops/db-reset.ts`, wrapper `scripts/ops/db-reset.ts`) is the only path that removes audit rows, and it removes them only by replacing the whole demo database. In order:

1. Before opening the database it refuses unless `ALLOW_MOCK_SOURCES` is on, the database file exists, and the compose `app` service does not answer its health route (`http://app:<PORT>/api/v1/health`). The probe is the main guard against a running app. It resolves the service name first, with its own 10-second budget (on local Docker, `docker compose run` gets `ENOTFOUND` for a stopped `app` after about 4 seconds, never `EAI_AGAIN`; `scripts/ops/probe-stopped-app-dns.sh`), then sends the HTTP request with 3 seconds for the answer: the name not resolving or a refused connection means stopped; any HTTP answer means running; anything else (a timeout, a reset, a temporary DNS failure such as `EAI_AGAIN`) refuses.
2. It opens the database, which runs the app's normal start steps (migrations, the config store checks). A refusal from here on can follow those ordinary start writes.
3. It refuses unless the loaded site's sources are mock only (`LoadedConfig.mock`), `--confirm <site>` names the loaded site, and the database is not busy. The busy check takes the write lock and releases it at once: it catches a writer holding the lock at that moment, not one that starts later. No lock file is used.
4. It refuses when the backup directory for this second already exists, so a rerun never writes over an earlier backup. It takes a backup through the existing backup path (`takeBackup`, spec 8.6). If the backup fails, nothing is deleted. Its output names the backup file, so a restore is one command (`docs/deploy.md`).
5. It deletes the database, runs migrations (which recreate both audit triggers), runs the seed and then `add-demo-users`. The secrets it prints are the one-time passwords of the accounts the seed and `add-demo-users` create, once, to its stdout, never to the service log (spec 5.9).

The developer runs it on the host. No session ever runs it against the host.

Outside this command, audit rows are still never updated or deleted, on every site. This exception covers the demo on mock data only; a site with real sources can never pass the mock gate.

## Consequences

- ADR-0015 is superseded; its decision stands as restated here.
- Spec 5.5 and spec 8.5 carry `Overridden by ADR-0016.`
- `docs/deploy.md` "Reset and reseed the demo database" and the `docs/demo.md` reset lines point here.
- The append-only triggers, the startup trigger check and the CI migration checks (`check-audit-migrations.ts`, `check-schema-writes.ts`) are unchanged.
