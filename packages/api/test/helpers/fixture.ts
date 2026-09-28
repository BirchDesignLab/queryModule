import { dirname, resolve } from "node:path";
import type { Clock } from "../../src/clock";
import { type Db, openDatabase } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { type DeployEnv, readDeployEnv } from "../../src/env";
import { bundledPaths } from "../../src/paths";
import type { Secrets } from "../../src/secrets";
import { TEST_DB_KEY, tempDbFile } from "./db";

export const TEST_SECRETS: Secrets = {
  dbEncryptionKey: TEST_DB_KEY,
  credentialKey: Buffer.alloc(32, 2),
  dataKey: Buffer.alloc(32, 3),
  betterAuthSecret: "test-better-auth-secret-0123456789abcdef",
  seedPasswordSecret: "test-seed-password-secret-0123456789ab",
};

export interface TestClock extends Clock {
  advance(ms: number): void;
}

export function createTestClock(): TestClock {
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    advance: (ms) => {
      offset += ms;
    },
  };
}

export function testEnv(over: NodeJS.ProcessEnv = {}): DeployEnv {
  return readDeployEnv(
    // WEB_DIST "" keeps a locally built apps/web/dist out of API tests unless a test opts in
    {
      NODE_ENV: "test",
      PUBLIC_ORIGIN: "http://localhost:3000",
      DATA_DIR: dirname(tempDbFile()),
      WEB_DIST: "",
      ...over,
    },
    bundledPaths(resolve(import.meta.dirname, "../../src")),
  );
}

export async function migratedDb(env: DeployEnv): Promise<Db> {
  const db = await openDatabase({ file: env.dbFile, encryptionKey: TEST_SECRETS.dbEncryptionKey });
  await runMigrations(db, env.migrationsDir);
  return db;
}
