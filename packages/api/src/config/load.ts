import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type ClientSiteConfig,
  type ContrastContext,
  checkMockCoverage,
  type Diagnostic,
  extendsOf,
  type RawFile,
  resolveSiteShape,
  type SiteConfig,
  toClientSiteConfig,
  validateResolved,
} from "@querymodule/core/config";
import {
  contrastFailures,
  contrastRatio,
  TOKEN_NAMES,
  type TokenName,
  tokenValue,
} from "@querymodule/tokens";

export interface LoadedConfig {
  siteConfig: SiteConfig;
  configHash: string;
  clientConfig: ClientSiteConfig;
  configDir: string;
  fieldKeys: string[];
  locales: Record<string, Record<string, unknown>>;
  /** Base site ids merged under this site, nearest first (spec 5.8); empty without `extends`. */
  extendsChain: string[];
  /** Non-fatal diagnostics (keys, pointers, params only) for the caller to log. */
  warnings: Diagnostic[];
}

/** Adapter kinds this build supports; plugins from ADAPTER_DIR arrive with the registry (M1 P3). */
export const BUILTIN_ADAPTER_KINDS: readonly string[] = ["mock"];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Token lookups for the core contrast checks (spec 4.1, UX-011). */
export const tokensContrast: ContrastContext = {
  value: (token, mode, overrides) => {
    const v = Object.hasOwn(overrides, token)
      ? overrides[token]
      : (TOKEN_NAMES as readonly string[]).includes(token)
        ? tokenValue(token as TokenName, mode)
        : undefined;
    // Non-colour values (scale tokens, bad overrides) are skipped, never thrown on.
    return typeof v === "string" && HEX.test(v) ? v : undefined;
  },
  ratio: contrastRatio,
  failures: (mode, overrides) =>
    contrastFailures(mode, overrides).map((f) => ({
      fg: f.pair.fg,
      bg: f.pair.bg,
      min: f.pair.min,
      ratio: f.ratio,
    })),
};
export class ConfigLoadError extends Error {
  constructor(
    readonly file: string,
    readonly path: string,
    reason: string,
  ) {
    super(`config ${file} at ${path || "/"}: ${reason}`);
    this.name = "ConfigLoadError";
  }
}

export function canonicalJson(v: unknown): string {
  // undefined elements become null, as in JSON.stringify, so the output is always valid JSON
  if (Array.isArray(v))
    return `[${v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Reads a JSON file into a RawFile: undefined value = missing, ok false = invalid JSON. */
async function readRaw(file: string): Promise<RawFile> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { ok: true, value: undefined };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function firstError(file: string, errors: Diagnostic[]): ConfigLoadError {
  const d = errors[0];
  // Keys and pointers only: params can carry config-derived text (spec 5.9).
  return new ConfigLoadError(file, d?.path ?? "", d?.key ?? "config.schema");
}

export async function loadSiteConfig(
  siteConfigFile: string,
  o: { allowMockSources: boolean; now: number },
): Promise<LoadedConfig> {
  const file = resolve(siteConfigFile);
  const configDir = resolve(dirname(file), "..");
  const site = await readRaw(file);
  const ext = extendsOf(site.ok ? site.value : undefined);
  if (!ext.ok) throw firstError(file, ext.errors);
  const base =
    ext.id === null
      ? undefined
      : { id: ext.id, file: await readRaw(join(configDir, "sites", `${ext.id}.json`)) };
  const shape = resolveSiteShape(site, base);
  if (!shape.ok) throw firstError(file, shape.errors);
  const siteConfig = shape.config;

  const rawLocales: Record<string, RawFile> = {};
  for (const locale of siteConfig.locales)
    rawLocales[locale] = await readRaw(join(configDir, "locales", `${locale}.json`));

  siteConfig.locales.forEach((locale, i) => {
    const v = rawLocales[locale];
    if (
      v?.ok &&
      v.value !== undefined &&
      (v.value === null || typeof v.value !== "object" || Array.isArray(v.value))
    )
      throw new ConfigLoadError(file, `/locales/${i}`, "config.invalidJson");
  });
  const theme = siteConfig.theme?.tokens;
  for (const group of Object.values(theme ?? {}))
    for (const v of Object.values(group ?? {}))
      if (!HEX.test(v))
        throw new ConfigLoadError(file, "/theme/tokens", "config.invalidTokenValue");

  let result: ReturnType<typeof validateResolved>;
  try {
    result = validateResolved(siteConfig, rawLocales, {
      adapterKinds: BUILTIN_ADAPTER_KINDS,
      contrast: tokensContrast,
      tokenNames: TOKEN_NAMES,
      now: o.now,
    });
  } catch {
    // Never surface a raw error: its message can echo a config value (spec 5.9).
    throw new ConfigLoadError(file, "", "config.schema");
  }
  const { errors, warnings } = result;
  if (errors.length > 0) throw firstError(file, errors);
  // A known token that is not a colour (a scale token) cannot be contrast-checked (UX-011).
  for (const [severity, style] of Object.entries(siteConfig.keywordSeverityStyles))
    for (const t of [style.color, style.background])
      if (tokensContrast.value(t, "day", {}) === undefined)
        throw new ConfigLoadError(
          file,
          `/keywordSeverityStyles/${severity}`,
          "config.notColourToken",
        );

  const mockIndex = siteConfig.sources.findIndex((s) => s.kind === "mock");
  if (mockIndex >= 0) {
    if (!o.allowMockSources)
      throw new ConfigLoadError(
        file,
        `/sources/${mockIndex}/kind`,
        "mock sources need ALLOW_MOCK_SOURCES=true",
      );
    const mockPath = join(configDir, "mock", `${siteConfig.site.id}.json`);
    const mockErrors = checkMockCoverage(siteConfig, await readRaw(mockPath), mockPath);
    if (mockErrors.length > 0) throw firstError(file, mockErrors);
  }

  const locales: Record<string, Record<string, unknown>> = {};
  for (const [code, raw] of Object.entries(rawLocales))
    if (raw.ok && raw.value !== undefined) locales[code] = raw.value as Record<string, unknown>;
  const configHash = createHash("sha256").update(canonicalJson(siteConfig)).digest("hex");
  const fieldKeys = [...new Set(siteConfig.queryTypes.flatMap((q) => q.fields.map((f) => f.key)))];
  return {
    siteConfig,
    configHash,
    clientConfig: toClientSiteConfig(siteConfig, configHash),
    configDir,
    fieldKeys,
    locales,
    extendsChain: shape.extendsChain,
    warnings,
  };
}
