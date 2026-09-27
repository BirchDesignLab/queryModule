import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Clock } from "../clock";
import type { Db } from "../db/client";
import { keyCanary } from "../db/schema";
import { type Tx, withTransaction } from "../db/tx";

export type CanaryKeyName = "credential" | "data";
export const CURRENT_KEY_VERSION = 1;
const PLAINTEXT = Buffer.from("querymodule-key-canary-v1", "utf8");
const aad = (n: CanaryKeyName, v: number) => Buffer.from(`key_canary|${n}|${v}`, "utf8");

export class KeyCanaryError extends Error {
  constructor(readonly keyName: CanaryKeyName) {
    super(
      `key canary for ${keyName === "credential" ? "CREDENTIAL_KEY" : "DATA_KEY"} does not decrypt`,
    );
    this.name = "KeyCanaryError";
  }
}

export function sealCanary(key: Buffer, keyName: CanaryKeyName, keyVersion: number) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv).setAAD(aad(keyName, keyVersion));
  const ciphertext = Buffer.concat([c.update(PLAINTEXT), c.final()]);
  return { ciphertext, iv, authTag: c.getAuthTag() };
}

function opens(key: Buffer, row: typeof keyCanary.$inferSelect): boolean {
  try {
    const d = createDecipheriv("aes-256-gcm", key, row.iv).setAAD(aad(row.keyName, row.keyVersion));
    d.setAuthTag(row.authTag);
    const pt = Buffer.concat([d.update(row.ciphertext), d.final()]);
    return pt.length === PLAINTEXT.length && timingSafeEqual(pt, PLAINTEXT);
  } catch {
    return false;
  }
}

export async function writeCanary(
  tx: Tx,
  key: Buffer,
  keyName: CanaryKeyName,
  clock: Clock,
): Promise<void> {
  const sealed = sealCanary(key, keyName, CURRENT_KEY_VERSION);
  const values = { keyName, ...sealed, keyVersion: CURRENT_KEY_VERSION, createdAt: clock.now() };
  await tx
    .insert(keyCanary)
    .values(values)
    .onConflictDoUpdate({ target: keyCanary.keyName, set: values });
}

export async function checkKeyCanaries(
  db: Db,
  keys: { credentialKey: Buffer; dataKey: Buffer },
  clock: Clock,
): Promise<Record<CanaryKeyName, "created" | "verified">> {
  const out = {} as Record<CanaryKeyName, "created" | "verified">;
  for (const [name, key] of [
    ["credential", keys.credentialKey],
    ["data", keys.dataKey],
  ] as const) {
    const row = (await db.select().from(keyCanary).where(eq(keyCanary.keyName, name)))[0];
    if (!row) {
      await withTransaction(db, (tx) => writeCanary(tx, key, name, clock));
      out[name] = "created";
    } else if (opens(key, row)) {
      out[name] = "verified";
    } else {
      throw new KeyCanaryError(name);
    }
  }
  return out;
}
