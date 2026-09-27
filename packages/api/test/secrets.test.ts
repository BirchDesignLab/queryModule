import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSecrets, readSecretFile, SecretConfigError } from "../src/secrets";

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
  it.each(["DB_ENCRYPTION_KEY", "BETTER_AUTH_SECRET"])(
    "fails closed when %s is shorter than 32 characters, without echoing it",
    async (name) => {
      const short = "x".repeat(31);
      const err = await loadSecrets({}, dir({ ...good, [name]: short })).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SecretConfigError);
      expect((err as SecretConfigError).secret).toBe(name);
      expect((err as Error).message).toContain(name);
      expect((err as Error).message).not.toContain(short);
    },
  );
  it("fails closed on an empty (whitespace-only) secret file", async () => {
    const err = await loadSecrets({}, dir({ ...good, DB_ENCRYPTION_KEY: "  \n " })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SecretConfigError);
    expect((err as Error).message).toContain("DB_ENCRYPTION_KEY");
    expect((err as Error).message).toContain("empty");
  });
  it("returns SEED_PASSWORD_SECRET when present", async () => {
    const s = await loadSecrets({}, dir({ ...good, SEED_PASSWORD_SECRET: k(5) }));
    expect(s.seedPasswordSecret).toBe(k(5));
  });
  it("fails closed when SEED_PASSWORD_SECRET is shorter than 32 characters, without echoing it", async () => {
    const short = "seed-secret-value";
    const err = await loadSecrets({}, dir({ ...good, SEED_PASSWORD_SECRET: short })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SecretConfigError);
    expect((err as SecretConfigError).secret).toBe("SEED_PASSWORD_SECRET");
    expect((err as Error).message).not.toContain(short);
  });
  it("fails closed when an explicitly configured optional secret file is missing", async () => {
    const missing = join(dir({}), "nope");
    const err = await loadSecrets({ SEED_PASSWORD_SECRET_FILE: missing }, dir(good)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SecretConfigError);
    expect((err as SecretConfigError).secret).toBe("SEED_PASSWORD_SECRET");
  });
  it("fails closed when the default optional secret path exists but is unreadable", async () => {
    const d = dir(good);
    mkdirSync(join(d, "SEED_PASSWORD_SECRET"));
    await expect(loadSecrets({}, d)).rejects.toThrow(/SEED_PASSWORD_SECRET/);
    await expect(readSecretFile("SEED_PASSWORD_SECRET", {}, d, false)).rejects.toThrow(
      SecretConfigError,
    );
  });
  it("rejects a secrets dir inside the data dir, naming the secret only", async () => {
    const data = dir(good);
    const err = await loadSecrets({ DATA_DIR: data }, data).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SecretConfigError);
    expect((err as SecretConfigError).secret).toBe("DB_ENCRYPTION_KEY");
    expect((err as Error).message).toMatch(/data dir/);
    expect((err as Error).message).not.toContain(good.DB_ENCRYPTION_KEY);
  });
  it("rejects a <NAME>_FILE under the data dir, including through a symlink", async () => {
    const data = dir({});
    const sub = join(data, "keys");
    mkdirSync(sub);
    writeFileSync(join(sub, "DB_ENCRYPTION_KEY"), good.DB_ENCRYPTION_KEY);
    const direct = { DATA_DIR: data, DB_ENCRYPTION_KEY_FILE: join(sub, "DB_ENCRYPTION_KEY") };
    await expect(loadSecrets(direct, dir(good))).rejects.toThrow(/DB_ENCRYPTION_KEY.*data dir/);
    const link = join(dir({}), "link");
    symlinkSync(join(sub, "DB_ENCRYPTION_KEY"), link);
    await expect(
      loadSecrets({ DATA_DIR: data, DB_ENCRYPTION_KEY_FILE: link }, dir(good)),
    ).rejects.toThrow(/DB_ENCRYPTION_KEY.*data dir/);
  });
  it("rejects a data dir file whose name starts with two dots", async () => {
    const data = dir({ "..DB_ENCRYPTION_KEY": good.DB_ENCRYPTION_KEY });
    const env = { DATA_DIR: data, DB_ENCRYPTION_KEY_FILE: join(data, "..DB_ENCRYPTION_KEY") };
    await expect(loadSecrets(env, dir(good))).rejects.toThrow(/data dir/);
  });
  it("accepts a sibling of the data dir that only shares its prefix", async () => {
    const secrets = dir(good);
    const s = await loadSecrets({ DATA_DIR: secrets.slice(0, -1) }, secrets);
    expect(s.dbEncryptionKey).toBe(good.DB_ENCRYPTION_KEY);
  });
  it("ignores a secret value placed directly in the environment", async () => {
    const files: Record<string, string> = { ...good };
    delete files.DATA_KEY;
    await expect(loadSecrets({ DATA_KEY: k(3) }, dir(files))).rejects.toThrow(SecretConfigError);
  });
});
