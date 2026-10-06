import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOKEN_NAMES } from "@querymodule/tokens";
import { afterEach, describe, expect, it } from "vitest";
import { generate } from "../mock-data/generate";
import {
  type ConfigIo,
  ConfigUnreadableError,
  checkConfigFile,
  configTargets,
  mockDriftErrors,
} from "./config-files";

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
    it(`${rel} has no errors and only the known required-without-position warnings`, () => {
      const r = checkConfigFile(cfg(rel), fsIo, { tokenNames: TOKEN_NAMES });
      expect(r.errors).toEqual([]);
      // VEH plateType (and plateColor, example-ok's own rule, #347); PRO and PROP make and
      // caliber, PROP description (per-type rules, #346). Each pointer is found by rule content
      // in the resolved config, not by a fixed rules/<n> index (#303).
      const okOnly = rel === "sites/example-ok.json";
      const resolved = r.resolved as {
        queryTypes: { code: string; rules: { field: string; effect: string }[] }[];
      };
      const required = (queryType: string, field: string, command: string) => {
        const qi = resolved.queryTypes.findIndex((q) => q.code === queryType);
        const ri = resolved.queryTypes[qi]?.rules.findIndex(
          (x) => x.field === field && x.effect === "require",
        );
        if (qi < 0 || ri === undefined || ri < 0)
          throw new Error(`no require rule for ${queryType} ${field}`);
        return {
          level: "warning",
          path: `/queryTypes/${qi}/rules/${ri}/field`,
          key: "config.conditionallyRequiredWithoutPosition",
          params: { field, command },
        };
      };
      expect(r.warnings).toEqual([
        required("VEH", "plateType", "VEH"),
        ...(okOnly ? [required("VEH", "plateColor", "VEH")] : []),
        required("PRO", "make", "PRO"),
        required("PRO", "make", "PROP"),
        required("PRO", "caliber", "PRO"),
        required("PRO", "caliber", "PROP"),
        required("PRO", "description", "PROP"),
      ]);
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

  it("a mock payload breaking the fixture policy fails with its pointer and file (#531, spec 10.8)", () => {
    const mock = structuredClone(fsIo.readJson(cfg("mock/default.json"))) as {
      sources: { stateSource: { responses: Array<{ scenarios: Array<{ respond: Json }> }> } };
    };
    const first = mock.sources.stateSource.responses[0]?.scenarios[0];
    if (first === undefined) throw new Error("default mock has no first scenario");
    first.respond.plate = "ABC1234";
    const r = checkConfigFile(
      cfg("sites/default.json"),
      layered({ [cfg("mock/default.json")]: mock }),
    );
    expect(r.errors).toContainEqual({
      level: "error",
      path: "/mock/sources/stateSource/responses/0/scenarios/0/respond/plate",
      key: "fixture.realPlate",
      params: { file: "packages/config/mock/default.json" },
    });
  });

  it("the shipped mock files pass the fixture policy", () => {
    for (const rel of ["sites/default.json", "sites/example-ok.json"]) {
      expect(checkConfigFile(cfg(rel), fsIo).errors).toEqual([]);
    }
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

describe("config:validate mock drift (#531, spec 10.8)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "config-files-drift-"));
    dirs.push(d);
    return d;
  };

  it("a drifted mock file fails with the regenerate hint", () => {
    const d = tmp();
    writeFileSync(join(d, "default.json"), `${generate("default")} `);
    writeFileSync(join(d, "example-ok.json"), generate("example-ok"));
    expect(mockDriftErrors(d)).toEqual([
      "mock file drift: mock/default.json (run scripts/mock-data/generate.ts default)",
    ]);
  });

  it("the committed mock files have no drift", () => {
    expect(mockDriftErrors(cfg("mock"))).toEqual([]);
  });

  it("AW1 review G-M2: a mock file with no generator site fails", () => {
    const d = tmp();
    writeFileSync(join(d, "default.json"), generate("default"));
    writeFileSync(join(d, "example-ok.json"), generate("example-ok"));
    writeFileSync(join(d, "orphan.json"), "{}\n");
    writeFileSync(join(d, "notes.txt"), "not a mock file\n");
    expect(mockDriftErrors(d)).toEqual([
      "mock file without a generator site: mock/orphan.json (add it to scripts/mock-data/generate.ts or delete it)",
    ]);
  });

  it("AW1 review G-M3: a generator that throws is a fixed-text error, not a stack", () => {
    const d = tmp();
    writeFileSync(join(d, "example-ok.json"), generate("example-ok"));
    const gen = (id: string) => {
      if (id === "default") throw new Error("mock-data: fixture policy violation");
      return generate(id);
    };
    expect(mockDriftErrors(d, gen)).toEqual([
      "mock generator failed: default (fix scripts/mock-data/sites/default.ts)",
    ]);
  });
  it("AW2 review G-G-M1: an unreadable mock directory is a fixed-text error, not a stack", () => {
    const d = join(tmp(), "missing");
    // AW3 review G-G-m1: one line for one cause, no drift line per site
    expect(mockDriftErrors(d)).toEqual([
      "mock directory unreadable: mock/ (restore packages/config/mock)",
    ]);
  });
});

describe("config:validate contrast and unreadable files (Task 9)", () => {
  it("resolved example-ok passes the contrast check with the real tokens context", () => {
    const r = checkConfigFile(cfg("sites/example-ok.json"), fsIo);
    expect(r.errors.some((e) => e.key === "config.severityContrast")).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it("a severity style that fails contrast reports config.severityContrast", () => {
    const site = defaultSite();
    site.keywordSeverityStyles.info.color = "color.severity.info.bg";
    site.keywordSeverityStyles.info.background = "color.severity.info.bg";
    const broken = cfg("sites/broken.json");
    const r = checkConfigFile(broken, layered({ [broken]: site }));
    expect(r.errors).toContainEqual(
      expect.objectContaining({
        path: "/keywordSeverityStyles/info",
        key: "config.severityContrast",
      }),
    );
  });

  it("an unreadable site file is config.unreadableFile, not missing", () => {
    const broken = cfg("sites/broken.json");
    const io: ConfigIo = {
      readJson: (p) => {
        if (p === broken) throw new ConfigUnreadableError();
        return fsIo.readJson(p);
      },
    };
    expect(checkConfigFile(broken, io).errors).toEqual([
      { level: "error", path: "", key: "config.unreadableFile", params: {} },
    ]);
  });

  it("an unreadable locale bundle is config.unreadableFile at its pointer", () => {
    const site = defaultSite();
    const broken = cfg("sites/broken.json");
    const localeFile = cfg(`locales/${(site.locales as string[])[0]}.json`);
    const io: ConfigIo = {
      readJson: (p) => {
        if (p === broken) return site;
        if (p === localeFile) throw new ConfigUnreadableError();
        return fsIo.readJson(p);
      },
    };
    expect(checkConfigFile(broken, io).errors).toEqual([
      { level: "error", path: "/locales/0", key: "config.unreadableFile", params: {} },
    ]);
  });
});

describe("config:validate every unreadable locale is reported (#303 Task 9, S1)", () => {
  it("two unreadable locale bundles give one error each at their own index", () => {
    const site = { ...defaultSite(), locales: ["en", "es"] };
    const broken = cfg("sites/broken.json");
    const io: ConfigIo = {
      readJson: (p) => {
        if (p === broken) return site;
        if (p === cfg("locales/en.json") || p === cfg("locales/es.json")) {
          throw new ConfigUnreadableError();
        }
        return fsIo.readJson(p);
      },
    };
    const errs = checkConfigFile(broken, io).errors.filter(
      (d) => d.key === "config.unreadableFile",
    );
    expect(errs).toEqual([
      { level: "error", path: "/locales/0", key: "config.unreadableFile", params: {} },
      { level: "error", path: "/locales/1", key: "config.unreadableFile", params: {} },
    ]);
  });
});

describe("config:validate unreadable files and read order (#303 Task 9)", () => {
  const broken = cfg("sites/broken.json");
  const withBase = (extra: Record<string, unknown>) => ({
    schemaVersion: 1,
    extends: "default",
    ...extra,
  });

  it("an unreadable base is config.unreadableFile at /extends", () => {
    const base = cfg("sites/default.json");
    const io: ConfigIo = {
      readJson: (p) => {
        if (p === broken) return withBase({});
        if (p === base) throw new ConfigUnreadableError();
        return fsIo.readJson(p);
      },
    };
    expect(checkConfigFile(broken, io).errors).toEqual([
      { level: "error", path: "/extends", key: "config.unreadableFile", params: {} },
    ]);
  });

  it("a site migration failure is reported even when the base is unreadable (base is read after migrate)", () => {
    const base = cfg("sites/default.json");
    const io: ConfigIo = {
      readJson: (p) => {
        if (p === broken) return { schemaVersion: 999, extends: "default" };
        if (p === base) throw new ConfigUnreadableError();
        return fsIo.readJson(p);
      },
    };
    expect(checkConfigFile(broken, io).errors).toEqual([
      {
        level: "error",
        path: "/schemaVersion",
        key: "config.schemaVersionTooNew",
        params: { found: 999, supported: 1 },
      },
    ]);
  });

  it("an unreadable mock file carries its path and does not hide the other errors", () => {
    const site = defaultSite();
    site.keywordSeverityStyles.info.color = "color.severity.info.bg";
    site.keywordSeverityStyles.info.background = "color.severity.info.bg";
    const mockFile = cfg("mock/default.json");
    const io: ConfigIo = {
      readJson: (p) => {
        if (p === broken) return site;
        if (p === mockFile) throw new ConfigUnreadableError();
        return fsIo.readJson(p);
      },
    };
    const r = checkConfigFile(broken, io);
    expect(r.errors).toContainEqual({
      level: "error",
      path: "/mock",
      key: "config.unreadableFile",
      params: { file: "packages/config/mock/default.json" },
    });
    expect(r.errors).toContainEqual(
      expect.objectContaining({
        path: "/keywordSeverityStyles/info",
        key: "config.severityContrast",
      }),
    );
  });

  it("a locale bundle with invalid JSON is one config.invalidJson through checkConfigFile, never also missingLocale (#220 r1-b)", () => {
    const site = defaultSite();
    const localeFile = cfg(`locales/${(site.locales as string[])[0]}.json`);
    const io: ConfigIo = {
      readJson: (p) => {
        if (p === broken) return site;
        if (p === localeFile) throw new SyntaxError("bad locale json");
        return fsIo.readJson(p);
      },
    };
    const r = checkConfigFile(broken, io);
    expect(r.errors.filter((d) => d.path === "/locales/0")).toEqual([
      expect.objectContaining({ level: "error", path: "/locales/0", key: "config.invalidJson" }),
    ]);
    expect(r.errors.some((d) => d.key === "config.missingLocale")).toBe(false);
  });
});

describe("config:validate runs the loader's pre- and post-checks (wave review G-I1, G-I2)", () => {
  const broken = cfg("sites/broken.json");

  it.each(["red", "#12"])(
    "a non-hex theme override %s is config.invalidTokenValue, no throw",
    (v) => {
      const site: RawSite = {
        ...defaultSite(),
        theme: { tokens: { all: { "color.severity.info.bg": v } } },
      };
      const r = checkConfigFile(broken, layered({ [broken]: site }));
      expect(r.errors).toEqual([
        { level: "error", path: "/theme/tokens", key: "config.invalidTokenValue", params: {} },
      ]);
      expect(JSON.stringify([r.errors, r.warnings])).not.toContain(v);
    },
  );

  it("a locale bundle that is not a JSON object is config.invalidJson at its pointer, no throw", () => {
    const site = defaultSite();
    const localeFile = cfg(`locales/${(site.locales as string[])[0]}.json`);
    const r = checkConfigFile(broken, layered({ [broken]: site, [localeFile]: "hello" }));
    expect(r.errors).toEqual([
      { level: "error", path: "/locales/0", key: "config.invalidJson", params: { locale: "en" } },
    ]);
  });

  it("a severity style naming a known non-colour token is config.notColourToken (UX-011)", () => {
    const site = defaultSite();
    site.keywordSeverityStyles.info.color = "space.1";
    const r = checkConfigFile(broken, layered({ [broken]: site }));
    expect(r.errors).toEqual([
      {
        level: "error",
        path: "/keywordSeverityStyles/info",
        key: "config.notColourToken",
        params: {},
      },
    ]);
  });

  it("any other throw is config.schema at the root, with no message or value", () => {
    const hostile = new Proxy(defaultSite(), {
      get(t, p) {
        if (p === "site") throw new Error("secret-config-value");
        return Reflect.get(t, p);
      },
    });
    const r = checkConfigFile(broken, layered({ [broken]: hostile }));
    expect(r).toEqual({
      file: broken,
      errors: [{ level: "error", path: "", key: "config.schema", params: {} }],
      warnings: [],
    });
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
