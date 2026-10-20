#!/usr/bin/env bash
# #829 note (EAI_AGAIN), M2 Manager 10 ruling 10-20-26: db-reset counts a name that does not
# resolve as "app stopped". This probe shows what `docker compose run --rm app` gets for
# http://app:<port> when the app service is up, stopped, or removed, on a compose project network
# (the service name resolves through compose's own DNS, as on the deploy host). The app service
# runs the image with `sleep` instead of the server, so "up" has no listener (ECONNREFUSED).
# Local Docker only; it touches nothing but its own throwaway compose project, removed at the end.
# Usage: bash scripts/ops/probe-stopped-app-dns.sh [image]   (default querymodule:local)
#   PROBE_TIMEOUT_MS: the fetch budget (probeApp's HTTP budget is 3000); raise it to see the answer
set -euo pipefail
IMAGE="${1:-querymodule:local}"
DIR="$(mktemp -d)"
PROJECT="qm-dns-probe-$$"
CFILE="$DIR/compose.yml"
# Git Bash on Windows: Docker needs the Windows form of the temp path
if command -v cygpath >/dev/null; then CFILE="$(cygpath -w "$CFILE")"; fi
compose() { docker compose -p "$PROJECT" -f "$CFILE" "$@"; }
cleanup() {
  compose down -t 0 --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT

cat >"$DIR/compose.yml" <<EOF
services:
  app:
    image: $IMAGE
    entrypoint: ["sleep", "300"]
EOF

# the same fetch and cause walk as probeApp in packages/api/src/ops/db-reset.ts, plus timings
probe() {
  MSYS_NO_PATHCONV=1 compose run --rm --no-deps -e PROBE_TIMEOUT_MS="${PROBE_TIMEOUT_MS:-3000}" \
    --entrypoint node app -e '
    const t = Date.now();
    require("node:dns/promises").lookup("app").then(
      () => console.log(`lookup found after ${Date.now() - t} ms`),
      (e) => console.log(`lookup ${e.code} after ${Date.now() - t} ms`),
    ).then(() => {
      const f = Date.now();
      return fetch("http://app:3000/api/v1/health", {
        signal: AbortSignal.timeout(Number(process.env.PROBE_TIMEOUT_MS)),
      })
        .then(() => console.log("fetch answered"))
        .catch((e) => {
          const c = e.cause;
          const list = c instanceof AggregateError ? [c, ...c.errors] : [c];
          const codes = list.map((x) => x && x.code).filter(Boolean).join(",") || "none";
          console.log(`fetch ${e.name} codes ${codes} after ${Date.now() - f} ms`);
        });
    });' | tr '\n' ' '
}

compose up -d app >/dev/null 2>&1
echo "up (no listener on 3000): $(probe)"
compose stop -t 0 app >/dev/null 2>&1
echo "stopped: $(probe)"
compose rm -f app >/dev/null 2>&1
echo "removed: $(probe)"
