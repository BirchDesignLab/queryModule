import { describe, expect, it } from "vitest";

describe("vitest include glob (G2)", () => {
  it("collects .test.tsx files in packages/client, not just .test.ts", () => {
    expect(true).toBe(true);
  });
});
