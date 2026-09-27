import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

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

/** Spec 5.5, 8.2: no secret may live on the data dir; defaults to /data like env.ts (Task 3). */
async function dataDirOf(env: NodeJS.ProcessEnv): Promise<string> {
  const dataDir = resolve(env.DATA_DIR ?? "/data");
  return realpath(dataDir).catch(() => dataDir);
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export async function readSecretFile(
  name: string,
  env: NodeJS.ProcessEnv,
  secretsDir: string,
  required: boolean,
): Promise<string | null> {
  const explicit = env[`${name}_FILE`];
  const path = resolve(explicit ?? join(secretsDir, name));
  let real: string;
  let v: string;
  try {
    real = await realpath(path);
    if (isInside(real, await dataDirOf(env))) {
      throw new SecretConfigError(name, "file must not be inside the data dir");
    }
    v = (await readFile(real, "utf8")).trim();
  } catch (err) {
    if (err instanceof SecretConfigError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    // Fail closed (spec 8.1): only an optional secret whose default file is absent may be null.
    if (!required && explicit === undefined && code === "ENOENT") return null;
    throw new SecretConfigError(name, `file not readable at ${path} (${String(code)})`);
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
  // Optional, but when present it keys the seed passwords' HMAC and must be long enough for
  // the logger's secretValues scrub (log/logger.ts MIN_SECRET_VALUE_LENGTH) to cover it.
  if (seedPasswordSecret !== null && seedPasswordSecret.length < 32)
    throw new SecretConfigError("SEED_PASSWORD_SECRET", "must be at least 32 characters");
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
