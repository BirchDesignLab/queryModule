import { getConfig } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("test setup (#610)", () => {
  it("findBy* and waitFor wait 5 s, so admin tests hold under full-suite load on Windows", () => {
    expect(getConfig().asyncUtilTimeout).toBe(5000);
  });
});
