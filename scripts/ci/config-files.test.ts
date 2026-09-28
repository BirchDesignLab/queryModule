import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOKEN_NAMES } from "@querymodule/tokens";
import { describe, expect, it } from "vitest";
import { type ConfigIo, checkConfigFile, configTargets } from "./config-files";

type Json = Record<string, unknown>;
/** Raw site JSON, typed only as far as these tests mutate it (ruling S12: no `any`). */
type RawSite = Json & {
  site: Json;
  sources: Json[];
  queryTypes: (Json & { fields: Json[] })[];
  quickAccess?: unknown;
  keywordSeverityStyles: { critical: Json; warning: Json; info: Json };
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cfg = (rel: string) => resolve(root, "packages/config", rel);
const fsIo: ConfigIo = {
  readJson: (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined),
};
const layered = (overrides: Record<string, unknown>): ConfigIo => ({
  readJson: (p) => (p in overrides ? overrides[p] : fsIo.readJson(p)),
});
const defaultSite = () => structuredClone(fsIo.readJson(cfg("sites/default.json"))) as RawSite;

describe("BR-001 config:validate over shipped files (spec 7, 9.3 step 3)", () => {
  for (const rel of [
    "sites/default.json",
    "sites/example-ok.json",
    "test/all-on.json",
    "test/flags-off.json",
  ]) {
    it(`${rel} is clean`, () => {
      const r = checkConfigFile(cfg(rel), fsIo, { tokenNames: TOKEN_NAMES });
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
    });
  }

  it("--resolved content is the merged overlay", () => {
    const r = checkConfigFile(cfg("sites/example-ok.json"), fsIo);
    expect((r.resolved as { site: { id: string } }).site.id).toBe("example-ok");
  });
});

describe("config:validate failures carry JSON paths", () => {
  const broken = cfg("sites/broken.json");

  it("unknown base site", () => {
    const r = checkConfigFile(broken, layered({ [broken]: { schemaVersion: 1, extends: "nope" } }));
    expect(r.errors).toEqual([
      { level: "error", path: "/extends", key: "config.unknownBase", params: { extends: "nope" } },
    ]);
  });

  it("extends outside the bounded id pattern is rejected before any read (BR-001)", () => {
    const r = checkConfigFile(
      broken,
      layered({ [broken]: { schemaVersion: 1, extends: "../sites/default" } }),
    );
    expect(r.errors).toEqual([
      {
        level: "error",
        path: "/extends",
        key: "config.schema",
        params: { code: "invalid_format" },
      },
    ]);
    expect(r.resolved).toBeUndefined();
  });

  it("schema error maps the zod path to a pointer", () => {
    const site = defaultSite();
    delete site.sources[0]?.kind;
    const r = checkConfigFile(broken, layered({ [broken]: site }));
    expect(r.errors).toContainEqual(
      expect.objectContaining({ path: "/sources/0/kind", key: "config.schema" }),
    );
  });

  it("#61 a nested labelKey outside the message-key pattern fails at its pointer (review M3)", () => {
    const site = defaultSite();
    const field = site.queryTypes[0]?.fields[0];
    if (!field) throw new Error("default site has no field");
    field.labelKey = "field.plate-ZZ";
    const r = checkConfigFile(broken, layered({ [broken]: site }));
    expect(r.errors).toContainEqual(
      expect.objectContaining({ path: "/queryTypes/0/fields/0/labelKey", key: "config.schema" }),
    );
  });

  it("newer schema version", () => {
    const r = checkConfigFile(
      broken,
      layered({ [broken]: { ...defaultSite(), schemaVersion: 9 } }),
    );
    expect(r.errors[0]?.key).toBe("config.schemaVersionTooNew");
  });

  it("invalid JSON", () => {
    const io: ConfigIo = {
      readJson: () => {
        throw new SyntaxError("Unexpected token");
      },
    };
    expect(checkConfigFile(broken, io).errors).toEqual([
      { level: "error", path: "", key: "config.invalidJson", params: {} },
    ]);
  });

  it("invalid JSON locale bundle is reported as invalidJson, not missingLocale (item 4)", () => {
    const site = defaultSite();
    const locale = (site.locales as string[])[0] ?? "en";
    const localeFile = resolve(root, "packages/config/locales", `${locale}.json`);
    const io: ConfigIo = {
      readJson: (p) => {
        if (p === broken) return site;
        if (p === localeFile) throw new SyntaxError("bad locale json");
        return fsIo.readJson(p);
      },
    };
    const r = checkConfigFile(broken, io);
    // Exactly one diagnostic for this locale (review C2): seeding an empty
    // `{}` bundle used to make core's checkLabels treat every label key as
    // missing for this locale, flooding the output with config.missingLabel
    // on top of the real config.invalidJson fault.
    expect(r.errors).toEqual([
      { level: "error", path: "/locales/0", key: "config.invalidJson", params: { locale } },
    ]);
    expect(r.errors.some((e) => e.key === "config.missingLocale")).toBe(false);
    expect(r.errors.some((e) => e.key === "config.missingLabel")).toBe(false);
  });

  it("mock file invalid JSON points into the mock document, not the site file (item 5)", () => {
    const site = defaultSite();
    const mockFile = cfg("mock/default.json");
    const io: ConfigIo = {
      readJson: (p) => {
        if (p === broken) return site;
        if (p === mockFile) throw new SyntaxError("bad mock json");
        return fsIo.readJson(p);
      },
    };
    const r = checkConfigFile(broken, io);
    // The mock file's own repo-relative posix path travels in params (review
    // C5) so a reader is actually sent to the mock file, not just told its
    // site id: `/mock` is a pointer inside the mock document, not a path to
    // it, and config-validate prints the *site* file's path alongside it.
    expect(r.errors).toContainEqual({
      level: "error",
      path: "/mock",
      key: "config.invalidJson",
      params: { siteId: "default", file: "packages/config/mock/default.json" },
    });
  });

  it("mock schema issues point into the mock document and carry the mock file path (item 5, review C5)", () => {
    const mock = structuredClone(fsIo.readJson(cfg("mock/default.json"))) as { siteId: unknown };
    mock.siteId = 123;
    const r = checkConfigFile(
      cfg("sites/default.json"),
      layered({ [cfg("mock/default.json")]: mock }),
    );
    expect(r.errors).toContainEqual(
      expect.objectContaining({
        path: "/mock/siteId",
        key: "config.mockSchema",
        params: expect.objectContaining({ file: "packages/config/mock/default.json" }),
      }),
    );
  });

  it("missing mock file for a site with mock sources", () => {
    const site = defaultSite();
    site.site.id = "nomock";
    const r = checkConfigFile(broken, layered({ [broken]: site }));
    expect(r.errors).toContainEqual({
      level: "error",
      path: "/site/id",
      key: "config.missingMockFile",
      params: { siteId: "nomock" },
    });
  });

  it("mock file without a spec for a mock source", () => {
    const mock = structuredClone(fsIo.readJson(cfg("mock/default.json"))) as {
      sources: Record<string, unknown>;
    };
    delete mock.sources.nationalSource;
    const r = checkConfigFile(
      cfg("sites/default.json"),
      layered({ [cfg("mock/default.json")]: mock }),
    );
    expect(r.errors).toContainEqual({
      level: "error",
      path: "/sources/1/id",
      key: "config.missingMock",
      params: { sourceId: "nationalSource" },
    });
  });

  it("mock source without a response for a query type it serves", () => {
    const mock = structuredClone(fsIo.readJson(cfg("mock/default.json"))) as {
      sources: { nationalSource: { responses: Array<{ queryType: string }> } };
    };
    mock.sources.nationalSource.responses = mock.sources.nationalSource.responses.filter(
      (r) => r.queryType !== "WNT",
    );
    const r = checkConfigFile(
      cfg("sites/default.json"),
      layered({ [cfg("mock/default.json")]: mock }),
    );
    expect(r.errors).toContainEqual({
      level: "error",
      path: "/sources/1/id",
      key: "config.missingMockResponse",
      params: { sourceId: "nationalSource", queryType: "WNT" },
    });
  });

  it("referential errors from validateSiteConfig pass through", () => {
    const site = defaultSite();
    site.quickAccess = ["VEH", "XYZ"];
    const r = checkConfigFile(broken, layered({ [broken]: site }));
    expect(r.errors).toContainEqual(
      expect.objectContaining({ path: "/quickAccess/1", key: "config.unknownQueryType" }),
    );
  });

  it("unknown severity token with tokenNames supplied", () => {
    const site = defaultSite();
    site.keywordSeverityStyles.info.color = "color.nope";
    const r = checkConfigFile(broken, layered({ [broken]: site }), { tokenNames: TOKEN_NAMES });
    expect(r.errors).toContainEqual(
      expect.objectContaining({
        path: "/keywordSeverityStyles/info/color",
        key: "config.unknownToken",
      }),
    );
  });
});

describe("config:validate targets (fails closed on empty input)", () => {
  it("fails when no config file is found in the default directories", () => {
    const r = configTargets([], () => []);
    expect(r.ok).toBe(false);
  });

  it("uses explicit files when given, else the default listing", () => {
    expect(configTargets(["a.json"], () => ["b.json"])).toEqual({ ok: true, targets: ["a.json"] });
    expect(configTargets([], () => ["b.json"])).toEqual({ ok: true, targets: ["b.json"] });
  });
});
