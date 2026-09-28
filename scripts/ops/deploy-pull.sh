#!/usr/bin/env bash
# Pull the release image and apply it only when its digest changed (ADR-0002, replaces Watchtower).
# Run every five minutes by the deploy-pull.timer systemd user unit on the deploy host.
set -euo pipefail
cd ~/git/queryModule/deploy
before=$(docker compose images -q app 2>/dev/null || true)
docker compose pull app
after=$(docker compose images -q app)
if [ "$before" != "$after" ]; then
  docker compose up -d app
  timeout 60 bash -c 'until [ "$(docker inspect -f "{{.State.Health.Status}}" $(docker compose ps -q app))" = healthy ]; do sleep 2; done'
  bash ../scripts/ops/smoke.sh "$PUBLIC_ORIGIN"
  echo "$(date -u +%FT%TZ) deploy-pull: app -> $after"
else
  echo "$(date -u +%FT%TZ) deploy-pull: no change"
fi
