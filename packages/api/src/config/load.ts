import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type ClientSiteConfig,
  type ContrastContext,
  checkMockCoverage,
  type Diagnostic,
  extendsOf,
  pointer,
  type RawFile,
  resolveSiteShape,
  type SiteConfig,
  toClientSiteConfig,
  validateResolved,
} from "@querymodule/core/config";
import { type ConfigDocument, ConfigDocumentSchema } from "@querymodule/core/contracts";
import {
  contrastFailures,
  contrastRatio,
  TOKEN_NAMES,
  type TokenName,
  tokenValue,
} from "@querymodule/tokens";
import { BUILTIN_ADAPTER_KINDS } from "../adapters/kinds";

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

/** The live snapshot: a loaded config and the stored version it came from (#511 CFG-3). */
export interface VersionedConfig extends LoadedConfig {
  versionId: string;
}

/** Re-exported from the leaf module so config:validate imports stay unchanged (spec 5.4). */
export { BUILTIN_ADAPTER_KINDS };

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
/**
 * Checks validateResolved relies on, run by the loader and config:validate alike (spec 4.1, 5.9):
 * each locale bundle read is a JSON object, and every theme override is #rrggbb (the contrast
 * check throws on anything else). Keys and pointers only; no config value rides in params.
 */
export function preResolvedChecks(
  config: SiteConfig,
  rawLocales: Record<string, RawFile>,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  config.locales.forEach((locale, i) => {
    const v = rawLocales[locale];
    if (
      v?.ok &&
      v.value !== undefined &&
      (v.value === null || typeof v.value !== "object" || Array.isArray(v.value))
    )
      out.push({
        level: "error",
        path: `/locales/${i}`,
        key: "config.invalidJson",
        params: { locale },
      });
  });
  const groups = Object.values(config.theme?.tokens ?? {});
  if (groups.some((g) => Object.values(g ?? {}).some((v) => !HEX.test(v))))
    out.push({
      level: "error",
      path: "/theme/tokens",
      key: "config.invalidTokenValue",
      params: {},
    });
  return out;
}

/**
 * A known token that is not a colour (a scale token) cannot be contrast-checked (UX-011). Run
 * after validateResolved reports no errors (unknown tokens are its config.unknownToken).
 */
export function colourTokenChecks(config: SiteConfig): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [severity, style] of Object.entries(config.keywordSeverityStyles))
    if (
      [style.color, style.background].some((t) => tokensContrast.value(t, "day", {}) === undefined)
    )
      out.push({
        level: "error",
        path: `/keywordSeverityStyles/${severity}`,
        key: "config.notColourToken",
        params: {},
      });
  return out;
}

export class ConfigLoadError extends Error {
  constructor(
    readonly file: string,
    readonly path: string,
    /** A message key (config.*) or fixed text; never config content (spec 5.9). */
    readonly reason: string,
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
/**
 * Only a file that does not exist reads as missing; any other read error (EACCES, EISDIR, EMFILE)
 * fails closed as config.unreadableFile at the pointer that names the file, so the diagnostic is
 * never misleading. `siteFile` and `path` locate the error; neither carries file content.
 */
async function readRaw(file: string, siteFile: string, path: string): Promise<RawFile> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: undefined };
    throw new ConfigLoadError(siteFile, path, "config.unreadableFile");
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** A mock source where ALLOW_MOCK_SOURCES is not true (spec 5.4 Kind). */
const MOCK_NOT_ALLOWED = "config.mockSourcesNotAllowed";

function firstError(file: string, errors: Diagnostic[]): ConfigLoadError {
  const d = errors[0];
  // Keys and pointers only: params can carry config-derived text (spec 5.9).
  const reason = d?.key === MOCK_NOT_ALLOWED ? "mock sources need ALLOW_MOCK_SOURCES=true" : d?.key;
  return new ConfigLoadError(file, d?.path ?? "", reason ?? "config.schema");
}

/** The chain's outcome: the loaded config, or every diagnostic of the first failing step. */
export type ChainResult =
  | { ok: true; config: LoadedConfig }
  | { ok: false; errors: Diagnostic[]; warnings: Diagnostic[] };

/** Where the spec 5.8 chain reads its inputs: the site files, or a stored ConfigDocument. */
interface ChainSource {
  /** Names the source in a ConfigLoadError: the site file path, or the stored site and version. */
  label: string;
  configDir: string;
  site: RawFile;
  /** The base site an `extends` names; a stored document is already resolved and has none. */
  readBase?: (id: string) => Promise<RawFile>;
  readLocale: (locale: string, index: number) => Promise<RawFile>;
  readMock: (siteId: string) => Promise<RawFile>;
}

/**
 * Spec 5.8 steps 1 to 6 on one source: migrate, merge any base, strict parse, locale bundles,
 * validateSiteConfig, contrast and colour checks, mock coverage, then the config hash. Stops at
 * the first step with errors and answers all of that step's diagnostics (keys, pointers and
 * params; the caller decides what leaves the process). An unreadable file still throws.
 */
async function checkChain(
  src: ChainSource,
  o: { allowMockSources: boolean; now: number },
): Promise<ChainResult> {
  const fail = (errors: Diagnostic[], warnings: Diagnostic[] = []): ChainResult => ({
    ok: false,
    errors,
    warnings,
  });
  const ext = extendsOf(src.site.ok ? src.site.value : undefined);
  if (!ext.ok) return fail(ext.errors);
  const base =
    ext.id === null || !src.readBase ? undefined : { id: ext.id, file: await src.readBase(ext.id) };
  const shape = resolveSiteShape(src.site, base);
  if (!shape.ok) return fail(shape.errors);
  const siteConfig = shape.config;

  const rawLocales: Record<string, RawFile> = {};
  for (const [i, locale] of siteConfig.locales.entries())
    rawLocales[locale] = await src.readLocale(locale, i);

  const pre = preResolvedChecks(siteConfig, rawLocales);
  if (pre.length > 0) return fail(pre);

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
    return fail([{ level: "error", path: "", key: "config.schema", params: {} }]);
  }
  const { errors, warnings } = result;
  if (errors.length > 0) return fail(errors, warnings);
  const colour = colourTokenChecks(siteConfig);
  if (colour.length > 0) return fail(colour, warnings);

  const mockIndex = siteConfig.sources.findIndex((s) => s.kind === "mock");
  if (mockIndex >= 0) {
    if (!o.allowMockSources)
      return fail(
        [{ level: "error", path: `/sources/${mockIndex}/kind`, key: MOCK_NOT_ALLOWED, params: {} }],
        warnings,
      );
    const mockErrors = checkMockCoverage(
      siteConfig,
      await src.readMock(siteConfig.site.id),
      `${siteConfig.site.id}.json`,
    );
    if (mockErrors.length > 0) return fail(mockErrors, warnings);
  }

  const locales: Record<string, Record<string, unknown>> = {};
  for (const [code, raw] of Object.entries(rawLocales))
    if (raw.ok && raw.value !== undefined) locales[code] = raw.value as Record<string, unknown>;
  const configHash = createHash("sha256").update(canonicalJson(siteConfig)).digest("hex");
  const fieldKeys = [...new Set(siteConfig.queryTypes.flatMap((q) => q.fields.map((f) => f.key)))];
  return {
    ok: true,
    config: {
      siteConfig,
      configHash,
      clientConfig: toClientSiteConfig(siteConfig, configHash),
      configDir: src.configDir,
      fieldKeys,
      locales,
      extendsChain: shape.extendsChain,
      warnings,
    },
  };
}

/** The chain as a loader: throws ConfigLoadError with keys and pointers only (spec 5.9). */
async function runChain(
  src: ChainSource,
  o: { allowMockSources: boolean; now: number },
): Promise<LoadedConfig> {
  const r = await checkChain(src, o);
  if (!r.ok) throw firstError(src.label, r.errors);
  return r.config;
}

/** The config root a site file sits in: its locales, mock and sibling sites. */
export const configDirOf = (file: string) => resolve(dirname(file), "..");

export async function loadSiteConfig(
  siteConfigFile: string,
  o: { allowMockSources: boolean; now: number },
): Promise<LoadedConfig> {
  const file = resolve(siteConfigFile);
  const configDir = configDirOf(file);
  return runChain(
    {
      label: file,
      configDir,
      site: await readRaw(file, file, ""),
      readBase: (id) => readRaw(join(configDir, "sites", `${id}.json`), file, "/extends"),
      readLocale: (locale, i) =>
        readRaw(join(configDir, "locales", `${locale}.json`), file, `/locales/${i}`),
      readMock: (siteId) => readRaw(join(configDir, "mock", `${siteId}.json`), file, "/mock"),
    },
    o,
  );
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * ADR-0011 item 1: the SITE_CONFIG file as a version 1 document. The file runs the full chain
 * first (an invalid file seeds nothing). The document holds the resolved site (extends merged),
 * an empty locale overlay and, only where mock sources are allowed, the site's mock file.
 */
export async function bootstrapDocument(
  siteConfigFile: string,
  o: { allowMockSources: boolean; now: number },
): Promise<{ config: LoadedConfig; document: ConfigDocument }> {
  const config = await loadSiteConfig(siteConfigFile, o);
  const file = resolve(siteConfigFile);
  const siteConfig = JSON.parse(JSON.stringify(config.siteConfig)) as Record<string, unknown>;
  const document: ConfigDocument = { siteConfig, locales: {} };
  if (o.allowMockSources) {
    const mock = await readRaw(
      join(config.configDir, "mock", `${config.siteConfig.site.id}.json`),
      file,
      "/mock",
    );
    if (mock.ok && isPlainObject(mock.value)) document.mock = mock.value;
  }
  return { config, document };
}

interface DocumentOptions {
  label: string;
  configDir: string;
  allowMockSources: boolean;
  now: number;
}

/**
 * ADR-0011 items 2 and 5: a config document through the full spec 5.8 chain, answering the
 * diagnostics instead of throwing. The strict ConfigDocument parse comes first (its pointers
 * are into the document); the chain's pointers are into siteConfig, as validateSiteConfig's in
 * the browser, and into /mock for the mock. The label overlay applies over the bundled locale
 * files in configDir; the mock is the document's own.
 */
export async function checkConfigDocument(
  document: unknown,
  o: DocumentOptions,
): Promise<ChainResult> {
  const parsed = ConfigDocumentSchema.safeParse(document);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        level: "error",
        path: pointer(...issue.path.map((s) => String(s))),
        key: "config.documentSchema",
        params: {},
      })),
      warnings: [],
    };
  const doc = parsed.data;
  return checkChain(
    {
      label: o.label,
      configDir: o.configDir,
      site: { ok: true, value: doc.siteConfig },
      readLocale: async (locale, i) => {
        const bundle = await readRaw(
          join(o.configDir, "locales", `${locale}.json`),
          o.label,
          `/locales/${i}`,
        );
        const overlay = Object.hasOwn(doc.locales, locale) ? doc.locales[locale] : undefined;
        if (overlay === undefined || !bundle.ok) return bundle;
        if (bundle.value === undefined) return { ok: true, value: overlay };
        return isPlainObject(bundle.value)
          ? { ok: true, value: { ...bundle.value, ...overlay } }
          : bundle;
      },
      readMock: async () => ({ ok: true, value: doc.mock }),
    },
    o,
  );
}

/**
 * ADR-0011 item 2: a stored document through the full spec 5.8 chain, never trusted unvalidated.
 * Throws ConfigLoadError at the first error (keys and pointers only); label names the site and
 * version.
 */
export async function loadConfigDocument(
  document: unknown,
  o: DocumentOptions,
): Promise<LoadedConfig> {
  const r = await checkConfigDocument(document, o);
  if (!r.ok) throw firstError(o.label, r.errors);
  return r.config;
}
