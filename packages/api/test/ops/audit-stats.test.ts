import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { withTransaction } from "../../src/db/tx";
import { type DeployEnv, readDeployEnv } from "../../src/env";
import { writeCanary } from "../../src/keys/canary";
import { auditStats, openForOps, parseUpTo } from "../../src/ops/audit-stats";
import { runCheckTriggers } from "../../src/ops/check-triggers";
import { bundledPaths } from "../../src/paths";
import { TEST_DB_KEY } from "../helpers/db";
import { createTestApp } from "../helpers/test-app";

describe("SEC-010 audit stats", () => {
  it("counts rows and max id, optionally up to an id", async () => {
    const t = await createTestApp();
    expect(await auditStats(t.deps.db)).toEqual({ auditCount: 0, auditMaxId: 0 });
    for (let i = 0; i < 3; i++) {
      await withTransaction(t.deps.db, (tx) =>
        t.deps.audit.record(tx, {
          type: "loginFailed",
          actor: SYSTEM_ACTOR,
          identitySource: "system",
          details: { targetUserId: null, reason: "unknownAccount", clientIp: "local" },
        }),
      );
    }
    expect(await auditStats(t.deps.db)).toEqual({ auditCount: 3, auditMaxId: 3 });
    expect(await auditStats(t.deps.db, 2)).toEqual({ auditCount: 2, auditMaxId: 2 });
  });
});

describe("parseUpTo", () => {
  it("returns undefined when --up-to is absent", () => {
    expect(parseUpTo([])).toBeUndefined();
  });

  it("returns the parsed id for a valid --up-to value", () => {
    expect(parseUpTo(["--up-to", "5"])).toBe(5);
    expect(parseUpTo(["--up-to", "0"])).toBe(0);
  });

  it.each([
    ["missing value", ["--up-to"]],
    ["empty value", ["--up-to", ""]],
    ["literal null", ["--up-to", "null"]],
    ["trailing garbage", ["--up-to", "12abc"]],
    ["negative", ["--up-to", "-1"]],
    ["exponential form", ["--up-to", "1e6"]],
    ["equals form", ["--up-to=5"]],
    ["unknown flag", ["--bogus"]],
  ])("rejects %s", (_label, argv) => {
    expect(() => parseUpTo(argv)).toThrow();
  });
});

/**
 * Builds a migrated on-disk database plus real secret files on disk, so openForOps and
 * runCheckTriggers (which read secrets and open the db themselves, exactly as the CLIs do) can
 * be exercised end to end. Returned processEnv is what a CLI's process.env would look like.
 */
const opsDirs: string[] = [];
afterEach(() => {
  for (const dir of opsDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort; matches test/helpers/db.ts's tolerance for a still-locked Windows handle
    }
  }
});

async function setupOpsEnv(): Promise<{ processEnv: NodeJS.ProcessEnv; deployEnv: DeployEnv }> {
  const root = mkdtempSync(join(tmpdir(), "qm-ops-"));
  opsDirs.push(root);
  // Secrets must not live inside the data dir (spec 5.5, 8.2; secrets.ts enforces it), so each
  // gets its own sibling directory under one removable root.
  const dir = join(root, "data");
  const secretsDir = join(root, "secrets");
  mkdirSync(dir, { recursive: true });
  mkdirSync(secretsDir, { recursive: true });
  const keys: Record<string, string> = {
    DB_ENCRYPTION_KEY: TEST_DB_KEY,
    CREDENTIAL_KEY: Buffer.alloc(32, 2).toString("base64"),
    DATA_KEY: Buffer.alloc(32, 3).toString("base64"),
    BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
  };
  for (const [name, value] of Object.entries(keys)) writeFileSync(join(secretsDir, name), value);
  const processEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PUBLIC_ORIGIN: "http://localhost:3000",
    DATA_DIR: dir,
    SECRETS_DIR: secretsDir,
    WEB_DIST: "",
  };
  const deployEnv = readDeployEnv(
    processEnv,
    bundledPaths(resolve(import.meta.dirname, "../../src")),
  );
  const db = await openDatabase({ file: deployEnv.dbFile, encryptionKey: TEST_DB_KEY });
  await runMigrations(db, deployEnv.migrationsDir);
  db.$client.close();
  return { processEnv, deployEnv };
}

describe("runCheckTriggers", () => {
  it("returns 0 and reports success on a freshly migrated database", async () => {
    const { processEnv } = await setupOpsEnv();
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCheckTriggers(
      processEnv,
      { write: (s: string) => out.push(s) },
      { write: (s: string) => err.push(s) },
    );
    expect(code).toBe(0);
    expect(out.join("")).toContain("audit_event triggers present");
    expect(err).toEqual([]);
  });

  it("returns 1 and reports which trigger is missing after one is dropped", async () => {
    const { processEnv, deployEnv } = await setupOpsEnv();
    const db = await openDatabase({ file: deployEnv.dbFile, encryptionKey: TEST_DB_KEY });
    await db.$client.execute({ sql: "DROP TRIGGER audit_event_no_delete", args: [] });
    db.$client.close();

    const err: string[] = [];
    const code = await runCheckTriggers(
      processEnv,
      { write: () => {} },
      { write: (s: string) => err.push(s) },
    );
    expect(code).toBe(1);
    expect(err.join("")).toContain("audit_event_no_delete");
  });
});

describe("runCheckTriggers open failure (#217 G-m2)", () => {
  it("returns 1 instead of throwing when the secrets cannot be read", async () => {
    const { processEnv } = await setupOpsEnv();
    const err: string[] = [];
    const code = await runCheckTriggers(
      { ...processEnv, SECRETS_DIR: join(tmpdir(), "qm-no-such-secrets-dir") },
      { write: () => {} },
      { write: (s: string) => err.push(s) },
    );
    expect(code).toBe(1);
    expect(err.join("")).not.toBe("");
  });
});

describe("openForOps", () => {
  it("opens a database whose key canary does not verify, since it runs no canary check", async () => {
    const { processEnv, deployEnv } = await setupOpsEnv();
    const preDb = await openDatabase({ file: deployEnv.dbFile, encryptionKey: TEST_DB_KEY });
    await withTransaction(preDb, (tx) =>
      writeCanary(tx, Buffer.alloc(32, 9), "credential", { now: () => Date.now() }),
    );
    preDb.$client.close();

    const { db } = await openForOps(processEnv);
    try {
      expect(await auditStats(db)).toEqual({ auditCount: 0, auditMaxId: 0 });
    } finally {
      db.$client.close();
    }
  });
});
