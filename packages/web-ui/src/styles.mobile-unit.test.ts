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

  it("the layout fills the vehicle laptop's width instead of the 40 rem page column", () => {
    const root = css.match(/^\.qm-layout--mobile-unit\s*\{([^}]*)\}/m)?.[1] ?? "";
    expect(root).toMatch(/max-width:\s*none/);
  });

  it("body text in the layout is at least the 16 px body size", () => {
    const root = css.match(/^\.qm-layout--mobile-unit\s*\{([^}]*)\}/m)?.[1] ?? "";
    expect(root).toMatch(/font-size:\s*var\(--qm-type-body-size\)/);
  });

  it("buttons, selects and text inputs are at least 48x48", () => {
    const body = rulesFor(".qm-layout--mobile-unit :where(button, select");
    expect(body).toMatch(/min-height:\s*var\(--qm-target-min\)/);
    expect(body).toMatch(/min-width:\s*var\(--qm-target-min\)/);
  });

  it("checkboxes are 48x48", () => {
    const body = rulesFor('.qm-layout--mobile-unit input[type="checkbox"]');
    expect(body).toMatch(/width:\s*var\(--qm-target-min\)/);
    expect(body).toMatch(/height:\s*var\(--qm-target-min\)/);
  });

  it("checkboxes outside a chip are 48x48; inside a chip the label is the 48 px target", () => {
    const body = rulesFor('.qm-layout--mobile-unit input[type="checkbox"]');
    expect(body).toMatch(/width:\s*var\(--qm-target-min\)/);
    expect(css).toMatch(
      /\.qm-layout--mobile-unit\s+\.qm-chip\s*\{[^}]*min-height:\s*var\(--qm-target-min\)/,
    );
  });
});

describe("B4 officer quick access: tiles, run button, no muted text", () => {
  it("quick access is a grid of tiles, one row of up to five at 1024", () => {
    const quick = rulesFor(".qm-layout--mobile-unit .qm-quick-access");
    expect(quick).toMatch(/display:\s*grid/);
    expect(quick).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(10rem/);
  });
  it("a tile is 88 px tall (touch control plus space-8), code above the name", () => {
    const tile = rulesFor(".qm-layout--mobile-unit .qm-quick-access__button");
    expect(tile).toMatch(
      /min-height:\s*calc\(var\(--qm-control-height-touch\)\s*\+\s*var\(--qm-space-8\)\)/,
    );
    expect(tile).toMatch(/flex-direction:\s*column/);
  });
  it("the run action is 64 px (touch control plus space-2) and takes the row beside Clear", () => {
    const run = rulesFor('.qm-layout--mobile-unit .qm-action-bar > button[type="submit"]');
    expect(run).toMatch(
      /min-height:\s*calc\(var\(--qm-control-height-touch\)\s*\+\s*var\(--qm-space-2\)\)/,
    );
    expect(run).toMatch(/flex:\s*1 1 12rem/);
  });
  it("no rule of the officer layout uses the muted text colour (spec 6.3)", () => {
    const officerRules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, sel]) => sel?.includes(".qm-layout--mobile-unit"))
      .map(([, , body]) => body ?? "");
    expect(officerRules.length).toBeGreaterThan(10);
    for (const body of officerRules) expect(body).not.toMatch(/--qm-color-text-muted/);
  });
});

describe("B3 requests list: two panes on dispatch, a quiet last-request card for the officer", () => {
  it("dispatch puts the panel and the list in two columns from 1024 px; the panel's content is 640 px (682 with its padding and border), so the five quick-access buttons fit one row", () => {
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1024px\)\s*\{\s*\.qm-query-panel:not\(\.qm-layout--mobile-unit\)\s+\.qm-panes\s*\{[^}]*grid-template-columns:\s*minmax\(\s*0,\s*calc\(40rem \+ var\(--qm-space-5\) \* 2 \+ var\(--qm-border-width\) \* 2\)\s*\)\s+minmax\(0,\s*1fr\)/,
    );
  });
  it("the officer layout never gets the two columns", () => {
    expect(css).not.toMatch(/\.qm-layout--mobile-unit\s+\.qm-panes\s*\{[^}]*grid-template-columns/);
  });
  it("the officer's row text is body colour at 16 px, not muted (spec 6.3)", () => {
    const meta = rulesFor(".qm-layout--mobile-unit .qm-request__meta");
    expect(meta).toMatch(/color:\s*var\(--qm-color-text-body\)/);
    expect(meta).toMatch(/font-size:\s*var\(--qm-type-body-size\)/);
    expect(rulesFor(".qm-layout--mobile-unit .qm-requests__empty")).toMatch(
      /color:\s*var\(--qm-color-text-body\)/,
    );
  });
  it("a request row uses no literal colour or size (spec 6.5)", () => {
    const rows = [".qm-request", ".qm-requests"].map(rulesFor).join("\n");
    expect(rows).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(rows).not.toMatch(/\d+px/);
  });
});

describe("B4 officer tiles: cleanup (#416 critic)", () => {
  it("a tile that is not pressed lifts on hover; the tile rule no longer masks the base hover", () => {
    // Inside @media (hover: hover): a touch tap leaves no sticky hover (parity fold-in).
    expect(css).toMatch(
      /@media \(hover: hover\)\s*\{\s*\.qm-layout--mobile-unit\s+\.qm-quick-access__button:hover:not\(\[aria-pressed="true"\]\)\s*\{[^}]*background:\s*var\(--qm-color-surface-raised\)/,
    );
  });

  it("the touch layout's hidden keyboard hint carries no dead colour or size", () => {
    const hint = rulesFor(".qm-layout--mobile-unit .qm-quick-access__hint");
    expect(hint).toMatch(/display:\s*none/);
    expect(hint).not.toMatch(/color:|font-size:/);
  });
});
