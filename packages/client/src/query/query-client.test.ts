import { describe, expect, it } from "vitest";
import { createQueryClient } from "./query-client.js";

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
});
