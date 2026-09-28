#!/usr/bin/env bash
# scripts/ops/smoke.sh <baseUrl> [--soak 10m]   Spec 8.7. Run after every promote and at every milestone exit.
# Needs Node >= 24 and a root `pnpm install` on the machine that runs it (ws-soak.ts uses `ws`).
# Secrets never go on argv (G-I2): the seed password is derived in Node, the sign-in body goes on
# stdin and the session cookie reaches ws-soak.ts through QM_COOKIE.
set -euo pipefail
base=${1:?usage: smoke.sh <baseUrl> [--soak <n>m|<n>s]}
base=${base%/}
secs=25
if [ "${2:-}" = "--soak" ]; then
  v=${3:?duration such as 10m}
  case "$v" in *m) secs=$(( ${v%m} * 60 ));; *s) secs=${v%s};; *) secs=$v;; esac
fi
here=$(cd "$(dirname "$0")" && pwd)
email=smoke@example.test
# derivePassword (Task 25): base64url(HMAC-SHA256(trimmed secret, lowercase email)).
derive='const c=require("node:crypto"),f=require("node:fs");process.stdout.write(c.createHmac("sha256",f.readFileSync(process.argv[1],"utf8").trim()).update(process.argv[2].toLowerCase()).digest("base64url"))'
jar=$(mktemp); trap 'rm -f "$jar"' EXIT

h=$(curl -fsS "$base/api/v1/health"); grep -q '"status":"ok"' <<<"$h"
h=$(curl -fsS "$base/api/v1/meta"); grep -q '"apiVersion":"v1"' <<<"$h"
echo "1 ok: health and meta"

if [ -n "${SEED_PASSWORD_SECRET_FILE:-}" ]; then
  # Off-host or local dev: a secret file this user can read.
  pw=$(node -e "$derive" "$SEED_PASSWORD_SECRET_FILE" "$email")
else
  # Deploy host: the secret is uid 10001 mode 400, readable only inside the app container.
  pw=$(docker compose -f "$here/../../deploy/compose.yml" exec -T app \
    node -e "$derive" /run/secrets/SEED_PASSWORD_SECRET "$email")
fi
printf '{"email":"%s","password":"%s"}' "$email" "$pw" |
  curl -fsS -c "$jar" -H 'content-type: application/json' -H "origin: $base" \
    --data-binary @- "$base/api/v1/auth/sign-in/email" >/dev/null
h=$(curl -fsS -b "$jar" "$base/api/v1/config"); grep -q '"configHash"' <<<"$h"
echo "2 ok: login as smoke and GET /api/v1/config"

cookie=$(awk -F'\t' '$6 ~ /qm_session$/ {print $6"="$7}' "$jar")
[ -n "$cookie" ] || { echo "no session cookie"; exit 1; }
QM_COOKIE=$cookie node "$here/ws-soak.ts" "$base" "$secs"
echo "5 ok: websocket heartbeat"
