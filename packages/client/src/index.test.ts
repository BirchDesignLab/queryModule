import {
  createQueryClient,
  createResetController,
  registerQueryCacheReset,
} from "@querymodule/client";
import { describe, expect, it } from "vitest";

describe("SEC-006 package entry exports the query cache reset (spec 6.7)", () => {
  it("registerQueryCacheReset from the entry clears the query cache on reset", () => {
    const reset = createResetController();
    const client = createQueryClient();
    client.setQueryData(["probe"], { value: 1 });
    registerQueryCacheReset(reset, client);
    reset.resetAll();
    expect(client.getQueryData(["probe"])).toBeUndefined();
  });
});
