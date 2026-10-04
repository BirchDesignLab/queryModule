import { ROLES } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { mayQuery, QUERY_ROLES } from "../../src/queries/route";

/*
 * #505 T27 Q2 (ADR-0011 item 6, checker ruling 09-29-26): POST /api/v1/queries is open to an
 * allowlist of query-capable roles, so a role added later is refused until it is listed.
 */
describe("#505 T27 Q2 query-capable roles are an allowlist", () => {
  it("lists exactly user, trainingOfficer and admin", () => {
    expect([...QUERY_ROLES].sort()).toEqual(["admin", "trainingOfficer", "user"]);
    for (const role of ROLES) expect(mayQuery(role), role).toBe(role !== "implementer");
  });

  it("refuses a role value it does not list", () => {
    for (const role of ["auditor", "", "Admin", "system"]) expect(mayQuery(role), role).toBe(false);
  });
});
