# Deploying Query Module

One image serves every site (spec 8). The demo host is a Linux laptop running `deploy/compose.yml` behind a Cloudflare Tunnel. Host setup commands are in the master plan, section 9.1.

## Services

- `app`: `ghcr.io/birchdesignlab/querymodule:release`. No published ports; cloudflared is the sole ingress, which is what makes `CF-Connecting-IP` trustworthy. `stop_grace_period: 30s` covers the default 10 s source timeout. A site that raises any `timeoutMs` above 20 s must raise `stop_grace_period` too (not enforced).
- `cloudflared`: routes `querymodule.birchdesignlab.com` (HTTP and WebSocket) to `http://app:3000`. It is Query Module's own tunnel with its own token (`TUNNEL_TOKEN`); it never shares the host's other tunnel containers, such as `postiz-cloudflared`.
- No Watchtower (ADR-0002, `docs/decisions/0002-drop-watchtower.md`): the `deploy-pull.timer` systemd user unit runs `scripts/ops/deploy-pull.sh` every 5 minutes, pulling `app`'s `release` tag and applying it only when the digest changed, then running `smoke.sh`. `app` carries `com.centurylinklabs.watchtower.enable=false`, so any Watchtower already running on the host for other containers (Task 37's inventory check) ignores it.
- Host Watchtower: none found on the deploy host (Task 37, 09-28-26); `app` carries `com.centurylinklabs.watchtower.enable=false` regardless.
- Host autoheal: the deploy host runs `willfarrell/autoheal` with `AUTOHEAL_CONTAINER_LABEL=all` and `AUTOHEAL_INTERVAL=15`, which restarts any container that reports unhealthy. `app` opts out with the label `autoheal=false` (developer decision 09-28-26), so an unhealthy `app` stays down for a person to look at instead of restarting every 15 s. Task 35 verifies on the host that the running autoheal honours the label.

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

## First deploy

```bash
cd ~/git/queryModule/deploy
cp .env.example .env
docker volume create qm-backup-staging   # external in compose.yml; compose up fails without it
docker compose pull && docker compose up -d
docker compose run --rm app node scripts/ops/seed.js    # once; store the printed passwords in a password manager
bash ../scripts/ops/smoke.sh https://querymodule.birchdesignlab.com
```

Install the pull timer once (systemd user units keep running without a login session):

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/deploy-pull.{service,timer} ~/.config/systemd/user/
loginctl enable-linger "$(whoami)"
systemctl --user daemon-reload
systemctl --user enable --now deploy-pull.timer
systemctl --user list-timers deploy-pull.timer
```

## Backups

`scripts/ops/backup.sh` runs nightly from a systemd user timer: an online copy of the encrypted database into the `qm-backup-staging` volume (never `/data`), `age` encryption to a recipient key whose private half is not on the laptop, upload with `rclone` to the R2 bucket, prune after 30 days. `qm-backup-staging` is declared external in `compose.yml`, so compose never creates a project-prefixed copy; after a backup run, `docker volume ls` shows a single unprefixed `qm-backup-staging`.

Backups hold superseded and deleted credential ciphertext for up to 30 days, recoverable only with the `age` private key, `DB_ENCRYPTION_KEY` and `CREDENTIAL_KEY` together, and crypto-shredded payload keys for the same window, recoverable only with the `age` private key, `DB_ENCRYPTION_KEY` and `DATA_KEY` together.

`scripts/ops/restore-test.sh` restores the newest backup into a throwaway container and compares audit row counts with the backup manifest. It runs at every milestone exit; the result goes into `docs/releases/<milestone>.md`.

## Runbooks

- Lost `CREDENTIAL_KEY`: `scripts/ops/lost-key.ts` (steps in its header).
- Lost `DATA_KEY`: `scripts/ops/lost-data-key.ts` (steps in its header).
- Lost `DB_ENCRYPTION_KEY`: restore from the offline copy of the key; there is no other path.
- Roles: `docker compose run --rm app node scripts/ops/grant-role.js <email> <role> [--revoke]`.
