import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "shell.css"), "utf8");

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

describe("parity pass: query surfaces (docs/design/2026-09-29-visual-system.md)", () => {
  it("G1 every page sits on surface.sunken (admin adopted it, so the body:has scoping is gone); the header keeps surface.base", () => {
    expect(decls("body")).toMatch(/background:\s*var\(--qm-color-surface-sunken\)/);
    expect(css).not.toContain("body:has(.qm-query-panel)");
    expect(css).not.toContain("body:has(.qm-login)");
    expect(decls(".qm-app-header")).toMatch(/background:\s*var\(--qm-color-surface-base\)/);
  });

  it("G3 the sign-in product name uses a shipped weight (600), never a synthesised bold", () => {
    expect(decls(".qm-login__product")).toMatch(/font-weight:\s*600/);
  });
});

describe("parity pass: officer bar and account menu (spec 6.3: 48 px targets, 16 px text)", () => {
  it("G6 the skip link is a 48 px target on the officer's pages", () => {
    const skip = decls("body:has(.qm-app-header--compact) .qm-skip-link");
    expect(skip).toMatch(/min-height:\s*var\(--qm-target-min\)/);
    expect(skip).toMatch(/font-size:\s*var\(--qm-type-body-size\)/);
  });

  it("O1 the officer's account menu reads at body size: the sign-out button is 16 px, not 14", () => {
    expect(decls(".qm-app-header--compact .qm-account__panel .qm-button")).toMatch(
      /font-size:\s*var\(--qm-type-body-size\)/,
    );
  });
});
