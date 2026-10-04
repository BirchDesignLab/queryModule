#!/usr/bin/env bash
# scripts/ci/boot-smoke.sh <up|down|all> <image> [--build]
# CI step 11 (spec 9.3) and `pnpm image:smoke`. `up` boots the image on a fresh volume with random secrets,
# waits for health, checks triggers, seeds users. `down` sends SIGTERM and requires exit 0 within the grace period.
#
# Before the service container starts, `up` also proves every compiled ops CLI in the image
# (#130 carry, A-offload wave 2): existence, check-triggers on a fresh migrated db and after one
# audit_event trigger is dropped, audit-stats with and without --up-to and on a bad --up-to, login-stats likewise with --since,
# backup's outDir guard, grant-role's bad-arg exit, and both lost-key runbooks recovering onto a
# volume the app then boots on. Every ops check runs on its own throwaway volume via
# `docker run --rm`, never on the qm-smoke service volume.
set -euo pipefail
# Git Bash (MSYS) rewrites unix-looking args (e.g. the container-side half of a -v bind, or a
# bare host path) into Windows paths before docker ever sees them. This is a no-op on Linux CI.
export MSYS_NO_PATHCONV=1
cmd=${1:?usage: boot-smoke.sh <up|down|all> <image> [--build]}
image=${2:?image}
build=${3:-}
name=qm-smoke
vol=qm-smoke-data
work=${QM_SMOKE_DIR:-$PWD/.smoke}
sec=$work/secrets

# --- helpers shared by the ops checks -------------------------------------------------------

# docker run --rm for a one-shot ops CLI call against a given volume/secrets dir.
ops_run() {
  local ops_vol=$1 ops_sec=$2; shift 2
  docker run --rm -v "$ops_vol:/data" -v "$ops_sec:/run/secrets:ro" \
    -e PUBLIC_ORIGIN=http://localhost:3000 -e ALLOW_MOCK_SOURCES=true "$image" "$@"
}

# Asserts the last `ops_run` (or any command) exited with the given code; $1 label, $2 expected, $3 actual.
assert_exit() {
  local label=$1 expected=$2 actual=$3
  if [ "$actual" != "$expected" ]; then
    echo "ops check failed: $label exited $actual, expected $expected"
    exit 1
  fi
  echo "ops check ok: $label exited $actual"
}

# Boots the image once on a volume to produce a fresh migrated db, then stops and removes the
# container, leaving the volume and its (still-encrypted) db file behind.
boot_once() {
  local boot_vol=$1 boot_sec=$2 boot_name=$3
  docker rm -f "$boot_name" >/dev/null 2>&1 || true
  docker run -d --name "$boot_name" -v "$boot_vol:/data" -v "$boot_sec:/run/secrets:ro" \
    -e PUBLIC_ORIGIN=http://localhost:3000 -e ALLOW_MOCK_SOURCES=true "$image" >/dev/null
  local i
  for i in $(seq 1 60); do
    if docker exec "$boot_name" node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1; then
      break
    fi
    if [ "$i" = 60 ]; then docker logs "$boot_name"; echo "$boot_name did not become healthy within 60 s"; exit 1; fi
    sleep 1
  done
  docker rm -f "$boot_name" >/dev/null
}

# Copies a secrets dir and overwrites one key with a freshly generated value (throwaway CI use only).
rekey() {
  local src=$1 dst=$2 key=$3
  rm -rf "$dst"; mkdir -p "$dst"
  cp "$src"/* "$dst"/
  openssl rand -base64 32 > "$dst/$key"
  chmod 755 "$dst"; chmod 644 "$dst"/*
}

ops_checks() {
  local ops_vol=qm-smoke-ops-data ops_name=qm-smoke-ops
  local lk_vol=qm-smoke-lostkey-data lk_name=qm-smoke-lostkey
  local backup_out=$work/backup-out
  docker volume rm -f "$ops_vol" "$lk_vol" >/dev/null 2>&1 || true
  docker volume create "$ops_vol" >/dev/null
  docker volume create "$lk_vol" >/dev/null
  mkdir -p "$backup_out"
  # CI-only throwaway dir: the runner (uid 1001 on GitHub) owns it, and the container stays
  # uid 10001 to read /data, so the bind mount must be writable by any uid. Docker Desktop
  # ignores bind-mount ownership, which is why Windows runs passed without this. On the host,
  # the backup dir belongs to uid 10001 (backup.sh's staging chown).
  chmod 777 "$backup_out"

  # --- existence: every compiled ops CLI is in the image at its documented path ---
  for cli in audit-stats backup check-triggers grant-role login-stats lost-data-key lost-key seed; do
    code=0
    docker run --rm --entrypoint sh "$image" -c "test -f /app/scripts/ops/$cli.js" || code=$?
    assert_exit "ops CLI present: $cli.js" 0 "$code"
  done

  # --- a fresh migrated db, from booting main.js once on the ops volume ---
  boot_once "$ops_vol" "$sec" "$ops_name"

  # --- check-triggers: 0 on the fresh, unaltered db, over the three trigger sets startup checks ---
  code=0
  ct_out=$(ops_run "$ops_vol" "$sec" node scripts/ops/check-triggers.js) || code=$?
  echo "$ct_out"
  assert_exit "check-triggers (fresh db)" 0 "$code"
  grep -q "site_config_version triggers present" <<<"$ct_out" ||
    { echo "ops check failed: check-triggers did not check the site_config_version triggers (AUD-4)"; exit 1; }
  echo "ops check ok: check-triggers covers the site_config_version triggers"

  # --- audit-stats: 0 with and without --up-to, 2 on a bad --up-to ---
  code=0
  ops_run "$ops_vol" "$sec" node scripts/ops/audit-stats.js || code=$?
  assert_exit "audit-stats (no --up-to)" 0 "$code"
  code=0
  ops_run "$ops_vol" "$sec" node scripts/ops/audit-stats.js --up-to 0 || code=$?
  assert_exit "audit-stats (--up-to 0)" 0 "$code"
  code=0
  ops_run "$ops_vol" "$sec" node scripts/ops/audit-stats.js --up-to not-a-number || code=$?
  assert_exit "audit-stats (bad --up-to)" 2 "$code"

  # --- login-stats: 0 with and without --since, 2 on a bad --since ---
  code=0
  ops_run "$ops_vol" "$sec" node scripts/ops/login-stats.js || code=$?
  assert_exit "login-stats (no --since)" 0 "$code"
  code=0
  ops_run "$ops_vol" "$sec" node scripts/ops/login-stats.js --since 2026-10-01 || code=$?
  assert_exit "login-stats (--since)" 0 "$code"
  code=0
  ops_run "$ops_vol" "$sec" node scripts/ops/login-stats.js --since yesterday || code=$?
  assert_exit "login-stats (bad --since)" 2 "$code"

  # --- backup: refuses an outDir inside DATA_DIR, writes one mounted outside it ---
  code=0
  ops_run "$ops_vol" "$sec" node scripts/ops/backup.js /data/inside || code=$?
  [ "$code" != "0" ] || { echo "ops check failed: backup accepted an outDir inside DATA_DIR"; exit 1; }
  echo "ops check ok: backup inside DATA_DIR exited $code (non-zero)"
  code=0
  docker run --rm -v "$ops_vol:/data" -v "$sec:/run/secrets:ro" -v "$backup_out:/backup-out" \
    -e PUBLIC_ORIGIN=http://localhost:3000 -e ALLOW_MOCK_SOURCES=true "$image" \
    node scripts/ops/backup.js /backup-out || code=$?
  assert_exit "backup (outside DATA_DIR)" 0 "$code"
  [ -f "$backup_out/manifest.json" ] || { echo "ops check failed: backup wrote no manifest.json outside DATA_DIR"; exit 1; }

  # --- grant-role: 2 on bad args ---
  code=0
  ops_run "$ops_vol" "$sec" node scripts/ops/grant-role.js || code=$?
  assert_exit "grant-role (bad args)" 2 "$code"

  # --- drop one audit_event trigger directly, with the image's own @libsql/client, then re-check ---
  docker run --rm -v "$ops_vol:/data" -v "$sec:/run/secrets:ro" \
    -v "$PWD/scripts/ci/smoke-drop-trigger.mjs:/app/smoke-drop-trigger.mjs:ro" \
    "$image" node smoke-drop-trigger.mjs
  code=0
  ops_run "$ops_vol" "$sec" node scripts/ops/check-triggers.js || code=$?
  assert_exit "check-triggers (after dropping a trigger)" 1 "$code"

  # --- lost-key and lost-data-key: 2 without the confirm flag, 0 with it; then the app boots ---
  boot_once "$lk_vol" "$sec" "$lk_name"
  local sec_ck=$work/secrets-ck
  rekey "$sec" "$sec_ck" CREDENTIAL_KEY
  code=0
  ops_run "$lk_vol" "$sec_ck" node scripts/ops/lost-key.js || code=$?
  assert_exit "lost-key (no confirm flag)" 2 "$code"
  code=0
  ops_run "$lk_vol" "$sec_ck" node scripts/ops/lost-key.js --confirm-offline-copy-lost || code=$?
  assert_exit "lost-key (with confirm flag)" 0 "$code"

  local sec_dk=$work/secrets-dk
  rekey "$sec_ck" "$sec_dk" DATA_KEY
  code=0
  ops_run "$lk_vol" "$sec_dk" node scripts/ops/lost-data-key.js || code=$?
  assert_exit "lost-data-key (no confirm flag)" 2 "$code"
  # seed 4 request_key rows (2 requests x 2 scopes) so the runbook has something to shred (#279)
  rk_run() {
    docker run --rm -v "$lk_vol:/data" -v "$sec_dk:/run/secrets:ro" \
      -v "$PWD/scripts/ci/smoke-request-key.mjs:/app/smoke-request-key.mjs:ro" \
      "$image" node smoke-request-key.mjs "$1"
  }
  code=0
  rk_run seed || code=$?
  assert_exit "request_key seed" 0 "$code"
  code=0
  lk_out=$(ops_run "$lk_vol" "$sec_dk" node scripts/ops/lost-data-key.js --confirm-offline-copy-lost) || code=$?
  echo "$lk_out"
  assert_exit "lost-data-key (with confirm flag)" 0 "$code"
  grep -q "request_key shredded: 4 keys for 2 requests" <<<"$lk_out" ||
    { echo "ops check failed: lost-data-key did not report shredding the 4 seeded request_key rows"; exit 1; }
  echo "ops check ok: lost-data-key reported the request_key shred"
  code=0
  rk_run check || code=$?
  assert_exit "request_key shredded and audited (retentionPurged keyLost per scope)" 0 "$code"

  # the app boots on that volume under the recovered keys: both canaries verify (fail-closed startup)
  boot_once "$lk_vol" "$sec_dk" "$lk_name"
  echo "ops check ok: app boots on the recovered volume (both canaries verify)"

  docker volume rm -f "$ops_vol" "$lk_vol" >/dev/null
  rm -rf "$backup_out" "$sec_ck" "$sec_dk"
  echo "ops checks: all compiled ops CLIs verified"
}

up() {
  if [ "$build" = "--build" ]; then docker build -f deploy/Dockerfile -t "$image" .; fi
  rm -rf "$work"; mkdir -p "$sec"
  for k in DB_ENCRYPTION_KEY CREDENTIAL_KEY DATA_KEY BETTER_AUTH_SECRET SEED_PASSWORD_SECRET; do openssl rand -base64 32 > "$sec/$k"; done
  chmod 755 "$sec"; chmod 644 "$sec"/*   # throwaway CI secrets; production files are uid 10001, mode 400

  ops_checks

  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm -f "$vol" >/dev/null 2>&1 || true
  docker volume create "$vol" >/dev/null
  docker run -d --name "$name" -p 127.0.0.1:3000:3000 -v "$vol:/data" -v "$sec:/run/secrets:ro" \
    -e PUBLIC_ORIGIN=http://localhost:3000 -e ALLOW_MOCK_SOURCES=true --stop-timeout 30 "$image" >/dev/null
  for i in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then break; fi
    if [ "$i" = 60 ]; then docker logs "$name"; echo "health not ok within 60 s"; exit 1; fi
    sleep 1
  done
  [ "$(docker inspect -f '{{.Config.User}}' "$name")" = "10001" ] || { echo "container not running as uid 10001"; exit 1; }
  if docker run --rm --entrypoint sh "$image" -c 'find /app/node_modules -maxdepth 3 -name "react-native*" | grep -q .'; then
    echo "react-native found in /app/node_modules"
    exit 1
  fi
  echo "ops check ok: no react-native in /app/node_modules"
  docker exec "$name" node scripts/ops/check-triggers.js
  docker exec "$name" node scripts/ops/seed.js > "$work/seed-output.txt"
  # The container's PUBLIC_ORIGIN, not 127.0.0.1: sign-in and the WebSocket upgrade check the
  # browser's Origin against it, so CI step 12 must use this exact value.
  if [ -n "${GITHUB_ENV:-}" ]; then
    echo "QM_BASE_URL=http://localhost:3000" >> "$GITHUB_ENV"
    echo "SEED_PASSWORD_SECRET_FILE=$sec/SEED_PASSWORD_SECRET" >> "$GITHUB_ENV"
  fi
  echo "boot smoke up: health ok, triggers present, users seeded"
}

down() {
  docker kill --signal=SIGTERM "$name" >/dev/null
  code=$(timeout 30 docker wait "$name") || { echo "no exit within the 30 s grace period"; docker rm -f "$name"; exit 1; }
  docker logs "$name" > "$work/container.log" 2>&1
  for k in DB_ENCRYPTION_KEY CREDENTIAL_KEY DATA_KEY BETTER_AUTH_SECRET SEED_PASSWORD_SECRET; do
    if grep -qF "$(cat "$sec/$k")" "$work/container.log"; then echo "container log contains $k"; exit 1; fi
  done
  # Spec 8.5: seeded demo passwords print once to seed.js stdout, never to the service log.
  checked=0
  while IFS=$'\t' read -r _ _ pw; do
    [ -n "$pw" ] || continue
    # -e: a base64url password can start with "-". grep exits 2 on an error, which must fail too.
    rc=0; grep -qF -e "$pw" "$work/container.log" || rc=$?
    [ "$rc" != "0" ] || { echo "container log contains a seeded demo password"; exit 1; }
    [ "$rc" = "1" ] || { echo "password log check failed (grep exit $rc)"; exit 1; }
    checked=$((checked + 1))
  done < <(tail -n +2 "$work/seed-output.txt" | tr -d '\r')
  [ "$checked" -gt 0 ] || { echo "no seeded demo passwords to check in $work/seed-output.txt"; exit 1; }
  docker rm "$name" >/dev/null; docker volume rm "$vol" >/dev/null
  [ "$code" = "0" ] || { echo "exit code $code"; exit 1; }
  echo "boot smoke down: clean exit 0, no key material or demo password in the log"
}

case "$cmd" in
  up) up ;;
  down) down ;;
  all) up; down ;;
  *) echo "unknown command $cmd"; exit 2 ;;
esac
