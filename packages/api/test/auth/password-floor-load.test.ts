import { describe, expect, it, vi } from "vitest";

// #574 AW5 C-C-m1: with PASSWORD_MIN_LENGTH lowered to 11 in core config, the Better Auth setup
// module refuses to load, so the server cannot start with a weaker minimum (SEC-005).
vi.mock("@querymodule/core/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@querymodule/core/config")>()),
  PASSWORD_MIN_LENGTH: 11,
}));

describe("the Better Auth setup with a minimum below the floor (#574)", () => {
  it("throws at load", async () => {
    await expect(import("../../src/auth/auth")).rejects.toThrow(
      "PASSWORD_MIN_LENGTH is below the floor of 12 (SEC-005)",
    );
  });
});
