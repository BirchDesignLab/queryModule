import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Secrets {
  dbEncryptionKey: string;
  credentialKey: Buffer;
  dataKey: Buffer;
  betterAuthSecret: string;
  seedPasswordSecret: string | null;
}
export class SecretConfigError extends Error {
  constructor(
    readonly secret: string,
    reason: string,
  ) {
    super(`secret ${secret}: ${reason}`);
    this.name = "SecretConfigError";
  }
}

export async function readSecretFile(
  name: string,
  env: NodeJS.ProcessEnv,
  secretsDir: string,
  required: boolean,
): Promise<string | null> {
  const path = env[`${name}_FILE`] ?? join(secretsDir, name);
  let v: string;
  try {
    v = (await readFile(path, "utf8")).trim();
  } catch {
    if (!required) return null;
    throw new SecretConfigError(name, `file not readable at ${path}`);
  }
  if (v.length === 0) throw new SecretConfigError(name, "file is empty");
  return v;
}

function key32(name: string, value: string): Buffer {
  const b = Buffer.from(value, "base64");
  if (b.length !== 32 || b.toString("base64") !== value)
    throw new SecretConfigError(name, "must be 32 bytes, base64");
  return b;
}

export async function loadSecrets(env: NodeJS.ProcessEnv, secretsDir: string): Promise<Secrets> {
  const req = async (n: string) => (await readSecretFile(n, env, secretsDir, true)) as string;
  const dbEncryptionKey = await req("DB_ENCRYPTION_KEY");
  const credentialRaw = await req("CREDENTIAL_KEY");
  const dataRaw = await req("DATA_KEY");
  const betterAuthSecret = await req("BETTER_AUTH_SECRET");
  const seedPasswordSecret = await readSecretFile("SEED_PASSWORD_SECRET", env, secretsDir, false);
  if (dbEncryptionKey.length < 32)
    throw new SecretConfigError("DB_ENCRYPTION_KEY", "must be at least 32 characters");
  if (betterAuthSecret.length < 32)
    throw new SecretConfigError("BETTER_AUTH_SECRET", "must be at least 32 characters");
  const credentialKey = key32("CREDENTIAL_KEY", credentialRaw);
  const dataKey = key32("DATA_KEY", dataRaw);
  if (new Set([dbEncryptionKey, credentialRaw, dataRaw]).size !== 3) {
    throw new SecretConfigError(
      "DB_ENCRYPTION_KEY,CREDENTIAL_KEY,DATA_KEY",
      "keys must be distinct",
    );
  }
  return { dbEncryptionKey, credentialKey, dataKey, betterAuthSecret, seedPasswordSecret };
}
