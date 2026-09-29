import { describe, expect, it } from "vitest";
import { checkKeyCanaries, KeyCanaryError } from "../../src/keys/canary";
import {
  assertCheckpointComplete,
  RunbookOutdatedError,
  recoverLostKey,
} from "../../src/ops/lost-key";
import { TEST_SECRETS } from "../helpers/fixture";
import { createTestApp } from "../helpers/test-app";

const keys = { credentialKey: TEST_SECRETS.credentialKey, dataKey: TEST_SECRETS.dataKey };

describe("SEC-006 lost-key runbooks", () => {
  it("rekeys only the lost key's canary", async () => {
    const t = await createTestApp();
    const newCred = Buffer.alloc(32, 7);
    await expect(
      checkKeyCanaries(t.deps.db, { ...keys, credentialKey: newCred }, t.clock),
    ).rejects.toThrow(KeyCanaryError);
    await recoverLostKey(t.deps.db, t.clock, "credential", newCred);
    expect(await checkKeyCanaries(t.deps.db, { ...keys, credentialKey: newCred }, t.clock)).toEqual(
      { credential: "verified", data: "verified" },
    );
  });
  it("lost DATA_KEY leaves the credential canary alone", async () => {
    const t = await createTestApp();
    const newData = Buffer.alloc(32, 8);
    await recoverLostKey(t.deps.db, t.clock, "data", newData, t.deps.audit);
    expect(await checkKeyCanaries(t.deps.db, { ...keys, dataKey: newData }, t.clock)).toEqual({
      credential: "verified",
      data: "verified",
    });
  });
  it("refuses once the protected table exists, so a later phase must extend it", async () => {
    const t = await createTestApp();
    await t.deps.db.$client.execute("CREATE TABLE state_credential (user_id TEXT)");
    await expect(
      recoverLostKey(t.deps.db, t.clock, "credential", Buffer.alloc(32, 7)),
    ).rejects.toThrow(RunbookOutdatedError);
  });
  it("a refusal writes no canary, for either key (#217)", async () => {
    const t = await createTestApp();
    const canaries = async () =>
      (await t.deps.db.$client.execute("SELECT * FROM key_canary ORDER BY key_name")).rows;
    const before = await canaries();
    await t.deps.db.$client.execute("CREATE TABLE state_credential (id TEXT)");
    await expect(
      recoverLostKey(t.deps.db, t.clock, "credential", Buffer.alloc(32, 9)),
    ).rejects.toThrow(RunbookOutdatedError);
    expect(await canaries()).toEqual(before);
  });
  it("fails when the WAL checkpoint reports busy (#217)", () => {
    expect(() => assertCheckpointComplete({ busy: 0, log: 3, checkpointed: 3 })).not.toThrow();
    expect(() => assertCheckpointComplete({ busy: 1, log: 3, checkpointed: 0 })).toThrow(/busy/);
    expect(() => assertCheckpointComplete(undefined)).toThrow(/busy/);
  });
});

async function withRequestKeys() {
  const t = await createTestApp();
  const db = t.deps.db;
  for (const cid of ["req-a", "req-b"]) {
    for (const scope of ["values", "payload"]) {
      await db.$client.execute({
        sql: "INSERT INTO request_key VALUES (?, ?, x'01', x'02', x'03', 1, 1)",
        args: [cid, scope],
      });
    }
  }
  return t;
}
const count = async (t: Awaited<ReturnType<typeof withRequestKeys>>, table: string) =>
  Number((await t.deps.db.$client.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n);

describe("SEC-006 lost DATA_KEY shreds request_key (spec 8.7)", () => {
  it("deletes every request_key row, rewrites the canary and audits one retentionPurged per scope", async () => {
    const t = await withRequestKeys();
    const newData = Buffer.alloc(32, 8);
    const before = await count(t, "audit_event");
    const r = await recoverLostKey(t.deps.db, t.clock, "data", newData, t.deps.audit);
    expect(r).toEqual({ keysDeleted: 4, requestCount: 2 });
    expect(await count(t, "request_key")).toBe(0);
    expect(await checkKeyCanaries(t.deps.db, { ...keys, dataKey: newData }, t.clock)).toEqual({
      credential: "verified",
      data: "verified",
    });
    const rows = (
      await t.deps.db.$client.execute(
        "SELECT type, actor_user_id, correlation_id, part_id, credential_user_id, details FROM audit_event ORDER BY id DESC LIMIT 2",
      )
    ).rows;
    expect(await count(t, "audit_event")).toBe(before + 2);
    const details = rows.map((x) => JSON.parse(String(x.details)) as Record<string, unknown>);
    expect(details.map((d) => d.scope).sort()).toEqual(["payload", "values"]);
    for (const d of details)
      expect(d).toEqual({
        scope: d.scope,
        reason: "keyLost",
        olderThan: null,
        requestCount: 2,
        keysDeleted: 2,
      });
    for (const x of rows) {
      expect(x.type).toBe("retentionPurged");
      expect(x.correlation_id).toBeNull();
      expect(x.part_id).toBeNull();
      expect(x.credential_user_id).toBeNull();
    }
  });
  it("an audit failure deletes nothing and leaves the canary alone", async () => {
    const t = await withRequestKeys();
    const failing = {
      record: async () => {
        throw new Error("audit down");
      },
    };
    await expect(
      recoverLostKey(t.deps.db, t.clock, "data", Buffer.alloc(32, 8), failing),
    ).rejects.toThrow("audit down");
    expect(await count(t, "request_key")).toBe(4);
    await expect(
      checkKeyCanaries(t.deps.db, { ...keys, dataKey: Buffer.alloc(32, 8) }, t.clock),
    ).rejects.toThrow(KeyCanaryError);
  });
  it("refuses to shred without an audit service", async () => {
    const t = await withRequestKeys();
    await expect(recoverLostKey(t.deps.db, t.clock, "data", Buffer.alloc(32, 8))).rejects.toThrow(
      /audit/,
    );
    expect(await count(t, "request_key")).toBe(4);
  });
  it("reports zero when request_key is empty and still audits one retentionPurged per scope", async () => {
    const t = await createTestApp();
    const before = await count(t, "audit_event");
    expect(
      await recoverLostKey(t.deps.db, t.clock, "data", Buffer.alloc(32, 8), t.deps.audit),
    ).toEqual({ keysDeleted: 0, requestCount: 0 });
    expect(await count(t, "audit_event")).toBe(before + 2);
    const rows = (
      await t.deps.db.$client.execute(
        "SELECT type, details FROM audit_event ORDER BY id DESC LIMIT 2",
      )
    ).rows;
    expect(rows.map((x) => x.type)).toEqual(["retentionPurged", "retentionPurged"]);
    const details = rows.map((x) => JSON.parse(String(x.details)) as Record<string, unknown>);
    expect(details.map((d) => d.scope).sort()).toEqual(["payload", "values"]);
    for (const d of details)
      expect(d).toEqual({
        scope: d.scope,
        reason: "keyLost",
        olderThan: null,
        requestCount: 0,
        keysDeleted: 0,
      });
  });
  it("audits a zero count for a scope that has no rows", async () => {
    const t = await createTestApp();
    await t.deps.db.$client.execute(
      "INSERT INTO request_key VALUES ('req-a', 'values', x'01', x'02', x'03', 1, 1)",
    );
    await recoverLostKey(t.deps.db, t.clock, "data", Buffer.alloc(32, 8), t.deps.audit);
    const details = (
      await t.deps.db.$client.execute("SELECT details FROM audit_event ORDER BY id DESC LIMIT 2")
    ).rows.map((x) => JSON.parse(String(x.details)) as Record<string, unknown>);
    const byScope = Object.fromEntries(details.map((d) => [d.scope, d]));
    expect(byScope.values).toMatchObject({ requestCount: 1, keysDeleted: 1 });
    expect(byScope.payload).toMatchObject({ requestCount: 0, keysDeleted: 0 });
  });
  it("still works on a database from before migration 0003 and reports zero", async () => {
    const t = await createTestApp();
    await t.deps.db.$client.execute("DROP TABLE request_key");
    expect(
      await recoverLostKey(t.deps.db, t.clock, "data", Buffer.alloc(32, 8), t.deps.audit),
    ).toEqual({ keysDeleted: 0, requestCount: 0 });
  });
  it("credential still refuses when state_credential exists", async () => {
    const t = await withRequestKeys();
    await t.deps.db.$client.execute("CREATE TABLE state_credential (user_id TEXT)");
    await expect(
      recoverLostKey(t.deps.db, t.clock, "credential", Buffer.alloc(32, 7), t.deps.audit),
    ).rejects.toThrow(RunbookOutdatedError);
    expect(await count(t, "request_key")).toBe(4);
  });
});
