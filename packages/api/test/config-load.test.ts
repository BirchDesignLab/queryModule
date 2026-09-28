import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigLoadError, canonicalJson, loadSiteConfig as load } from "../src/config/load";

const OPTS = { allowMockSources: true, now: Date.UTC(2026, 8, 28) };
const loadSiteConfig = (f: string, o: Partial<typeof OPTS> = {}) => load(f, { ...OPTS, ...o });

const bundled = resolve(import.meta.dirname, "../../config");
function copy(): string {
  const d = mkdtempSync(join(tmpdir(), "qm-config-"));
  cpSync(join(bundled, "sites"), join(d, "sites"), { recursive: true });
  cpSync(join(bundled, "locales"), join(d, "locales"), { recursive: true });
  cpSync(join(bundled, "mock"), join(d, "mock"), { recursive: true });
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
  it("fails closed on unknown keys and missing locales", async () => {
    const d = copy();
    const file = join(d, "sites/default.json");
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...raw, surprise: 1 }));
    await expect(loadSiteConfig(file)).rejects.toThrow(ConfigLoadError);
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
    await expect(loadSiteConfig(file)).rejects.toThrow(/config.invalidJson/);
    rmSync(bundleFile);
    await expect(loadSiteConfig(file)).rejects.toThrow(/config.missingLocale/);
  });
});

interface Doc {
  defaults: Record<string, unknown>;
  sources: { kind: string }[];
  keywordSeverityStyles: Record<string, { background: string }>;
  [k: string]: unknown;
}
function edit(d: string, rel: string, f: (j: Doc) => void): string {
  const file = join(d, rel);
  const j = JSON.parse(readFileSync(file, "utf8")) as Doc;
  f(j);
  writeFileSync(file, JSON.stringify(j));
  return file;
}
async function fails(file: string, o: Partial<typeof OPTS> = {}): Promise<ConfigLoadError> {
  const e = await loadSiteConfig(file, o).then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ConfigLoadError);
  return e as ConfigLoadError;
}

describe("BR-001 config load chain (spec 5.8)", () => {
  it("loads example-ok over default", async () => {
    const c = await loadSiteConfig(join(bundled, "sites/example-ok.json"));
    expect(c.extendsChain).toEqual(["default"]);
    expect(c.clientConfig.terminal.delimiter).toBe("/");
    expect(c.configHash).toBe(
      createHash("sha256").update(canonicalJson(c.siteConfig)).digest("hex"),
    );
    expect(c.warnings).toBeInstanceOf(Array);
  });
  it("default site has an empty extends chain", async () => {
    const c = await loadSiteConfig(join(bundled, "sites/default.json"));
    expect(c.extendsChain).toEqual([]);
  });
  it("a missing base is config.unknownBase at /extends", async () => {
    const d = copy();
    rmSync(join(d, "sites/default.json"));
    const e = await fails(join(d, "sites/example-ok.json"));
    expect(e.path).toBe("/extends");
    expect(e.message).toContain("config.unknownBase");
  });
  it("a removed label key is config.missingLabel", async () => {
    const d = copy();
    edit(d, "locales/en.json", (j) => {
      delete j["field.tagSticker"];
    });
    const e = await fails(join(d, "sites/example-ok.json"));
    expect(e.message).toContain("config.missingLabel");
  });
  it("an unknown adapter kind is config.unknownAdapterKind", async () => {
    const d = copy();
    const file = edit(d, "sites/default.json", (j) => {
      j.sources[0].kind = "radio";
    });
    expect((await fails(file)).message).toContain("config.unknownAdapterKind");
  });
  it("SEC-002 mock sources are refused unless allowed", async () => {
    const e = await fails(join(bundled, "sites/default.json"), { allowMockSources: false });
    expect(e.path).toBe("/sources/0/kind");
    expect(e.message).toContain("ALLOW_MOCK_SOURCES=true");
  });
  it("a missing mock file is config.missingMockFile when mocks are allowed", async () => {
    const d = copy();
    rmSync(join(d, "mock/default.json"));
    expect((await fails(join(d, "sites/default.json"))).message).toContain(
      "config.missingMockFile",
    );
  });
  it("UX-011 a failing severity override is config.severityContrast", async () => {
    const d = copy();
    const file = edit(d, "sites/default.json", (j) => {
      j.keywordSeverityStyles.critical.background = "color.severity.critical.fg";
    });
    expect((await fails(file)).message).toContain("config.severityContrast");
  });
  it("warnings come back without throwing", async () => {
    const d = copy();
    const file = edit(d, "sites/default.json", (j) => {
      j.defaults.zzUnused = "x";
    });
    const c = await loadSiteConfig(file);
    expect(c.warnings.map((w) => w.key)).toContain("config.unusedSiteDefault");
  });
  it("SEC-006 the error names key and pointer, never a field value", async () => {
    const d = copy();
    const file = edit(d, "sites/default.json", (j) => {
      j.defaults.state = "ZZ-0001";
    });
    const e = await fails(file);
    expect(e.message).not.toContain("ZZ-0001");
    expect(e.message).toContain("config.");
  });
});

describe("SEC-006 startup faults are ConfigLoadError with no config value", () => {
  interface Theme {
    theme?: { tokens?: { all?: Record<string, string> } };
    keywordSeverityStyles: Record<string, { color: string }>;
    [k: string]: unknown;
  }
  function editTheme(d: string, f: (j: Theme) => void): string {
    const file = join(d, "sites/default.json");
    const j = JSON.parse(readFileSync(file, "utf8")) as Theme;
    f(j);
    writeFileSync(file, JSON.stringify(j));
    return file;
  }
  it("an unknown severity token is config.unknownToken", async () => {
    const file = editTheme(copy(), (j) => {
      j.keywordSeverityStyles.critical.color = "nosuch.token";
    });
    expect((await fails(file)).message).toContain("config.unknownToken");
  });
  it("a non-hex theme override is a keyed ConfigLoadError without the value", async () => {
    const file = editTheme(copy(), (j) => {
      j.theme = { ...j.theme, tokens: { all: { "color.text.body": "SECRETVALUE-zz" } } };
    });
    const e = await fails(file);
    expect(e.message).not.toContain("SECRETVALUE");
    expect(e.message).toContain("/theme/tokens");
  });
  it("a scale token used as a severity colour does not throw a raw error", async () => {
    const file = editTheme(copy(), (j) => {
      j.keywordSeverityStyles.critical.color = "space.1";
    });
    const e = await fails(file);
    expect(e.message).toContain("config.notColourToken");
  });
  it("a prototype-named override token is not read through the prototype", async () => {
    const file = editTheme(copy(), (j) => {
      j.keywordSeverityStyles.critical.color = "constructor";
    });
    const e = await fails(file);
    expect(e.message).toContain("config.unknownToken");
  });
  it("a locale bundle holding a JSON string is config.invalidJson at its pointer", async () => {
    const d = copy();
    const file = join(d, "sites/default.json");
    const raw = JSON.parse(readFileSync(file, "utf8")) as { locales: string[] };
    writeFileSync(join(d, "locales", `${raw.locales[0]}.json`), JSON.stringify("SECRETVALUE-zz"));
    const e = await fails(file);
    expect(e.message).toContain("config.invalidJson");
    expect(e.message).toContain("/locales/0");
    expect(e.message).not.toContain("SECRETVALUE");
  });
});
