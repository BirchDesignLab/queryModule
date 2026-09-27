import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSecrets, SecretConfigError } from "../src/secrets";

const k = (fill: number) => Buffer.alloc(32, fill).toString("base64");
function dir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "qm-secrets-"));
  for (const [n, v] of Object.entries(files)) writeFileSync(join(d, n), `${v}\n`);
  return d;
}
const good = {
  DB_ENCRYPTION_KEY: k(1),
  CREDENTIAL_KEY: k(2),
  DATA_KEY: k(3),
  BETTER_AUTH_SECRET: k(4),
};

describe("SEC-006 loadSecrets", () => {
  it("reads and trims files", async () => {
    const s = await loadSecrets({}, dir(good));
    expect(s.credentialKey.length).toBe(32);
    expect(s.dbEncryptionKey).toBe(good.DB_ENCRYPTION_KEY);
    expect(s.seedPasswordSecret).toBeNull();
  });
  it("honours <NAME>_FILE", async () => {
    const other = dir({ DATA_KEY: k(9) });
    const s = await loadSecrets({ DATA_KEY_FILE: join(other, "DATA_KEY") }, dir(good));
    expect(s.dataKey.equals(Buffer.alloc(32, 9))).toBe(true);
  });
  it.each(["DB_ENCRYPTION_KEY", "CREDENTIAL_KEY", "DATA_KEY", "BETTER_AUTH_SECRET"])(
    "fails closed when %s is missing",
    async (name) => {
      const files: Record<string, string> = { ...good };
      delete files[name];
      await expect(loadSecrets({}, dir(files))).rejects.toThrow(SecretConfigError);
    },
  );
  it("rejects a malformed key without echoing it", async () => {
    const err = await loadSecrets({}, dir({ ...good, CREDENTIAL_KEY: "c2hvcnQ=" })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SecretConfigError);
    expect(String((err as Error).message)).not.toContain("c2hvcnQ=");
  });
  it("rejects reused keys", async () => {
    await expect(loadSecrets({}, dir({ ...good, DATA_KEY: good.CREDENTIAL_KEY }))).rejects.toThrow(
      /distinct/,
    );
  });
  it("ignores a secret value placed directly in the environment", async () => {
    const files: Record<string, string> = { ...good };
    delete files.DATA_KEY;
    await expect(loadSecrets({ DATA_KEY: k(3) }, dir(files))).rejects.toThrow(SecretConfigError);
  });
});
