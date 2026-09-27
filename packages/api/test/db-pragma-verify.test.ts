import { describe, expect, it, vi } from "vitest";
import { DatabaseOpenError, openDatabase } from "../src/db/client";
import { TEST_DB_KEY, tempDbFile } from "./helpers/db";

/** The pragma whose read-back the mocked client misreports, and the value it reports. */
const misreport = vi.hoisted(() => ({ name: "", value: undefined as unknown }));

vi.mock("@libsql/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@libsql/client")>();
  return {
    ...real,
    createClient: (config: Parameters<typeof real.createClient>[0]) => {
      const client = real.createClient(config);
      const execute = client.execute.bind(client);
      client.execute = ((stmt: string) =>
        misreport.name !== "" && stmt === `PRAGMA ${misreport.name}`
          ? Promise.resolve({ rows: [{ [misreport.name]: misreport.value }] })
          : execute(stmt)) as typeof client.execute;
      return client;
    },
  };
});

describe("SEC-006 openDatabase reads the pragmas back", () => {
  it.each([
    ["journal_mode", "delete"],
    ["foreign_keys", 0],
    ["synchronous", 1],
    ["secure_delete", 0],
    ["busy_timeout", 0],
  ])("fails closed when %s reads back %s", async (name, value) => {
    misreport.name = name;
    misreport.value = value;
    const err = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DatabaseOpenError);
    expect((err as Error).message).toContain(name);
    expect((err as Error).message).not.toContain(TEST_DB_KEY);
  });

  it("opens when every pragma reads back as set", async () => {
    misreport.name = "";
    const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
    expect(db.$client.closed).toBe(false);
    db.$client.close();
  });
});
