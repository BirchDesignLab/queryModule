# deploy

Deployment files for the single-node Docker host (spec 8): `Dockerfile`, `compose.yml`, cloudflared config, `deploy-pull` systemd unit and timer, `.env.example`, secret file templates, systemd backup units. Watchtower is dropped in favor of the systemd pull timer (ADR-0002, `docs/decisions/0002-drop-watchtower.md`). They land in Track A M0 P1 (`docs/superpowers/plans/2026-09-25-track-a-p1.md`).
