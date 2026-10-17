import { afterEach, describe, expect, it } from "vitest";
import { axeViolations } from "./axe.js";

// The jsdom axe helper (#644): it must find a real violation, or a clean result proves nothing.
afterEach(() => {
  document.body.innerHTML = "";
});

describe("axeViolations (#644: axe in the web unit suite)", () => {
  it("reports an unlabeled text input by rule id", async () => {
    document.body.innerHTML = '<main><input type="text"></main>';
    const found = await axeViolations(document.body);
    expect(found.map((v) => v.id)).toContain("label");
  });

  it("is clean for a labeled input, and skips color-contrast (jsdom has no layout)", async () => {
    document.body.innerHTML =
      '<main><label for="p">Plate</label><input id="p" type="text" style="color:#eee;background:#fff"></main>';
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
