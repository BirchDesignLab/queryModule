import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type ConfigIo, checkConfigFile, configTargets } from "./config-files";

type Json = Record<string, unknown>;
/** Raw site JSON, typed only as far as these tests mutate it (ruling S12: no `any`). */
type RawSite = Json & { site: Json; sources: Json[]; quickAccess?: unknown };

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
      const r = checkConfigFile(cfg(rel), fsIo);
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
