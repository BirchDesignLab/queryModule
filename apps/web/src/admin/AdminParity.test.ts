import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../shell.css"), "utf8");

/** Declarations of every rule whose selector list contains `selector` as one of its entries. */
function decls(selector: string): string {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, list]) =>
      (list ?? "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .map((sel) => sel.trim())
        .includes(selector),
    )
    .map(([, , body]) => body)
    .join("\n");
}

const BASE = /background:\s*var\(--qm-color-surface-base\)/;

// Admin parity pass (item 5, docs/design/2026-09-29-visual-system.md): the page is surface.sunken,
// the panes are surface.base, the preview follows the dispatcher's card. The numbers a browser
// resolves are asserted in e2e/visual.spec.ts; this pins the rules they come from.
describe("admin parity: surfaces", () => {
  it("the whole app sits on surface.sunken; the scoped body:has rules are gone", () => {
    expect(decls("body")).toMatch(/background:\s*var\(--qm-color-surface-sunken\)/);
    expect(css).not.toContain("body:has(.qm-query-panel)");
    expect(css).not.toContain("body:has(.qm-login)");
  });

  it("the rail fills the column's height beside the section and keeps its own height stacked", () => {
    // Stacked (the default) the section takes the rest of the window; from layout.stack the row
    // stretches the rail to the window's height.
    expect(decls(".qm-admin")).toMatch(/flex-direction:\s*column/);
    expect(decls(".qm-admin")).toMatch(/min-block-size:/);
    expect(decls(".qm-admin__main")).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/@media \(min-width: 54rem\) \{\s*\.qm-admin \{\s*flex-direction:\s*row/);
    expect(decls(".qm-admin__rail")).toMatch(/grid-template-columns:\s*repeat\(auto-fit/);
  });

  it("the builder heading keeps its size, weight and no margin (they set the first row's height)", () => {
    const h2 = decls(".qm-builder > h2");
    expect(h2).toMatch(/margin:\s*0/);
    expect(h2).toMatch(/font-size:\s*var\(--qm-type-size-xl\)/);
    expect(h2).toMatch(/font-weight:\s*600/);
  });

  it("the panes are a flex column under the toolbar: no hand-tuned offset from the window height", () => {
    const builder = decls(".qm-builder");
    expect(builder).toMatch(/display:\s*grid/);
    // One column: the heading, the body; the toolbar's own row only where there is a toolbar (the
    // loading and error states have none, and keep no empty row).
    expect(builder).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\)/);
    expect(css).toMatch(
      /\.qm-builder:where\(:has\(\.qm-builder__toolbar\)\) \{[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\)/,
    );
    // The heading and toolbar share a row by the section's width; the window caps the section from
    // layout.wide up.
    expect(css).toMatch(
      /@container \(min-width: 45rem\) \{\s*\.qm-builder \{[^}]*auto minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(/@media \(min-width: 64rem\) \{\s*\.qm-builder \{\s*block-size:/);
    expect(decls(".qm-builder__body")).toMatch(/flex-direction:\s*column/);
    expect(decls(".qm-builder__panes")).toMatch(/min-block-size:\s*0/);
    for (const sel of [".qm-tree", ".qm-builder__editor"])
      expect(css.slice(css.indexOf(`${sel},`))).not.toMatch(/100dvh\s*-\s*var\(--qm-space-12\)/);
    expect(css).not.toMatch(/\*\s*3\.9/);
  });

  it("the toolbar, tree, editor and preview are panes on surface.base", () => {
    for (const sel of [
      ".qm-builder__toolbar",
      ".qm-tree",
      ".qm-builder__editor",
      ".qm-builder__panes > .qm-admin__preview",
    ])
      expect(decls(sel), sel).toMatch(BASE);
  });

  it("scroll panes contain their hidden text, so the page has no phantom scroll", () => {
    for (const sel of [
      ".qm-tree",
      ".qm-builder__editor",
      ".qm-builder__panes > .qm-admin__preview",
    ])
      expect(decls(sel), sel).toMatch(/position:\s*relative/);
  });
});

describe("admin parity: layout", () => {
  it("the preview keeps a 440 px basis and does not grow past it", () => {
    expect(decls(".qm-builder__panes > .qm-admin__preview")).toMatch(
      /flex:\s*0 1 calc\(var\(--qm-space-12\) \* 9\.2\)/,
    );
  });

  it("the status sits on the second row with the reasons, not beside the buttons", () => {
    expect(decls(".qm-builder__status")).toMatch(/order:\s*2/);
    expect(decls(".qm-builder__reason")).toMatch(/order:\s*3/);
    expect(decls(".qm-builder__views")).toMatch(/margin-inline-start:\s*auto/);
  });

  it("the reasons under the toolbar buttons share one row", () => {
    expect(decls(".qm-builder__reason")).not.toMatch(/flex-basis:\s*100%/);
  });
});

describe("admin parity: the preview follows the dispatcher's card", () => {
  it("the panel is a sunken well holding a base card with the panel radius", () => {
    expect(decls(".qm-preview__panel--dispatch")).toMatch(
      /background:\s*var\(--qm-color-surface-sunken\)/,
    );
    const card = decls(".qm-preview__panel--dispatch .qm-preview__card");
    expect(card).toMatch(BASE);
    expect(card).toMatch(/border-radius:\s*var\(--qm-radius-panel\)/);
  });

  it("sections lose their boxes inside the card, and a later section opens under a rule", () => {
    const section = decls(".qm-preview__panel--dispatch .qm-query-form__section");
    expect(section).toMatch(/border:\s*0/);
    expect(decls(".qm-preview__panel--dispatch .qm-query-form__section--disclosure")).toMatch(
      /border-block-start:.*border-subtle/,
    );
  });
});
