import { describe, expect, it, vi } from "vitest";
import { createResetController } from "../session/reset.js";
import { createQueryClient, registerQueryCacheReset } from "./query-client.js";

describe("SEC-006 query cache is memory only and clearable (spec 6.7)", () => {
  it("clear drops cached data", () => {
    const client = createQueryClient();
    client.setQueryData(["probe"], 1);
    client.clear();
    expect(client.getQueryData(["probe"])).toBeUndefined();
  });
  it("uses one retry and no focus refetch", () => {
    expect(createQueryClient().getDefaultOptions().queries).toMatchObject({
      retry: 1,
      refetchOnWindowFocus: false,
    });
  });
  it("registerQueryCacheReset cancels queries and clears the cache on reset (SEC-006, spec 6.7)", async () => {
    const client = createQueryClient();
    const cancelSpy = vi.spyOn(client, "cancelQueries");
    client.setQueryData(["probe"], 1);
    const reset = createResetController();
    registerQueryCacheReset(reset, client);
    reset.resetAll();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["probe"])).toBeUndefined();
  });
});
