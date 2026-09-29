import { describe, expect, it } from "vitest";
import { ROLES, RoleSchema } from "./identity";

describe("SEC-005 FR-060 roles (ADR-0011 item 6)", () => {
  it("lists user, trainingOfficer, admin, then implementer (config only)", () => {
    expect([...ROLES]).toEqual(["user", "trainingOfficer", "admin", "implementer"]);
  });
  it("parses implementer and rejects an unknown role", () => {
    expect(RoleSchema.parse("implementer")).toBe("implementer");
    expect(RoleSchema.safeParse("root").success).toBe(false);
  });
});
