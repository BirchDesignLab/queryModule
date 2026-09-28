import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SECRET_NAMES = [
  "DB_ENCRYPTION_KEY",
  "CREDENTIAL_KEY",
  "DATA_KEY",
  "BETTER_AUTH_SECRET",
  "SEED_PASSWORD_SECRET",
] as const;

// Random dev secrets, created once, gitignored (.dev/). Never used outside this machine.
export function ensureDevSecrets(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const n of SECRET_NAMES) {
    const f = join(dir, n);
    if (!existsSync(f))
      writeFileSync(f, `${randomBytes(32).toString("base64")}\n`, { mode: 0o600 });
  }
}
