import { mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeAll, sweepStaleTempDirs } from "./db";

describe("closeAll", () => {
  it("closes a client the test left open", () => {
    const client = { closed: false, close: () => undefined };
    client.close = () => {
      client.closed = true;
    };
    closeAll([client]);
    expect(client.closed).toBe(true);
  });

  it("leaves an already-closed client alone", () => {
    const client = {
      closed: true,
      close: () => {
        throw new Error("close() should not be called on an already-closed client");
      },
    };
    expect(() => closeAll([client])).not.toThrow();
  });

  it("fails the suite when a client is left open and close() does not close it", () => {
    const client = { closed: false, close: () => undefined };
    expect(() => closeAll([client])).toThrow();
  });
});

describe("sweepStaleTempDirs", () => {
  let scratchRoot: string;
  beforeEach(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), "qm-db-sweep-test-"));
  });
  afterEach(() => rmSync(scratchRoot, { recursive: true, force: true }));

  it("removes an old qm-db-* dir and leaves a fresh one", () => {
    const oldDir = mkdtempSync(join(scratchRoot, "qm-db-old-"));
    const freshDir = mkdtempSync(join(scratchRoot, "qm-db-fresh-"));
    const old = new Date(Date.now() - 20 * 60 * 1000);
    utimesSync(oldDir, old, old);

    sweepStaleTempDirs(scratchRoot, 10 * 60 * 1000);

    expect(() => statSync(oldDir)).toThrow();
    expect(statSync(freshDir).isDirectory()).toBe(true);
  });

  it("ignores a root it cannot read", () => {
    expect(() => sweepStaleTempDirs(join(scratchRoot, "does-not-exist"), 0)).not.toThrow();
  });
});
