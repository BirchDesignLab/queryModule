import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type RawFile,
  resolveSiteShape,
  type SiteConfig,
  validateResolved,
  validateSiteConfig,
} from "@querymodule/core/config";
import { TOKEN_NAMES } from "@querymodule/tokens";
import { describe, expect, it } from "vitest";
import { BUILTIN_ADAPTER_KINDS, tokensContrast } from "../../packages/api/src/config/load";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = resolve(root, "scripts", "ci", "config-validate.ts");
const tsxCli = require.resolve("tsx/cli");
const run = (args: string[]) =>
  spawnSync(process.execPath, [tsxCli, cli, ...args], { encoding: "utf8", cwd: root });

// Review CV1: "byte-identical to base" cannot literally hold (base printed
// native separators; item 2 deliberately makes head always print forward
// slashes, so base and head output differ by design on Windows). The
// invariant that actually matters, and that this CLI-level run proves
// directly against the real Node fs/path APIs on whichever OS runs this
// test (not just the pure `toPosixRel` function in config-validate.test.ts):
// head's own output never contains a backslash, on any host OS, so a
// PowerShell run and a Git Bash run of the same head commit are
// byte-identical to each other.
describe("config:validate CLI output has no backslashes (master plan 9, review CV1)", () => {
  // This spawns a real Node + tsx/cli subprocess to run config-validate.ts.
  // ~500ms in isolation, but tsx's own module-resolution/transpile startup
  // cost means it can exceed vitest's 5000ms default under full-suite
  // parallel load on Windows (same class of contention as the sensitive-review
  // spawn tests). Give it real headroom instead of relying on the default.
  it("prints only forward-slash paths for the shipped configs", { timeout: 20000 }, () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ok packages/config/sites/default.json");
    expect(r.stdout).not.toContain("\\");
    expect(r.stderr).not.toContain("\\");
  });
});

describe("config:validate arguments (#220 M3)", () => {
  it("`--` ends option parsing and a named file is checked", { timeout: 20000 }, () => {
    const r = run(["--", "packages/config/sites/default.json"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ok packages/config/sites/default.json");
  });

  it("--diff is an explicit reject with exit 2", { timeout: 20000 }, () => {
    const r = run(["--diff", "v1"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("config:validate: --diff arrives with M2 P2 (spec 7, 9.5)");
  });
});

describe("config:validate never crashes and matches the loader (wave review G-I1, G-I2)", () => {
  // A copy of packages/config, so the bad sites resolve their locales and mock file.
  const withSites = (sites: Record<string, (s: Record<string, unknown>) => void>) => {
    const dir = mkdtempSync(join(tmpdir(), "qm-cfgcli-"));
    cpSync(resolve(root, "packages/config"), dir, { recursive: true });
    const base = readFileSync(join(dir, "sites", "default.json"), "utf8");
    const files = Object.entries(sites).map(([name, edit]) => {
      const site = JSON.parse(base) as Record<string, unknown>;
      edit(site);
      const file = join(dir, "sites", `${name}.json`);
      writeFileSync(file, JSON.stringify(site));
      return file;
    });
    return { dir, files };
  };

  it("a non-hex theme override and a string locale bundle report keys, no stack or value, and later files still report", {
    timeout: 20000,
  }, () => {
    const { dir, files } = withSites({
      badtheme: (s) => {
        s.theme = { tokens: { all: { "color.severity.info.bg": "tomato" } } };
      },
    });
    writeFileSync(join(dir, "locales", "xx.json"), JSON.stringify("hello-bundle"));
    const localeSite = join(dir, "sites", "badlocale.json");
    const site = JSON.parse(readFileSync(join(dir, "sites", "default.json"), "utf8"));
    writeFileSync(localeSite, JSON.stringify({ ...site, locales: ["en", "xx"] }));
    try {
      const r = run(["--", ...files, localeSite, join(dir, "sites", "default.json")]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(
        /ERROR \S+badtheme\.json \/theme\/tokens config\.invalidTokenValue \{\}/,
      );
      expect(r.stderr).toMatch(/ERROR \S+badlocale\.json \/locales\/1 config\.invalidJson/);
      expect(r.stderr).not.toMatch(/tomato|hello-bundle|\n\s+at /);
      expect(r.stdout).toMatch(/ok \S+default\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a severity style naming a non-colour token fails, as the loader does", {
    timeout: 20000,
  }, () => {
    const { dir, files } = withSites({
      spacecolour: (s) => {
        (s.keywordSeverityStyles as { info: { color: string } }).info.color = "space.1";
      },
    });
    try {
      const r = run(["--", ...files]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(
        /ERROR \S+spacecolour\.json \/keywordSeverityStyles\/info config\.notColourToken \{\}/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(resolve(root, "packages/config", rel), "utf8"));
const shapeOf = (rel: string, base?: string): SiteConfig => {
  const site: RawFile = { ok: true, value: readJson(rel) };
  const r = resolveSiteShape(
    site,
    base ? { id: "default", file: { ok: true, value: readJson(base) } } : undefined,
  );
  if (!r.ok) throw new Error("shape failed");
  return r.config;
};
const realContext = {
  tokenNames: TOKEN_NAMES,
  contrast: tokensContrast,
  adapterKinds: BUILTIN_ADAPTER_KINDS,
  now: Date.now(),
};

describe("shipped sites pass under the real tokens contrast context (Task 6 carry forward)", () => {
  it("default and resolved example-ok have 0 errors from validateSiteConfig", () => {
    for (const config of [
      shapeOf("sites/default.json"),
      shapeOf("sites/example-ok.json", "sites/default.json"),
    ]) {
      const locales = Object.fromEntries(
        config.locales.map((l) => [l, readJson(`locales/${l}.json`) as Record<string, string>]),
      );
      expect(validateSiteConfig(config, locales, realContext).errors).toEqual([]);
    }
  });
});

describe("config.missingLocale pointer parity (#220 r1-b)", () => {
  it("core's missingLocale pointer is the one validateResolved filters: one diagnostic", () => {
    const config = shapeOf("sites/default.json");
    const missing = validateSiteConfig(config, {}, {}).errors.filter(
      (d) => d.key === "config.missingLocale",
    );
    expect(missing[0]?.path).toBe("/locales/0");
    const locale = config.locales[0] ?? "en";
    const r = validateResolved(config, { [locale]: { ok: false } }, realContext);
    expect(r.errors.filter((d) => d.path === "/locales/0")).toEqual([
      { level: "error", path: "/locales/0", key: "config.invalidJson", params: { locale } },
    ]);
    expect(r.errors.some((d) => d.key === "config.missingLocale")).toBe(false);
  });
});
