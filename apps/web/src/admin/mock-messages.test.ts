import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EN_BUNDLE } from "../test/en-bundle.js";

// NFR-001 (CFG-2): every message the mock editor shows has an English string. jsdom's URL cannot
// resolve a relative file URL here, so the directory comes from node:path (en-bundle.ts precedent).
const dir = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(dir).filter(
  (f) => /^(Mock[A-Z].*|mock-.*)\.tsx?$/.test(f) && !f.includes(".test."),
);

const keysIn = (file: string): string[] => {
  const text = readFileSync(join(dir, file), "utf8");
  return [
    ...text.matchAll(/["'`](admin\.(?:mock|tree\.mock|diff\.mock)[A-Za-z0-9_.${}[\]()]*)["'`]/g),
  ].map((m) => m[1] as string);
};

describe("the mock editor's messages", () => {
  it("finds the files and the keys", () => {
    expect(sources).toContain("MockEditor.tsx");
    expect(sources.flatMap(keysIn).length).toBeGreaterThan(50);
  });

  it("every literal key has a string", () => {
    const missing = sources
      .flatMap(keysIn)
      .filter((k) => !k.includes("${"))
      .filter((k) => !(k in EN_BUNDLE));
    expect([...new Set(missing)]).toEqual([]);
  });

  it("the result labels built from a result name all exist", () => {
    for (const r of ["record", "noRecord", "error", "timeout", "creds"]) {
      expect(`admin.mock.result.${r}` in EN_BUNDLE).toBe(true);
      expect(`admin.mock.effect.${r}` in EN_BUNDLE).toBe(true);
    }
  });
});

describe("the bundle's shape", () => {
  it("no admin message key is also the parent of another (the nested bundle cannot hold both)", () => {
    const keys = Object.keys(EN_BUNDLE).filter((k) => k.startsWith("admin."));
    const parents = keys.filter((k) => keys.some((o) => o.startsWith(`${k}.`)));
    expect(parents).toEqual([]);
  });
});
