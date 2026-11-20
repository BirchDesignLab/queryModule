# Deploying Query Module

One image serves every site (spec 8). The demo host is a Linux laptop running `deploy/compose.yml` behind a Cloudflare Tunnel. Host setup commands are in the master plan, section 9.1.

## Services

- `app`: `ghcr.io/birchdesignlab/querymodule:release`. While the package is public, pulls need no GHCR login (master plan 9.1 item 3 is optional). No published ports; cloudflared is the sole ingress, which is what makes `CF-Connecting-IP` trustworthy. `stop_grace_period: 30s` covers the default 10 s source timeout. The SIGTERM drain's worst case is 2 s (in-flight HTTP) + the largest `timeoutMs` + 5 s (spec 5.2), so a site that raises any `timeoutMs` above 18 s must raise `stop_grace_period` too, keeping 5 s of margin (not enforced).
- `cloudflared`: routes `querymodule.birchdesignlab.com` (HTTP and WebSocket) to `http://app:3000`. It is Query Module's own tunnel with its own token (`TUNNEL_TOKEN`); it never shares the host's other tunnel containers, such as `postiz-cloudflared`.
- No Watchtower (ADR-0002, `docs/decisions/0002-drop-watchtower.md`): the `deploy-pull.timer` systemd user unit runs `scripts/ops/deploy-pull.sh` every 5 minutes, pulling `app`'s `release` tag and applying it only when the pulled image differs from the one the `app` container runs, then running `smoke.sh`, and logs `deploy-pull: FAILED` when the health wait or the smoke fails. `smoke.sh` derives the smoke user's password inside the `app` container from `/run/secrets`, so it needs no `sudo`; its WebSocket step runs `ws-soak.ts` on the host, which needs Node 24 and a root `pnpm install` in `~/git/queryModule`. Off the deploy host (a laptop, CI, `pnpm dev`) there is no `app` container to exec into: set `SEED_PASSWORD_SECRET_FILE` to a readable copy of that site's seed secret, or `smoke.sh` stops at the `docker compose exec` step after step 1 (nothing secret is printed). `app` carries `com.centurylinklabs.watchtower.enable=false`, so any Watchtower already running on the host for other containers (Task 37's inventory check) ignores it.
- Host Watchtower: none found on the deploy host (Task 37, 09-28-26); `app` carries `com.centurylinklabs.watchtower.enable=false` regardless.
- Host autoheal: the deploy host runs `willfarrell/autoheal` with `AUTOHEAL_CONTAINER_LABEL=all` and `AUTOHEAL_INTERVAL=15`, which restarts any container that reports unhealthy. `app` opts out with the label `autoheal=False` (developer decision 09-28-26), so an unhealthy `app` stays down for a person to look at instead of restarting every 15 s. The value is case-sensitive: autoheal's entrypoint excludes only `select(.Labels["autoheal"] != "False")`, so `false` does nothing (verified on the host 09-28-26).

## Secrets

Docker secret files under `/opt/querymodule/secrets/`, owned by uid 10001 (cloudflared's token by the cloudflared image user), mode 400: `DB_ENCRYPTION_KEY`, `CREDENTIAL_KEY`, `DATA_KEY`, `BETTER_AUTH_SECRET`, `SEED_PASSWORD_SECRET`, `TUNNEL_TOKEN`. Environment variables name file paths only. Nothing secret is in the image, in `.env` or on `/data`.

Copies of `DB_ENCRYPTION_KEY`, `CREDENTIAL_KEY`, `DATA_KEY` and the backup `age` private key are kept offline, off the laptop, never beside backups. Losing `DB_ENCRYPTION_KEY` with no offline copy loses the database and every backup.

## Release and rollback

CI pushes `sha-<commit>` and `latest` on every merge to `main`. Nothing deploys `latest`. Promote a commit:

```bash
gh workflow run promote.yml -f sha=<full sha> [-f milestone=m<k>]
gh run watch
bash scripts/ops/smoke.sh https://querymodule.birchdesignlab.com
```

Rollback is a promote of an older sha. Migrations are expand-then-contract, so an older image runs on a newer schema.

## Apply the image's site config to a seeded deploy

After the first boot the config store is the live site config (ADR-0011): a new image's site and mock files are compared, logged as "site config file ignored" (with `fix: "config:import (docs/deploy.md)"`) and not used. To publish the image's site config after a promote, as the next version with the normal `configPublished` audit row by a named admin (#792, CFG-4):

```bash
cd ~/git/queryModule/deploy
docker compose run --rm app node scripts/ops/config-import.js --dry-run
docker compose run --rm app node scripts/ops/config-import.js --admin admin@example.test
docker compose restart app
```

Then check it: the next smoke run passes (`bash ../scripts/ops/smoke.sh https://querymodule.birchdesignlab.com`), and with `adminAudit` on the admin console's audit page loads.

- The dry run prints one line per change (`~ /siteConfig/features/adminAudit false -> true`) and writes nothing. If it prints `unchanged`, the store already holds the image's config: stop there.
- The import validates the file as boot does (the mock gate and the fixture policy apply) and as a publish does, saves it as the shared draft and publishes it with the note "Imported from the image". `--admin` names an active user who holds `admin`.
- Labels keep the published overlay: the image carries none, so label edits published in the builder stay.
- One shared draft exists per site. If the dry run reports one, the import refuses; add `--replace-draft` to the import line only when that draft can be discarded (the output names its version and the user who last saved it). A replaced draft is not restored.
- A refused import publishes nothing: it exits non-zero (1 refused, 2 usage error) and prints the message keys and pointers to stderr, never document content or passwords. Without `--replace-draft` it also writes nothing. With `--replace-draft`, the shared draft it replaced is already gone when the publish is refused (the output says so); the live version is unchanged either way.
- The command runs in its own process, so the running `app` keeps serving the old version until `docker compose restart app`. Open clients then see the new `configHash`.
- The import runs while `app` is up, so two processes write the one SQLite database. If the app holds the write lock past the busy timeout, the import stops with a `config:import failed: ... SQLITE_BUSY` line and publishes nothing; run it again. If the next dry run reports a shared draft from that run, add `--replace-draft`.
- A builder save of the shared draft while the import runs makes the import refuse (`configImport.draftConflict`) and publish nothing; the builder's draft stays. Run the dry run again.
- `--file <path>` imports another site file in the image; the default is the one boot reads (`SITE_CONFIG`, else the bundled `config/sites/default.json`). Off the host, with the environment the app runs with: `pnpm config:import --dry-run`.

## First deploy

```bash
cd ~/git/queryModule/deploy
cp .env.example .env
docker volume create qm-backup-staging   # external in compose.yml; compose up fails without it
docker compose pull && docker compose up -d
docker compose run --rm app node scripts/ops/seed.js    # once; store the printed passwords in a password manager
bash ../scripts/ops/smoke.sh https://querymodule.birchdesignlab.com
```

`CORS_ORIGINS` in `.env` lists the browser origins the API accepts, comma-separated, each an origin like `https://host` (no path, no trailing slash); empty means `PUBLIC_ORIGIN` only. A REST request carrying any other `Origin` gets 403 (D-M2P3-1), and a malformed entry stops the app at boot with a `CORS_ORIGINS` error that does not echo the value.

The other `deploy/.env.example` variables (`packages/api/src/env.ts`):

| Variable | Meaning |
|---|---|
| `ALLOW_MOCK_SOURCES` | `true` only on the demo host, CI and dev (spec 5.4); the app refuses mock sources otherwise |
| `IDENTITY_MODES` | Comma-separated, `standalone` and/or `embedded`; default `standalone`; any other value stops the app at boot |
| `MIN_CLIENT_VERSION` | Reported as `minClientVersion` by `/api/v1/meta`; empty means none |
| `FRAME_ANCESTORS` | Parsed but not applied yet: the CSP sends `frame-ancestors 'none'` until embedded mode (M4) uses this list |
| `WS_UPGRADE_LIMIT`, `WS_UPGRADE_WINDOW_MS` | WebSocket upgrades per client IP per window; empty keeps the defaults, 60 and 60000 ms (D-A9) |
| `ADAPTER_DIR` | Plugin adapter directory (`/adapters`); unused for now, only mock adapters are built in (D-A11) |

Install the pull timer once (systemd user units keep running without a login session):

```bash
mkdir -p ~/.config/systemd/user
cp systemd/deploy-pull.{service,timer} ~/.config/systemd/user/
loginctl enable-linger "$(whoami)"
systemctl --user daemon-reload
systemctl --user enable --now deploy-pull.timer
systemctl --user list-timers deploy-pull.timer
```

## Sessions and the sweeper

The `app` process runs a sweeper every 60 seconds from startup (spec 5.2). Each tick reads the live session limits (`auth.session.absoluteMinutes` and `idleMinutes`; a publish applies on the next tick), deletes the sessions past either limit in batches of 500, at most 2,000 per tick, each in its own transaction with a `sessionRevoked` audit row (reason `expired`, system actor), and closes their sockets with 4001 once that transaction commits. Once an hour it prunes `event_log` (each user's newest row is kept). A failed expiry is logged with the session id and error class, skipped for the rest of that tick so it cannot hold up the others, and retried on the next tick; the session is already refused at its live limit, so nothing is granted meanwhile. The SIGTERM drain stops the sweeper between sessions: it waits for at most the one session transaction in flight (no further session and no prune) before closing the database.

Better Auth's own session expiry is fixed at the 7-day ceiling plus one day (`SESSION_CEILING_MINUTES` in `packages/core/src/config/session-limits.ts`, the margin in `packages/api/src/auth/auth.ts`). `config:validate` refuses an `absoluteMinutes` above the ceiling, so the sweeper always ends a session first, with its audit row, and has a day to catch up if it falls behind. A session created before an upgrade keeps the expiry it was stored with.

## Auth limits

| Limit | Key | Value | Effect |
|---|---|---|---|
| Sign-in failures per account | `login:acct:<email>` | 10 in 15 minutes | Account locked for 15 minutes |
| Auth requests per client address | `login:ip:<ip>` | 100 in 15 minutes | 429 on every auth POST |
| Wrong current password on change-password | `changePassword:<userId>` | 5 in 15 minutes | 429 with `Retry-After` on change-password only; sign-in unaffected; a success clears it |

A wrong guess and the 429 block write no audit row. The limiter logs the user id only.

## Backups

`scripts/ops/backup.sh` runs nightly from a systemd user timer: an online copy of the encrypted database into the `qm-backup-staging` volume (never `/data`), `age` encryption to a recipient key whose private half is not on the laptop, upload with `rclone` to the R2 bucket, prune after 30 days. Use a current `rclone` from rclone.org rather than the distribution package: Ubuntu's 1.60 gets a 501 on its first PUT to R2 and succeeds only on retry (host, 09-28-26; #487), so `backup.sh` refuses any rclone older than 1.65 before it starts. To replace the packaged one: download `rclone-current-linux-amd64.deb` from downloads.rclone.org, `sudo apt remove rclone`, `sudo dpkg -i` the download, then `rclone version` (the remote in `~/.config/rclone/rclone.conf` is kept). `qm-backup-staging` is declared external in `compose.yml`, so compose never creates a project-prefixed copy; after a backup run, `docker volume ls` shows a single unprefixed `qm-backup-staging`.

Backups hold superseded and deleted credential ciphertext for up to 30 days, recoverable only with the `age` private key, `DB_ENCRYPTION_KEY` and `CREDENTIAL_KEY` together, and crypto-shredded payload keys for the same window, recoverable only with the `age` private key, `DB_ENCRYPTION_KEY` and `DATA_KEY` together.

Install the nightly backup units once, as for the pull timer (`~/.config/systemd/user/`, then `daemon-reload` and `systemctl --user enable --now querymodule-backup.timer`):

```bash
cd ~/git/queryModule/deploy
cp systemd/querymodule-backup.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now querymodule-backup.timer
systemctl --user list-timers querymodule-backup.timer
```

The timer fires daily at 03:30 with up to 10 minutes of random delay and is `Persistent` (a run missed while the laptop was off happens at the next start). The service sets `QM_AGE_RECIPIENT_FILE=/opt/querymodule/backup/age-recipient.txt` (the public recipient key; the private half stays offline) and `QM_RCLONE_REMOTE=r2:querymodule-backups`; edit the unit if either differs on the host.

`scripts/ops/restore-test.sh` restores the newest backup into a throwaway container and compares audit row counts with the backup manifest. It runs at every milestone exit; the result goes into `docs/releases/<milestone>.md`. Usage:

```bash
AGE_IDENTITY=/media/offline/age-key.txt bash scripts/ops/restore-test.sh [image]
```

`AGE_IDENTITY` (the offline `age` private key) is required. Optional: `QM_RCLONE_REMOTE` (default `r2:querymodule-backups`), `QM_SECRETS_DIR` (default `/opt/querymodule/secrets`) and the image argument (default `ghcr.io/birchdesignlab/querymodule:release`).

## Reset and reseed the demo database

The db-reset script (`scripts/ops/db-reset.ts`, run in the image as `node scripts/ops/db-reset.js --confirm <site>`, as the commands below show; [ADR-0016](decisions/0016-demo-database-reset-guards.md) and ADR-0015 call it `db:reset`, but no package script has that name; #821) replaces the whole demo database: it backs it up, deletes it, migrates a fresh one (which recreates the audit triggers), runs the seed and then `add-demo-users`. The old database's audit rows go with the file and stay in the backup. The developer runs it on the deploy host; no session ever runs it against the host.

It refuses, with no backup taken and nothing deleted, unless all of these hold: `ALLOW_MOCK_SOURCES=true` and every source of the loaded site is mock; `--confirm` names the loaded site's id; the `app` service does not answer `http://app:<PORT>/api/v1/health` (a refused connection or an unknown host means stopped; any other probe failure, a temporary DNS failure included, refuses); the database is not busy when it checks; and no backup directory for the same second exists (wait a second and rerun). A site with any real source can never pass. If the backup fails, nothing is deleted.

The health probe is the main guard: it runs first, before the database is opened. It resolves the `app` name first, with up to 10 seconds for the answer (Docker's DNS takes about 4 seconds to report a stopped service's name as unknown), then sends the HTTP request with 3 seconds for the answer, so the check can take about 5 seconds. The busy check comes after the open and is a point-in-time check: it takes the write lock and releases it at once, before the backup and the delete, so it catches a writer that holds the lock at that moment, not one that starts later. Opening the database runs the app's normal start steps (migrations, the config store checks), so a refusal after the open (a site that is not mock only, a `--confirm` that does not match, a busy database) can follow those ordinary start writes.

```bash
cd ~/git/queryModule/deploy
docker compose stop app
docker volume create qm-backup-staging >/dev/null
docker run --rm -v qm-backup-staging:/backup alpine:3 chown 10001:10001 /backup
docker compose run --rm -v qm-backup-staging:/backup app node scripts/ops/db-reset.js --confirm <site>
# store the printed passwords in a password manager
docker compose start app
bash ../scripts/ops/smoke.sh https://querymodule.birchdesignlab.com
```

The output names the backup it took, `/backup/db-reset-<stamp>/querymodule.db`, with the manifest's audit row count and max id. Its passwords print once, to this command's stdout only. To put the old database back, stop the app, copy that backup over the database in `/data` with the app's owner, and start the app (replace `<stamp>`):

```bash
docker compose stop app
docker run --rm -v querymodule_data:/data -v qm-backup-staging:/backup alpine:3 sh -c 'rm -f /data/querymodule.db-wal /data/querymodule.db-shm && cp /backup/db-reset-<stamp>/querymodule.db* /data/ && chown 10001:10001 /data/querymodule.db*'
docker compose start app
```

## Runbooks

- Lost `CREDENTIAL_KEY`: `scripts/ops/lost-key.ts` (steps in its header).
- Lost `DATA_KEY`: `scripts/ops/lost-data-key.ts` (steps in its header).
- Lost `DB_ENCRYPTION_KEY`: restore from the offline copy of the key; there is no other path.
- Roles: `docker compose run --rm app node scripts/ops/grant-role.js <email> <role> [--revoke]`.
- Demo accounts added after the first seed (#781): `docker compose run --rm app node scripts/ops/add-demo-users.js` creates only the demo accounts the database lacks (derived passwords, printed once to stdout; existing accounts unchanged; `@example.test` only; each creation and role grant audited). Steps in `docs/demo.md`, "Add missing demo accounts".
- Sign-ins: `docker compose run --rm app node scripts/ops/login-stats.js [--since YYYY-MM-DD]` prints, per account, the sign-in count, distinct client IPs and last sign-in (UTC) from the audit's `loginSucceeded` rows; IP values are never printed. Read only.
- Acknowledgment receipts (NFR-004, D-M2P2-4): the client sends `ackReceipt` over the socket and the server logs one `metric ackReceipt` line per request (correlation id and `e2eMs`, the server-clock time from the acknowledgment to the receipt; a metric, not audit). Summarize on the host with `docker compose logs app --no-log-prefix | docker compose run --rm -T app node scripts/ops/ack-stats.js`; it prints `count`, `p50`, `p95`, `max` (ms) and `malformed` as one JSON line. A file argument works too. Counts reset when the process restarts, so a repeat receipt after a restart is counted again. Read only.
- Audit counts: `docker compose run --rm app node scripts/ops/audit-stats.js [--up-to <id>]` prints `{"auditCount":n,"auditMaxId":m}`, the same figures a backup manifest holds. Read only.
- Audit triggers: `docker compose run --rm app node scripts/ops/check-triggers.js` exits 0 only when every `audit_event`, query-table and `site_config_version` trigger exists unaltered, as at startup (CI boot smoke, spec 9.3 step 11).
- Stopped-app DNS: `bash scripts/ops/probe-stopped-app-dns.sh [image]` shows, in a throwaway compose project on local Docker, what the db-reset health probe gets for `http://app:<port>` when the app service is up, stopped or removed (#829). It touches nothing else.
