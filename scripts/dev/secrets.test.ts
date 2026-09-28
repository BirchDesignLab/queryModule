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
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, SECRET_NAMES[0])).mode & 0o777).toBe(0o600);
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
