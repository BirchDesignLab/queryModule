#!/usr/bin/env bash
# scripts/ops/restore-test.sh  Restore test (spec 8.6). Run at every milestone exit; record the output in docs/releases/<m>.md.
# Usage: AGE_IDENTITY=/media/offline/age-key.txt bash scripts/ops/restore-test.sh [image]
set -euo pipefail
: "${AGE_IDENTITY:?path to the offline age private key}"
: "${QM_RCLONE_REMOTE:=r2:querymodule-backups}"
: "${QM_SECRETS_DIR:=/opt/querymodule/secrets}"
image=${1:-ghcr.io/birchdesignlab/querymodule:release}
name=qm-restore-test
vol=qm-restore-test-data
work=$(mktemp -d)
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm -f "$vol" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

newest=$(rclone lsf "$QM_RCLONE_REMOTE/" --include 'qm-*.tar.age' | sort | tail -n1)
[ -n "$newest" ] || { echo "no backups in $QM_RCLONE_REMOTE"; exit 1; }
rclone copy "$QM_RCLONE_REMOTE/$newest" "$work/"
age -d -i "$AGE_IDENTITY" -o "$work/backup.tar" "$work/$newest"
tar -C "$work" -xf "$work/backup.tar"
dir=$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -n1)
want=$(jq -c '{auditCount, auditMaxId}' "$dir/manifest.json")
max=$(jq -r '.auditMaxId' "$dir/manifest.json")

# A volume left by a failed earlier cleanup must never be reused.
docker volume rm -f "$vol" >/dev/null 2>&1 || true
docker volume create "$vol" >/dev/null
docker run --rm -v "$vol:/data" -v "$dir:/src:ro" alpine:3 sh -c 'cp /src/querymodule.db* /data/ && chown -R 10001:10001 /data'
# One read-only bind mount per app secret, the set deploy/compose.yml gives `app` (#135): the
# host secrets dir is root mode 700, so uid 10001 cannot enter a mount of the whole directory,
# while each file is uid 10001 mode 400. --mount (not -v) errors on a missing source instead of
# creating an empty root-owned directory, so a missing required secret fails before the container
# starts. SEED_PASSWORD_SECRET is optional in the app (packages/api/src/secrets.ts): skipped
# with a note when absent. TUNNEL_TOKEN belongs to cloudflared and is not mounted.
secret_mounts=()
for k in DB_ENCRYPTION_KEY CREDENTIAL_KEY DATA_KEY BETTER_AUTH_SECRET SEED_PASSWORD_SECRET; do
  if [ "$k" = SEED_PASSWORD_SECRET ] && [ ! -e "$QM_SECRETS_DIR/$k" ]; then
    echo "restore-test: SEED_PASSWORD_SECRET absent, not mounted"
    continue
  fi
  secret_mounts+=(--mount "type=bind,src=$QM_SECRETS_DIR/$k,dst=/run/secrets/$k,readonly")
done
docker run -d --name "$name" -v "$vol:/data" "${secret_mounts[@]}" -e PUBLIC_ORIGIN=http://localhost:3000 "$image" >/dev/null
for i in $(seq 1 60); do
  if docker exec "$name" node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then break; fi
  if [ "$i" = 60 ]; then docker logs "$name"; echo "restored app never became healthy"; exit 1; fi
  sleep 1
done
got=$(docker exec "$name" node scripts/ops/audit-stats.js --up-to "$max" | jq -c '{auditCount, auditMaxId}')
[ "$got" = "$want" ] || { echo "audit mismatch: restored $got, manifest $want"; exit 1; }
echo "restore test ok: $newest $got"
