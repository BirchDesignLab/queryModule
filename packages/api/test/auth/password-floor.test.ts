import { PASSWORD_MIN_LENGTH } from "@querymodule/core/config";
import { describe, expect, it } from "vitest";
import { assertPasswordFloor, PASSWORD_FLOOR } from "../../src/auth/auth";

// #574 AW5 C-C-m1 (SEC-005; Manager 7 ruling 10-17-26): PASSWORD_MIN_LENGTH lives in core config,
// which ordinary paths reach, so the gate-tier Better Auth setup refuses to load below a floor of
// 12. This file reads the real, unmocked value.
describe("the password minimum floor (#574)", () => {
  it("the shipped PASSWORD_MIN_LENGTH, read through @querymodule/core/config, is at least 12", () => {
    expect(PASSWORD_FLOOR).toBe(12);
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(PASSWORD_FLOOR);
  });

  it("refuses a minimum below 12 with fixed text, and accepts 12 and above", () => {
    expect(() => assertPasswordFloor(11)).toThrow(
      "PASSWORD_MIN_LENGTH is below the floor of 12 (SEC-005)",
    );
    expect(() => assertPasswordFloor(12)).not.toThrow();
    expect(() => assertPasswordFloor(14)).not.toThrow();
  });
});
