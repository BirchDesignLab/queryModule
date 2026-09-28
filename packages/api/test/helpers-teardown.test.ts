import { describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { migratedDb, testEnv } from "./helpers/fixture";
import { createTestApp, type TestApp } from "./helpers/test-app";

// Windows cannot delete a temp directory while a libSQL file in it is still open (EPERM at
// teardown), so every database a test helper opens is closed when its test finishes.
describe("test helpers close their databases", () => {
  let db: Db | undefined;
  let app: TestApp | undefined;
  it("migratedDb opens a database", async () => {
    db = await migratedDb(testEnv());
    expect(db.$client.closed).toBe(false);
  });
  it("migratedDb closed it when the test that opened it finished", () => {
    expect(db?.$client.closed).toBe(true);
  });
  it("createTestApp opens a database", async () => {
    app = await createTestApp();
    expect(app.deps.db.$client.closed).toBe(false);
  });
  it("createTestApp closed it when the test that opened it finished", () => {
    expect(app?.deps.db.$client.closed).toBe(true);
  });
  it("a database the test already closed is not closed twice", async () => {
    const t = await createTestApp();
    t.deps.db.$client.close();
  });
});
