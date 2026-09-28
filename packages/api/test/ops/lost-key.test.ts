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
    await recoverLostKey(t.deps.db, t.clock, "data", newData);
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
    for (const [name, table] of [
      ["credential", "state_credential"],
      ["data", "request_key"],
    ] as const) {
      await t.deps.db.$client.execute(`CREATE TABLE ${table} (id TEXT)`);
      await expect(recoverLostKey(t.deps.db, t.clock, name, Buffer.alloc(32, 9))).rejects.toThrow(
        RunbookOutdatedError,
      );
    }
    expect(await canaries()).toEqual(before);
  });
  it("fails when the WAL checkpoint reports busy (#217)", () => {
    expect(() => assertCheckpointComplete({ busy: 0, log: 3, checkpointed: 3 })).not.toThrow();
    expect(() => assertCheckpointComplete({ busy: 1, log: 3, checkpointed: 0 })).toThrow(/busy/);
    expect(() => assertCheckpointComplete(undefined)).toThrow(/busy/);
  });
});
