# deploy

Deployment files for the single-node Docker host (spec 8). How to deploy, release, roll back and
back up: [docs/deploy.md](../docs/deploy.md).

| File | Purpose |
|---|---|
| `Dockerfile` | The one image that serves every site |
| `compose.yml` | The `app` service and the `cloudflared` tunnel service, the Docker secrets and the volumes |
| `.env.example` | The non-secret settings; copy it to `.env` on the host |
| `systemd/deploy-pull.service`, `systemd/deploy-pull.timer` | Pull the `release` image every 5 minutes and apply it when it changed (ADR-0002 replaces Watchtower) |
| `systemd/querymodule-backup.service`, `systemd/querymodule-backup.timer` | The nightly encrypted backup (`scripts/ops/backup.sh`) |

Secrets are Docker secret files on the host, never in this folder; [docs/deploy.md](../docs/deploy.md)
lists them.
