import { describe, expect, it } from "vitest";
import { validateLogin } from "./validate-login.js";

describe("FR-005 login fields are required", () => {
  it("returns one message-keyed error per empty field", () => {
    expect(validateLogin({ email: "  ", password: "" })).toEqual([
      { key: "validation.required", params: { field: "email" } },
      { key: "validation.required", params: { field: "password" } },
    ]);
  });
  it("accepts filled fields", () => {
    expect(validateLogin({ email: "tester@querymodule.test", password: "x" })).toEqual([]);
  });
});
