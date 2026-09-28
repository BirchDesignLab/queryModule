import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "restore-test.sh");

// Fake rclone, age, docker and jq on PATH. Every call is logged; the backups "bucket" is
// $STUB_BUCKET, and an "encrypted" backup is the plain tar (age -d copies it).
const RCLONE = `#!/usr/bin/env bash
echo "rclone $*" >> "$STUB_LOG"
case "$1" in
  lsf) ls "$STUB_BUCKET" | sort -r ;; # newest first, so the script must sort
  copy) cp "$STUB_BUCKET/\${2##*/}" "$3" ;;
esac
`;
const AGE = `#!/usr/bin/env bash
echo "age $*" >> "$STUB_LOG"
# age -d -i <identity> -o <out> <in>
cp "$6" "$5"
`;
const DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
case "$*" in
  *"audit-stats.js --up-to"*) echo "$STUB_AUDIT" ;;
esac
exit 0
`;
// Just the two filters restore-test.sh uses: -c '{auditCount, auditMaxId}' and -r '.auditMaxId'.
const JQ = `#!/usr/bin/env bash
exec node -e '
const [flag, filter, file] = process.argv.slice(1);
const src = file ? require("fs").readFileSync(file, "utf8") : require("fs").readFileSync(0, "utf8");
const j = JSON.parse(src);
if (filter === ".auditMaxId") console.log(j.auditMaxId);
else console.log(JSON.stringify({ auditCount: j.auditCount, auditMaxId: j.auditMaxId }));
' -- "$@"
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qm-restore-test-"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "bucket"));
  for (const [n, s] of Object.entries({ rclone: RCLONE, age: AGE, docker: DOCKER, jq: JQ }))
    writeFileSync(join(dir, "bin", n), s, { mode: 0o755 });
  writeFileSync(join(dir, "age-key.txt"), "AGE-SECRET-KEY-TEST");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Puts qm-<stamp>.tar.age in the bucket: a tar of <stamp>/ holding the db and manifest. */
function backup(stamp: string, auditCount: number, auditMaxId: number) {
  const src = join(dir, "src");
  mkdirSync(join(src, stamp), { recursive: true });
  writeFileSync(join(src, stamp, "querymodule.db"), "not a real database");
  writeFileSync(
    join(src, stamp, "manifest.json"),
    JSON.stringify({ files: [], auditCount, auditMaxId }),
  );
  const r = spawnSync(
    "bash",
    ["-c", 'tar -C "$1" -cf "$2" "$3"', "_", src, `qm-${stamp}.tar`, stamp],
    {
      cwd: join(dir, "bucket"),
      encoding: "utf8",
    },
  );
  expect(r.status, r.stderr).toBe(0);
  rmSync(join(src, stamp), { recursive: true, force: true });
  spawnSync("bash", ["-c", 'mv "$1" "$1.age"', "_", `qm-${stamp}.tar`], {
    cwd: join(dir, "bucket"),
  });
}

function run(env: Record<string, string>) {
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  const r = spawnSync(
    "bash",
    [
      "-c",
      'export PATH="$(cd "$STUB_BIN" && pwd):$PATH"; exec bash "$SCRIPT" "$@"',
      "_",
      "qm:test",
    ],
    {
      encoding: "utf8",
      timeout: 25_000,
      env: {
        ...process.env,
        STUB_BIN: join(dir, "bin"),
        STUB_BUCKET: join(dir, "bucket"),
        STUB_LOG: log,
        SCRIPT: script,
        QM_RCLONE_REMOTE: "r2:test-bucket",
        QM_SECRETS_DIR: join(dir, "secrets"),
        ...env,
      },
    },
  );
  return { ...r, calls: readFileSync(log, "utf8").split("\n").filter(Boolean) };
}

// Each case spawns bash and several stubs; Git Bash under the full suite needs well over 5 s.
describe("restore-test.sh (spec 8.6, NFR-003, SEC-010)", { timeout: 30_000 }, () => {
  it("refuses to run without AGE_IDENTITY", () => {
    const r = run({});
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("AGE_IDENTITY");
    expect(r.calls).toEqual([]);
  });

  it("fails when the bucket holds no backup", () => {
    const r = run({ AGE_IDENTITY: join(dir, "age-key.txt") });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no backups in r2:test-bucket");
  });

  it("restores the newest backup, compares audit rows up to the manifest's max id, and cleans up", () => {
    backup("20260926T020000Z", 1, 2);
    backup("20260928T020000Z", 3, 7);
    backup("20260927T020000Z", 2, 5);
    const r = run({
      AGE_IDENTITY: join(dir, "age-key.txt"),
      STUB_AUDIT: '{"auditCount":3,"auditMaxId":7}',
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(
      'restore test ok: qm-20260928T020000Z.tar.age {"auditCount":3,"auditMaxId":7}',
    );
    const copy = r.calls.find((c) => c.startsWith("rclone copy "));
    expect(copy).toMatch(/^rclone copy r2:test-bucket\/qm-20260928T020000Z\.tar\.age /);
    expect(r.calls.some((c) => c.includes(`age -d -i ${join(dir, "age-key.txt")}`))).toBe(true);
    const app = r.calls.find((c) => c.startsWith("docker run -d --name qm-restore-test "));
    expect(app, "no app container started").toBeDefined();
    expect(app).toContain("qm:test");
    expect(app).not.toMatch(/ -p | --publish/);
    expect(r.calls).toContain(
      "docker exec qm-restore-test node scripts/ops/audit-stats.js --up-to 7",
    );
    expect(r.calls).toContain("docker rm -f qm-restore-test");
    expect(r.calls).toContain("docker volume rm -f qm-restore-test-data");
  });

  it("fails when the restored audit rows differ from the manifest", () => {
    backup("20260928T020000Z", 3, 7);
    const r = run({
      AGE_IDENTITY: join(dir, "age-key.txt"),
      STUB_AUDIT: '{"auditCount":2,"auditMaxId":7}',
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      'audit mismatch: restored {"auditCount":2,"auditMaxId":7}, manifest {"auditCount":3,"auditMaxId":7}',
    );
    expect(r.calls).toContain("docker rm -f qm-restore-test");
  });
});
