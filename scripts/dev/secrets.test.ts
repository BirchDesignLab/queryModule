import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDevSecrets, SECRET_NAMES } from "./secrets.ts";

describe("ensureDevSecrets: generated dev-only secret files (#124)", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("creates every named secret file under the given directory", () => {
    dir = join(mkdtempSync(join(tmpdir(), "qm-dev-secrets-")), "secrets");
    ensureDevSecrets(dir);
    for (const name of SECRET_NAMES) {
      const file = join(dir, name);
      expect(existsSync(file)).toBe(true);
      const value = readFileSync(file, "utf8").trim();
      // 32 random bytes, base64-encoded: never empty, never a real credential.
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("restricts the directory and file permissions to the owner", () => {
    dir = join(mkdtempSync(join(tmpdir(), "qm-dev-secrets-")), "secrets");
    ensureDevSecrets(dir);
    const dirMode = statSync(dir).mode & 0o777;
    const fileMode = statSync(join(dir, SECRET_NAMES[0])).mode & 0o777;
    if (process.platform === "win32") {
      // NTFS has no POSIX group/other permission bits; Node's fs mode on Windows collapses to a
      // single read-only attribute, so mkdirSync/writeFileSync's `mode: 0o700`/`0o600` reads back
      // as something like 0o666, not exact POSIX equality. The only thing Windows can actually
      // express here is "not marked read-only" (owner read+write present); assert that instead of
      // an exact mode this filesystem cannot represent.
      expect(dirMode & 0o600).toBe(0o600);
      expect(fileMode & 0o600).toBe(0o600);
    } else {
      expect(dirMode).toBe(0o700);
      expect(fileMode).toBe(0o600);
    }
  });

  it("never overwrites a secret that already exists (stable across dev restarts)", () => {
    dir = join(mkdtempSync(join(tmpdir(), "qm-dev-secrets-")), "secrets");
    ensureDevSecrets(dir);
    const first = readFileSync(join(dir, "DB_ENCRYPTION_KEY"), "utf8");
    ensureDevSecrets(dir);
    const second = readFileSync(join(dir, "DB_ENCRYPTION_KEY"), "utf8");
    expect(second).toBe(first);
  });
});
