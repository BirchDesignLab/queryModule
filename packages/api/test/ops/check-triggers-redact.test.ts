import { describe, expect, it, vi } from "vitest";
import { TriggerMissingError } from "../../src/db/migrate";

const CANARY = "ZZOPSCANARY0123456789";
const fail = vi.hoisted(() => ({ with: undefined as unknown }));

vi.mock("../../src/ops/audit-stats", () => ({
  openForOps: async () => ({ db: { $client: { close: () => {} } } }),
}));
vi.mock("../../src/db/migrate", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/db/migrate")>();
  return {
    ...real,
    checkAuditTriggers: async () => {
      if (fail.with !== undefined) throw fail.with;
    },
    checkQueryTriggers: async () => {},
    checkConfigVersionTriggers: async () => {},
  };
});

const { runCheckTriggers } = await import("../../src/ops/check-triggers");

async function run(e: unknown): Promise<{ code: number; err: string }> {
  fail.with = e;
  const err: string[] = [];
  const code = await runCheckTriggers({}, { write: () => {} }, { write: (s) => err.push(s) });
  return { code, err: err.join("") };
}

describe("runCheckTriggers stderr (spec 5.9, M1 phase review Q3)", () => {
  it("writes the name and fixed code of an unknown error, never its message", async () => {
    const e = Object.assign(new Error(`params: ${CANARY}`), { code: "SQLITE_IOERR" });
    const { code, err } = await run(e);
    expect(code).toBe(1);
    expect(err).not.toContain(CANARY);
    expect(err).not.toContain("params");
    expect(err).toBe("trigger check failed: Error SQLITE_IOERR\n");
  });

  it("writes only the name of an unknown error with no fixed code", async () => {
    const { err } = await run(new TypeError(`bad ${CANARY}`));
    expect(err).toBe("trigger check failed: TypeError\n");
  });

  it("keeps the fixed text of a TriggerMissingError", async () => {
    const e = new TriggerMissingError(["audit_event"], ["audit_event_no_delete"]);
    const { err } = await run(e);
    expect(err).toBe(`${e.message}\n`);
  });
});
