import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
# age -d -i <identity> -o <out> <in>: the identity path must hold the real key (so a leak of its
# contents would be possible), checked here without echoing it.
[ "$(cat "$3")" = "AGE-SECRET-KEY-TEST" ] || { echo "age: identity is not the test key" >&2; exit 3; }
[ -z "\${STUB_AGE_FAIL:-}" ] || { echo "age: decryption failed" >&2; exit 1; }
cp "$6" "$5"
`;
const DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
# The app container's arguments, one per line, so mounts can be checked exactly.
if [ "$1 $2" = "run -d" ]; then
  printf '%s\\n' "$@" > "$STUB_LOG.run-d"
  # Like Docker: a --mount bind whose source is missing fails before the container starts.
  for a in "$@"; do
    case "$a" in
      type=bind,src=*)
        src=\${a#type=bind,src=}; src=\${src%%,*}
        [ -n "\${STUB_NO_BIND_CHECK:-}" ] || [ -e "$src" ] || { echo "docker: bind source path does not exist: $src" >&2; exit 125; } ;;
    esac
  done
fi
if [ "$1 $2" = "volume rm" ] && [ -n "\${STUB_VOLRM_FAIL:-}" ]; then
  echo "Error response from daemon: volume is in use" >&2
  exit 1
fi
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

const AGE_KEY = "AGE-SECRET-KEY-TEST";
const REQUIRED_SECRETS = ["DB_ENCRYPTION_KEY", "CREDENTIAL_KEY", "DATA_KEY", "BETTER_AUTH_SECRET"];
const ALL_SECRETS = [...REQUIRED_SECRETS, "SEED_PASSWORD_SECRET"];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qm-restore-test-"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "bucket"));
  for (const [n, s] of Object.entries({ rclone: RCLONE, age: AGE, docker: DOCKER, jq: JQ }))
    writeFileSync(join(dir, "bin", n), s, { mode: 0o755 });
  writeFileSync(join(dir, "age-key.txt"), AGE_KEY);
  mkdirSync(join(dir, "secrets"));
  for (const k of ALL_SECRETS)
    writeFileSync(
      join(dir, "secrets", k),
      `fake-${k}
`,
    );
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
    expect(app).toContain("-e ALLOW_MOCK_SOURCES=true");
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

  const okEnv = () => ({
    AGE_IDENTITY: join(dir, "age-key.txt"),
    STUB_AUDIT: '{"auditCount":3,"auditMaxId":7}',
  });
  const runArgs = () =>
    readFileSync(join(dir, "calls.log.run-d"), "utf8").split("\n").filter(Boolean);
  const bindMounts = (args: string[]) => args.filter((_, i) => args[i - 1] === "--mount");

  it("removes a leftover volume before creating a fresh one (T32 G-M1)", () => {
    backup("20260928T020000Z", 3, 7);
    const r = run(okEnv());
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const rm = r.calls.indexOf("docker volume rm -f qm-restore-test-data");
    const create = r.calls.indexOf("docker volume create qm-restore-test-data");
    expect(rm).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(rm);
  });

  it("removes a leftover container, then the volume, and aborts before create when volume rm fails (Q1)", () => {
    backup("20260928T020000Z", 3, 7);
    const ok = run(okEnv());
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    const cont = ok.calls.indexOf("docker rm -f qm-restore-test");
    expect(cont).toBeGreaterThan(-1);
    expect(cont).toBeLessThan(ok.calls.indexOf("docker volume rm -f qm-restore-test-data"));
    const r = run({ ...okEnv(), STUB_VOLRM_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("volume is in use");
    expect(r.calls.some((c) => c.startsWith("docker volume create"))).toBe(false);
    expect(r.stdout).not.toContain("restore test ok");
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "mounts SEED_PASSWORD_SECRET when the secrets dir is not searchable by the caller (C1)",
    () => {
      backup("20260928T020000Z", 3, 7);
      const secrets = join(dir, "secrets");
      chmodSync(secrets, 0o000);
      try {
        const r = run({ ...okEnv(), STUB_NO_BIND_CHECK: "1" });
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(r.stdout + r.stderr).not.toContain("SEED_PASSWORD_SECRET absent");
        expect(bindMounts(runArgs())).toContain(
          `type=bind,src=${secrets}/SEED_PASSWORD_SECRET,dst=/run/secrets/SEED_PASSWORD_SECRET,readonly`,
        );
      } finally {
        chmodSync(secrets, 0o700);
      }
    },
  );

  it("#135, T32 G-M2: mounts each app secret file read-only, as compose does, never the directory", () => {
    // The host secrets dir is root mode 700: uid 10001 cannot enter a directory mount of it,
    // but a per-file bind mount of a uid 10001 mode 400 file is readable (deploy/compose.yml).
    const compose = readFileSync(resolve(import.meta.dirname, "../../deploy/compose.yml"), "utf8");
    const names = compose
      .match(/^ {4}secrets: \[([^\]]+)\]/m)?.[1]
      ?.split(",")
      .map((n) => n.trim());
    expect(names).toEqual(ALL_SECRETS);
    backup("20260928T020000Z", 3, 7);
    const r = run(okEnv());
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const args = runArgs();
    const secrets = join(dir, "secrets");
    expect(bindMounts(args).sort()).toEqual(
      (names ?? [])
        .map((n) => `type=bind,src=${secrets}/${n},dst=/run/secrets/${n},readonly`)
        .sort(),
    );
    // No -v/--volume flag reaches a secrets path, and no mount names the directory itself.
    expect(
      args.filter((_, i) => args[i - 1] === "-v").some((m) => m.includes("/run/secrets")),
    ).toBe(false);
    expect(args.some((a) => a.includes(`src=${secrets},`) || a.startsWith(`${secrets}:`))).toBe(
      false,
    );
    expect(args.join(" ")).not.toContain("TUNNEL_TOKEN");
  });

  it("treats a directory named SEED_PASSWORD_SECRET as absent, not as a file to mount (#315)", () => {
    rmSync(join(dir, "secrets", "SEED_PASSWORD_SECRET"));
    mkdirSync(join(dir, "secrets", "SEED_PASSWORD_SECRET"));
    backup("20260928T020000Z", 3, 7);
    const r = run(okEnv());
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toContain("restore-test: SEED_PASSWORD_SECRET absent, not mounted");
    expect(runArgs().join(" ")).not.toContain("SEED_PASSWORD_SECRET");
  });

  it("says so when cleanup cannot remove the volume, instead of hiding the daemon error (#315)", () => {
    backup("20260928T020000Z", 3, 7);
    const r = run({ ...okEnv(), STUB_VOLRM_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("restore-test: could not remove volume qm-restore-test-data");
    // The daemon's own message still reaches stderr (it is not sent to /dev/null).
    expect(r.stderr).toContain("volume is in use");
  });

  it("skips the optional SEED_PASSWORD_SECRET with a note when its file is absent (M1)", () => {
    rmSync(join(dir, "secrets", "SEED_PASSWORD_SECRET"));
    backup("20260928T020000Z", 3, 7);
    const r = run(okEnv());
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toContain("restore-test: SEED_PASSWORD_SECRET absent, not mounted");
    expect(bindMounts(runArgs())).toHaveLength(4);
    expect(runArgs().join(" ")).not.toContain("SEED_PASSWORD_SECRET");
  });

  it("fails before the container starts when a required secret file is absent (M1)", () => {
    rmSync(join(dir, "secrets", "DATA_KEY"));
    backup("20260928T020000Z", 3, 7);
    const r = run(okEnv());
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("bind source path does not exist");
    expect(r.stdout).not.toContain("restore test ok");
    expect(r.calls.some((c) => c.startsWith("docker exec"))).toBe(false);
  });

  it("never prints the age key's contents or passes them in any argument (T32 G-M2)", () => {
    backup("20260928T020000Z", 3, 7);
    const r = run(okEnv());
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const everything = [r.stdout, r.stderr, ...r.calls, runArgs().join("\n")].join("\n");
    expect(everything).not.toContain(AGE_KEY);
    // The key is passed by path only.
    expect(r.calls.some((c) => c.includes(`age -d -i ${join(dir, "age-key.txt")} `))).toBe(true);
  });

  const workDirOf = (calls: string[]) =>
    dirname(calls.find((c) => c.startsWith("age -d "))?.match(/ -o (\S+)/)?.[1] ?? "");

  it("removes the work dir holding the decrypted tar on success (T32 G-M3)", () => {
    backup("20260928T020000Z", 3, 7);
    const r = run(okEnv());
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const work = workDirOf(r.calls);
    expect(work).not.toBe(".");
    expect(existsSync(work)).toBe(false);
  });

  it("removes the work dir when age fails midway (T32 G-M3)", () => {
    backup("20260928T020000Z", 3, 7);
    const r = run({ ...okEnv(), STUB_AGE_FAIL: "1" });
    expect(r.status).not.toBe(0);
    const work = workDirOf(r.calls);
    expect(work).not.toBe(".");
    expect(existsSync(work)).toBe(false);
  });
});
