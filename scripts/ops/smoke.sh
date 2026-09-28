#!/usr/bin/env bash
# scripts/ops/smoke.sh <baseUrl> [--soak 10m]   Spec 8.7. Run after every promote and at every milestone exit.
set -euo pipefail
base=${1:?usage: smoke.sh <baseUrl> [--soak <n>m|<n>s]}
secs=25
if [ "${2:-}" = "--soak" ]; then
  v=${3:?duration such as 10m}
  case "$v" in *m) secs=$(( ${v%m} * 60 ));; *s) secs=${v%s};; *) secs=$v;; esac
fi
f=${SEED_PASSWORD_SECRET_FILE:-/opt/querymodule/secrets/SEED_PASSWORD_SECRET}
if [ -r "$f" ]; then secret=$(cat "$f"); else secret=$(sudo cat "$f"); fi
email=smoke@example.test
pw=$(printf '%s' "$email" | openssl dgst -sha256 -hmac "$secret" -binary | base64 | tr '+/' '-_' | tr -d '=')
jar=$(mktemp); trap 'rm -f "$jar"' EXIT

curl -fsS "$base/api/v1/health" | grep -q '"status":"ok"'
curl -fsS "$base/api/v1/meta" | grep -q '"apiVersion":"v1"'
echo "1 ok: health and meta"

curl -fsS -c "$jar" -H 'content-type: application/json' -H "origin: $base" \
  -d "{\"email\":\"$email\",\"password\":\"$pw\"}" "$base/api/v1/auth/sign-in/email" >/dev/null
curl -fsS -b "$jar" "$base/api/v1/config" | grep -q '"configHash"'
echo "2 ok: login as smoke and GET /api/v1/config"

cookie=$(awk -F'\t' '$6 ~ /qm_session$/ {print $6"="$7}' "$jar")
[ -n "$cookie" ] || { echo "no session cookie"; exit 1; }
node "$(dirname "$0")/ws-soak.ts" "$base" "$cookie" "$secs"
echo "5 ok: websocket heartbeat"
