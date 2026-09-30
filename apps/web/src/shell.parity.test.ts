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
  it("G1 the query panel and sign-in pages sit on surface.sunken; the header keeps surface.base", () => {
    for (const sel of ["body:has(.qm-query-panel)", "body:has(.qm-login)"])
      expect(decls(sel), sel).toMatch(/background:\s*var\(--qm-color-surface-sunken\)/);
    expect(decls(".qm-app-header")).toMatch(/background:\s*var\(--qm-color-surface-base\)/);
    // Scoped, not global: admin adopts sunken in its own pass.
    expect(decls("body")).toMatch(/background:\s*var\(--qm-color-surface-base\)/);
  });

  it("G3 the sign-in product name uses a shipped weight (600), never a synthesised bold", () => {
    expect(decls(".qm-login__product")).toMatch(/font-weight:\s*600/);
  });
});
