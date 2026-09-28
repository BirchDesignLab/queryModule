import { describe, expect, it } from "vitest";
import { focusFirstInvalid } from "./focus-first-invalid.js";

describe("FR-005 focus moves to the first invalid field in render order (spec 6.2)", () => {
  it("focuses the first aria-invalid element", () => {
    document.body.innerHTML =
      '<form><input id="a"><input id="b" aria-invalid="true"><input id="c" aria-invalid="true"></form>';
    const form = document.querySelector("form");
    if (form === null) throw new Error("fixture");
    expect(focusFirstInvalid(form)?.id).toBe("b");
    expect(document.activeElement?.id).toBe("b");
  });
  it("returns null when nothing is invalid", () => {
    document.body.innerHTML = "<form><input></form>";
    expect(focusFirstInvalid(document.body)).toBeNull();
  });
});
