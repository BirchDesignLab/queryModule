#!/usr/bin/env bash
# Pull the release image and apply it only when its digest changed (ADR-0002, replaces Watchtower).
# Run every five minutes by the deploy-pull.timer systemd user unit on the deploy host.
set -euo pipefail
: "${PUBLIC_ORIGIN:?PUBLIC_ORIGIN is unset (deploy/.env)}"
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/../../deploy"
# One log line per failed step, so the journal names it (systemd alone only says "exit-code").
fail() { echo "$(date -u +%FT%TZ) deploy-pull: FAILED $1"; exit 1; }
docker compose pull app || fail pull
# Compare the pulled tag's image with the one the app container runs: `compose images` would
# report the container's own image, which a pull does not change.
ref=$(docker compose config --images app) || fail config
want=$(docker image inspect -f '{{.Id}}' "$ref") || fail inspect
cid=$(docker compose ps -q app)
have=""
if [ -n "$cid" ]; then have=$(docker inspect -f '{{.Image}}' "$cid"); fi
if [ "$have" = "$want" ]; then
  echo "$(date -u +%FT%TZ) deploy-pull: no change"
  exit 0
fi
docker compose up -d app
if timeout 60 bash -c 'until [ "$(docker inspect -f "{{.State.Health.Status}}" $(docker compose ps -q app))" = healthy ]; do sleep 2; done' \
  && bash "$here/smoke.sh" "$PUBLIC_ORIGIN"; then
  echo "$(date -u +%FT%TZ) deploy-pull: app -> $want"
else
  echo "$(date -u +%FT%TZ) deploy-pull: FAILED app -> $want (health or smoke)"
  exit 1
fi
