#!/usr/bin/env bash
# scripts/ops/backup.sh  Nightly off-box backup (spec 8.6). Runs on the laptop from the systemd user timer.
# 1 online copy into a staging volume (never /data)  2 age-encrypt to the recipient  3 rclone upload  4 prune > 30 days
set -euo pipefail
: "${QM_AGE_RECIPIENT_FILE:=/opt/querymodule/backup/age-recipient.txt}"
: "${QM_RCLONE_REMOTE:=r2:querymodule-backups}"
# Preflight (#487): Ubuntu's packaged rclone 1.60 gets a 501 NotImplemented from R2 on its first
# PUT and passes only on retry; refuse anything older than 1.65 (install from rclone.org).
rclone_version=$(rclone version | awk 'NR==1 {print $2}')
if [[ ! "$rclone_version" =~ ^v([0-9]+)\.([0-9]+) ]]; then
  echo "backup: cannot read the rclone version ($rclone_version)" >&2
  exit 1
fi
if (( BASH_REMATCH[1] < 1 || (BASH_REMATCH[1] == 1 && BASH_REMATCH[2] < 65) )); then
  echo "backup: rclone $rclone_version is older than 1.65; install a current rclone from rclone.org (docs/deploy.md)" >&2
  exit 1
fi
cd "$(dirname "$0")/../../deploy"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d)
cleanup() {
  rm -rf "$work"
  docker run --rm -v qm-backup-staging:/backup alpine:3 rm -rf "/backup/$stamp" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create qm-backup-staging >/dev/null
docker run --rm -v qm-backup-staging:/backup alpine:3 chown 10001:10001 /backup
docker compose run --rm --no-deps -v qm-backup-staging:/backup app node scripts/ops/backup.js "/backup/$stamp"
docker run --rm -v qm-backup-staging:/backup -v "$work:/out" alpine:3 tar -C /backup -cf "/out/$stamp.tar" "$stamp"
age -R "$QM_AGE_RECIPIENT_FILE" -o "$work/qm-$stamp.tar.age" "$work/$stamp.tar"
rclone copy "$work/qm-$stamp.tar.age" "$QM_RCLONE_REMOTE/"
rclone delete --min-age 30d --include 'qm-*.tar.age' "$QM_RCLONE_REMOTE/"
echo "backup qm-$stamp.tar.age uploaded to $QM_RCLONE_REMOTE"
