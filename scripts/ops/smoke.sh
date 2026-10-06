#!/usr/bin/env bash
# scripts/ops/smoke.sh <baseUrl> [--soak 10m]   Spec 8.7. Run after every promote and at every milestone exit.
# Needs Node >= 24 and a root `pnpm install` on the machine that runs it (smoke-feed.ts and ws-soak.ts use `ws`).
# Secrets never go on argv (G-I2): the seed password is derived in Node, the sign-in body goes on
# stdin, the submit body goes on stdin and the session cookie reaches smoke-feed.ts (step 4, the
# feed per D-A10 option a) and ws-soak.ts (step 5) through QM_COOKIE.
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
cfg=$(curl -fsS -b "$jar" "$base/api/v1/config"); grep -q '"configHash"' <<<"$cfg"
echo "2 ok: login as smoke and GET /api/v1/config"

# Step 4 needs the feed open before the submit (D-A10 option a): smoke-feed.ts sends hello, creates
# $ready on welcome, and after the submit ($go) waits for one non-pending sourceStatus per source.
cookie=$(awk -F'\t' '$6 ~ /qm_session$/ {print $6"="$7}' "$jar")
[ -n "$cookie" ] || { echo "no session cookie"; exit 1; }
# ready and go are created later (welcome, submit), so they live in a private mktemp -d dir (G-M2)
sig=$(mktemp -d); ready=$sig/ready; go=$sig/go; feedout=$(mktemp); resp=$(mktemp)
feedpid=
trap 'rm -f "$jar" "$resp" "$feedout"; rm -rf "$sig"; [ -z "$feedpid" ] || kill "$feedpid" 2>/dev/null || true' EXIT
QM_COOKIE=$cookie node "$here/smoke-feed.ts" "$base" "$ready" "$go" "$resp" >"$feedout" 2>&1 &
feedpid=$!
for _ in $(seq 1 100); do
  [ -e "$ready" ] && break
  kill -0 "$feedpid" 2>/dev/null || { cat "$feedout"; echo "step 4 failed: feed did not open"; exit 1; }
  sleep 0.1
done
[ -e "$ready" ] || { echo "step 4 failed: feed sent no welcome"; exit 1; }

# Step 3 (spec 8.7): submit a VEH query with a fixture plate (ZZ-####); the config hash comes from
# step 2. Body on stdin; the status is the only thing a failure prints. plateOnly is the mode the
# api tests submit for VEH on the default site (allowPlateOnly), so no other field is required.
idem=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
body=$(printf '%s' "$cfg" | node -e '
const h=JSON.parse(require("node:fs").readFileSync(0,"utf8")).configHash;
process.stdout.write(JSON.stringify({queryType:"VEH",values:{plate:"ZZ-0001"},
  sourceIds:["stateSource","nationalSource"],mode:"plateOnly",configHash:h}))')
code=$(printf '%s' "$body" | curl -sS -o "$resp" -w '%{http_code}' -b "$jar" \
  -H 'content-type: application/json' -H "origin: $base" -H 'x-requested-with: querymodule' \
  -H "idempotency-key: $idem" --data-binary @- "$base/api/v1/queries")
[ "$code" = 202 ] || { echo "step 3 failed: submit answered HTTP $code"; exit 1; }
cid=$(node -e 'const c=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).correlationId;if(typeof c!=="string"||!c)process.exit(1);process.stdout.write(c)' "$resp") ||
  { echo "step 3 failed: submit 202 without a correlationId"; exit 1; }
echo "3 ok: submit 202 $cid"

: >"$go"
if wait "$feedpid"; then rc=0; else rc=$?; fi
feedpid=
cat "$feedout"
[ "$rc" = 0 ] || exit 1

QM_COOKIE=$cookie node "$here/ws-soak.ts" "$base" "$secs"
echo "5 ok: websocket heartbeat"
