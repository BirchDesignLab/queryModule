---
date: 09-25-26
status: accepted
track: A
phase: P1
supersedes: []
---

# 0002 Replace Watchtower with a systemd pull timer

## Context

Spec v2 section 8.3 deploys with Watchtower polling GHCR for the `release` tag. Upstream `containrrr/watchtower` was archived read-only on 12-17-25 with no successor endorsed by its maintainers; the most active fork (`nickfedor/watchtower`) is unendorsed. Watchtower also needs the Docker socket mounted, which is root-equivalent on the deploy host. The project policy is newest stable with no sitting on known advisories, and the compliance posture (spec 2) argues against a socket-holding third-party container. Because compose already pins `app` to the `release` tag (8.4), the update Watchtower performs is one pull and one `up -d`.

## Options

1. Keep Watchtower via the `nickfedor/watchtower` fork, pinned by digest, Dependabot tracking. Drop-in; still an unendorsed dependency with socket access.
2. Systemd timer on the deploy user running `scripts/ops/deploy-pull.sh` every five minutes: `docker compose pull app`; if the digest changed, `docker compose up -d app`, wait for health, run `smoke.sh`, log. About fifteen lines, no third-party image, no socket handed to a container.

## Decision

Option 2. `deploy/systemd/deploy-pull.service` and `deploy-pull.timer` (user units, lingering enabled) call `scripts/ops/deploy-pull.sh`. Compose has two services, `app` and `cloudflared`. `app` carries `com.centurylinklabs.watchtower.enable=false` so a Watchtower instance already running on the host for other containers ignores it.

## Consequences

- Spec v2 sections 3, 8.3, 8.4 and 14 updated to the timer; section 8.3 cites this ADR.
- Track A P1 plan: the compose task drops the `watchtower` service and adds the units and script; the gate step "Watchtower follows `release`" becomes "timer deploys `release` within five minutes".
- Deploy-host check at Track A P1: inventory containers already on the laptop; if a Watchtower is running there, confirm it runs with `--label-enable` or that the `enable=false` label excludes `app`.
- Rollback unchanged: promote an older sha; the next timer run applies it.
