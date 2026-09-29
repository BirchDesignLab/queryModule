import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";

// node:url's URL avoids jsdom's global URL failing Node fs's instanceof check on Windows (PR #83).
const css = readFileSync(fileURLToPath(new NodeURL("./shell.css", import.meta.url)), "utf8");

describe("UX-002 compact top bar in the mobile-unit layout (spec 6.3 v1 subset)", () => {
  it("the bar is 48 px targets plus space-4, so the focus ring clears the top and bottom edges", () => {
    const rule = css.match(/\.qm-app-header--compact\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/padding:/);
    expect(rule).toMatch(/min-height:\s*calc\(var\(--qm-target-min\)\s*\+\s*var\(--qm-space-4\)\)/);
    expect(rule).not.toMatch(/font-size/);
  });

  it("the bar's buttons and selects are 48 px targets, above the dense 36 px of the dispatch bar", () => {
    const rule =
      css.match(
        /\.qm-app-header--compact\s+(?:\.qm-button|:where\([^)]*\))[^{]*\{([^}]*)\}/,
      )?.[1] ?? "";
    expect(rule).toMatch(/min-height:\s*var\(--qm-target-min\)/);
    expect(rule).toMatch(/min-width:\s*var\(--qm-target-min\)/);
  });
});
