import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "deploy-pull.sh");

// A fake docker CLI: logs every call and answers the queries deploy-pull.sh makes.
const STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
[ "$*" != "$STUB_FAIL" ] || { echo "stub: $* failed" >&2; exit 1; }
case "$*" in
  "compose config --images app") echo "ghcr.io/example/app:release" ;;
  "image inspect -f {{.Id}} ghcr.io/example/app:release") echo "$STUB_WANT" ;;
  "compose ps -q app")
    # After "up" a container always exists, even when there was none before.
    if grep -qx "compose up -d app" "$STUB_LOG"; then echo "\${STUB_CID:-n3wc1d}"; else echo "$STUB_CID"; fi ;;
  "inspect -f {{.Image}} $STUB_CID") echo "$STUB_HAVE" ;;
  "inspect -f {{.State.Health.Status}} "*) echo healthy ;;
esac
exit 0
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qm-deploy-pull-"));
  writeFileSync(join(dir, "docker"), STUB, { mode: 0o755 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>) {
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  const r = spawnSync(
    "bash",
    ["-c", 'export PATH="$(cd "$STUB_DIR" && pwd):$PATH"; exec bash "$SCRIPT"'],
    {
      encoding: "utf8",
      timeout: 25_000,
      env: {
        ...process.env,
        STUB_DIR: dir,
        STUB_LOG: log,
        SCRIPT: script,
        STUB_CID: "c0ffee",
        ...env,
      },
    },
  );
  return { ...r, calls: readFileSync(log, "utf8").split("\n").filter(Boolean) };
}

// Each case spawns bash and a dozen stub calls; on Windows (Git Bash) under the full suite that
// takes well over vitest's 5 s default.
describe("deploy-pull.sh (ADR-0002, spec 8.3)", { timeout: 30_000 }, () => {
  it("does nothing when the running container already uses the pulled image", () => {
    const r = run({
      PUBLIC_ORIGIN: "http://127.0.0.1:9",
      STUB_WANT: "sha256:aa",
      STUB_HAVE: "sha256:aa",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/deploy-pull: no change/);
    expect(r.calls).not.toContain("compose up -d app");
  });

  it("applies the pulled image when the container runs a different one (G-I1)", () => {
    // Smoke then fails fast against a closed port, which must be logged, not silent (G-M1).
    const r = run({
      PUBLIC_ORIGIN: "http://127.0.0.1:9",
      STUB_WANT: "sha256:bb",
      STUB_HAVE: "sha256:aa",
    });
    expect(r.calls).toContain("compose pull app");
    expect(r.calls).toContain("compose up -d app");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/deploy-pull: FAILED app -> sha256:bb/);
  });

  it("applies when no app container exists yet", () => {
    const r = run({
      PUBLIC_ORIGIN: "http://127.0.0.1:9",
      STUB_WANT: "sha256:bb",
      STUB_CID: "",
      STUB_HAVE: "",
    });
    expect(r.calls).toContain("compose up -d app");
  });

  it("refuses to run without PUBLIC_ORIGIN, before pulling (G-M2)", () => {
    const r = run({ PUBLIC_ORIGIN: "", STUB_WANT: "sha256:bb", STUB_HAVE: "sha256:aa" });
    expect(r.status).not.toBe(0);
    expect(r.calls).not.toContain("compose pull app");
  });

  it.each([
    ["pull", "compose pull app"],
    ["config", "compose config --images app"],
    ["inspect", "image inspect -f {{.Id}} ghcr.io/example/app:release"],
  ])("logs exactly one FAILED %s line and exits non-zero when that step fails", (step, fail) => {
    const r = run({
      PUBLIC_ORIGIN: "http://127.0.0.1:9",
      STUB_WANT: "sha256:bb",
      STUB_HAVE: "sha256:aa",
      STUB_FAIL: fail,
    });
    expect(r.status).not.toBe(0);
    const failed = r.stdout.split("\n").filter((l) => l.includes("deploy-pull: FAILED"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(new RegExp(`deploy-pull: FAILED ${step}$`));
  });

  it("logs no FAILED line on a clean run", () => {
    const r = run({
      PUBLIC_ORIGIN: "http://127.0.0.1:9",
      STUB_WANT: "sha256:aa",
      STUB_HAVE: "sha256:aa",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("FAILED");
  });
});
