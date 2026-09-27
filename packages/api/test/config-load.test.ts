import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigLoadError, canonicalJson, loadSiteConfig } from "../src/config/load";

const bundled = resolve(import.meta.dirname, "../../config");
function copy(): string {
  const d = mkdtempSync(join(tmpdir(), "qm-config-"));
  cpSync(join(bundled, "sites"), join(d, "sites"), { recursive: true });
  cpSync(join(bundled, "locales"), join(d, "locales"), { recursive: true });
  return d;
}

describe("BR-001 site config load", () => {
  it("loads the bundled default site", async () => {
    const c = await loadSiteConfig(join(bundled, "sites/default.json"));
    expect(c.configHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.fieldKeys).toContain("plate");
    expect(Object.keys(c.locales)).toEqual(c.siteConfig.locales);
    expect(c.clientConfig.configHash).toBe(c.configHash);
  });
  it("hash ignores key order", async () => {
    const d = copy();
    const file = join(d, "sites/default.json");
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(raw).reverse());
    const a = await loadSiteConfig(file);
    writeFileSync(file, JSON.stringify(reversed));
    expect((await loadSiteConfig(file)).configHash).toBe(a.configHash);
  });
  it("client view is the allowlist", async () => {
    const c = await loadSiteConfig(join(bundled, "sites/default.json"));
    const body = c.clientConfig as unknown as Record<string, unknown>;
    for (const k of ["auth", "retention", "extends"]) expect(body).not.toHaveProperty(k);
    for (const s of c.clientConfig.sources)
      expect(Object.keys(s).sort()).toEqual([
        "id",
        "labelKey",
        "requiresCredentials",
        "scope",
        "timeoutMs",
      ]);
  });
  it("fails closed on unknown keys, extends and missing locales", async () => {
    const d = copy();
    const file = join(d, "sites/default.json");
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...raw, surprise: 1 }));
    await expect(loadSiteConfig(file)).rejects.toThrow(ConfigLoadError);
    writeFileSync(file, JSON.stringify({ ...raw, extends: "default" }));
    await expect(loadSiteConfig(file)).rejects.toThrow(/extends/);
    writeFileSync(file, JSON.stringify(raw));
    rmSync(join(d, "locales"), { recursive: true });
    await expect(loadSiteConfig(file)).rejects.toThrow(/locale/);
  });
  it("canonicalJson sorts keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
  });
  it("canonicalJson writes undefined array elements as null, like JSON.stringify", () => {
    expect(canonicalJson([1, undefined, { a: undefined }])).toBe(
      JSON.stringify([1, undefined, { a: undefined }]),
    );
  });
});

describe("NFR-001 locale bundles", () => {
  it("reports the real reason for a bad locale bundle instead of always saying missing", async () => {
    const d = copy();
    const file = join(d, "sites/default.json");
    const raw = JSON.parse(readFileSync(file, "utf8")) as { locales: string[] };
    const locale = raw.locales[0];
    const bundleFile = join(d, "locales", `${locale}.json`);
    writeFileSync(bundleFile, "{ not json");
    await expect(loadSiteConfig(file)).rejects.toThrow(/invalid JSON/);
    rmSync(bundleFile);
    await expect(loadSiteConfig(file)).rejects.toThrow(/file not readable/);
  });
});
