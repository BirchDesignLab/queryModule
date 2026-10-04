import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "backup.sh");

// Fake rclone, age and docker on PATH. Every call is logged; `rclone version` prints
// $STUB_RCLONE_VERSION as its first line, like the real one.
const RCLONE = `#!/usr/bin/env bash
echo "rclone $*" >> "$STUB_LOG"
if [ "$1" = "version" ]; then printf 'rclone %s\\n- os/type: linux\\n' "$STUB_RCLONE_VERSION"; fi
exit 0
`;
const AGE = `#!/usr/bin/env bash
echo "age $*" >> "$STUB_LOG"
exit 0
`;
const DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
exit 0
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qm-backup-test-"));
  mkdirSync(join(dir, "bin"));
  for (const [n, s] of Object.entries({ rclone: RCLONE, age: AGE, docker: DOCKER }))
    writeFileSync(join(dir, "bin", n), s, { mode: 0o755 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(version: string) {
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  const r = spawnSync(
    "bash",
    ["-c", 'export PATH="$(cd "$STUB_BIN" && pwd):$PATH"; exec bash "$SCRIPT"'],
    {
      encoding: "utf8",
      timeout: 25_000,
      env: {
        ...process.env,
        STUB_BIN: join(dir, "bin"),
        STUB_LOG: log,
        STUB_RCLONE_VERSION: version,
        SCRIPT: script,
        QM_RCLONE_REMOTE: "r2:test-bucket",
        QM_AGE_RECIPIENT_FILE: join(dir, "recipient.txt"),
      },
    },
  );
  return { ...r, calls: readFileSync(log, "utf8").split("\n").filter(Boolean) };
}

describe("backup.sh rclone preflight (#487: Ubuntu's rclone 1.60 gets a 501 from R2 on its first PUT)", () => {
  it("refuses rclone older than 1.65 before any backup step, naming the version", () => {
    const r = run("v1.60.1-DEV");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/rclone v1\.60\.1-DEV is older than 1\.65/);
    expect(r.calls).toEqual(["rclone version"]);
  });

  it("refuses an rclone version it cannot read", () => {
    const r = run("unknown");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/cannot read the rclone version/);
    expect(r.calls).toEqual(["rclone version"]);
  });

  it.each(["v1.65.0", "v1.75.1", "v2.0.0"])("runs the backup on rclone %s", (version) => {
    const r = run(version);
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls[0]).toBe("rclone version");
    expect(r.calls.some((c) => c.startsWith("rclone copy "))).toBe(true);
  });
});
