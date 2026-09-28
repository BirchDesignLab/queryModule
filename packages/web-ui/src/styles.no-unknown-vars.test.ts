import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { cssVarName, TOKEN_NAMES } from "@querymodule/tokens";
import { describe, expect, it } from "vitest";

describe("BR-001 styles.css uses only tokens.css variables (spec 6.5)", () => {
  it("has no unknown var(--...) reference", () => {
    // node:url's URL (not the global one, which jsdom's "environment: jsdom" shadows)
    // avoids failing Node fs's instanceof check on Windows (readFileSync(new URL(...))).
    const css = readFileSync(fileURLToPath(new NodeURL("./styles.css", import.meta.url)), "utf8");
    const known = new Set(TOKEN_NAMES.map(cssVarName));
    const used = [...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
    expect(used.filter((name) => !known.has(name))).toEqual([]);
  });
});
