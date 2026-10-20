#!/usr/bin/env bash
# #829 note (EAI_AGAIN), M2 Manager 10 ruling 10-20-26: db-reset counts a DNS failure on the
# compose service name as "app stopped". This probe shows which error code a `docker compose run`
# style container gets for http://app:<port> when the app container is running, stopped, or
# absent, on a user network with the service name as a network alias (as compose sets it).
# Local Docker only; touches nothing but its own network and containers, removed at the end.
# Usage: bash scripts/ops/probe-stopped-app-dns.sh [image]   (default querymodule:local)
set -euo pipefail
IMAGE="${1:-querymodule:local}"
NET="qm-dns-probe-$$"
APP="qm-dns-probe-app-$$"
cleanup() {
  docker rm -f "$APP" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

probe() {
  # the same fetch and cause walk as probeApp in packages/api/src/ops/db-reset.ts
  # PROBE_TIMEOUT_MS: the fetch budget (probeApp uses 3000); raise it to see the DNS answer
  MSYS_NO_PATHCONV=1 docker run --rm --network "$NET" -e PROBE_TIMEOUT_MS="${PROBE_TIMEOUT_MS:-3000}"     --entrypoint node "$IMAGE" -e '
    const t = Date.now();
    fetch("http://app:3000/api/v1/health", {
      signal: AbortSignal.timeout(Number(process.env.PROBE_TIMEOUT_MS)),
    })
      .then(() => console.log("answered"))
      .catch((e) => {
        const c = e.cause;
        const list = c instanceof AggregateError ? [c, ...c.errors] : [c];
        const codes = list.map((x) => x && x.code).filter(Boolean).join(",") || "none";
        console.log(`${e.name} codes ${codes} after ${Date.now() - t} ms`);
      });'
}

docker network create "$NET" >/dev/null
docker run -d --name "$APP" --network "$NET" --network-alias app alpine:3 sleep 300 >/dev/null
echo "running (no listener on 3000): $(probe)"
docker stop -t 0 "$APP" >/dev/null
echo "stopped: $(probe)"
docker rm -f "$APP" >/dev/null
echo "absent: $(probe)"
