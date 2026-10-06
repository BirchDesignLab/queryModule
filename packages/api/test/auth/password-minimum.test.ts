import { CreateUserResponseSchema } from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import { adminConfigApp } from "../helpers/admin-config";

// #543 (#511, #507 item 17; SEC-005): Better Auth's password minimum is the shared
// PASSWORD_MIN_LENGTH from core config, the value the change-password page enforces too. Raised
// to 14 here, the server follows it.
vi.mock("@querymodule/core/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@querymodule/core/config")>()),
  PASSWORD_MIN_LENGTH: 14,
}));

const H = { "x-requested-with": "querymodule", "content-type": "application/json" };

describe("the password minimum follows PASSWORD_MIN_LENGTH (#543)", () => {
  it("with the minimum at 14, change-password refuses 13 characters and accepts 14", async () => {
    const a = await adminConfigApp();
    const r = await a.call("admin", "POST", "/api/v1/admin/users", {
      email: "minimum@example.test",
      name: "Minimum",
      role: "user",
    });
    const { temporaryPassword } = CreateUserResponseSchema.parse(await r.json());
    const cookie = await a.t.cookieFor("minimum@example.test", temporaryPassword);
    const change = (newPassword: string) =>
      a.t.request("/api/v1/auth/change-password", {
        method: "POST",
        headers: { ...H, cookie },
        body: JSON.stringify({ currentPassword: temporaryPassword, newPassword }),
      });
    expect((await change("x".repeat(13))).status).toBe(400);
    expect((await change("y".repeat(14))).status).toBe(200);
  });
});
