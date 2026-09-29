import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";

// node:url's URL avoids jsdom's global URL failing Node fs's instanceof check on Windows (PR #83).
const read = (path: string) =>
  readFileSync(fileURLToPath(new NodeURL(path, import.meta.url)), "utf8");
const css = read("./styles.css");
const tokens = read("../../tokens/generated/tokens.css");

/** The declarations of every rule whose selector list mentions `needle`. */
function rulesFor(needle: string): string {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selector]) => selector?.includes(needle))
    .map(([, , body]) => body)
    .join("\n");
}

describe("UX-002 UX-012 mobile-unit layout, spec 6.3 v1 subset (48x48 targets, 16 px text)", () => {
  it("the tokens it uses are 48 px and 16 px", () => {
    expect(tokens).toMatch(/--qm-target-min:\s*48px;/);
    expect(tokens).toMatch(/--qm-type-body-size:\s*16px;/);
  });

  it("body text in the layout is at least the 16 px body size", () => {
    expect(rulesFor(".qm-layout--mobile-unit")).toMatch(/font-size:\s*var\(--qm-type-body-size\)/);
  });

  it("buttons, selects and text inputs are at least 48x48", () => {
    const body = rulesFor(".qm-layout--mobile-unit :is(button, select");
    expect(body).toMatch(/min-height:\s*var\(--qm-target-min\)/);
    expect(body).toMatch(/min-width:\s*var\(--qm-target-min\)/);
  });

  it("checkboxes are 48x48", () => {
    const body = rulesFor('.qm-layout--mobile-unit input[type="checkbox"]');
    expect(body).toMatch(/width:\s*var\(--qm-target-min\)/);
    expect(body).toMatch(/height:\s*var\(--qm-target-min\)/);
  });
});
