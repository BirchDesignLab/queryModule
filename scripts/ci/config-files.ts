import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkMockCoverage,
  type Diagnostic,
  extendsOf,
  migrateConfig,
  type RawFile,
  resolveSiteShape,
  validateResolved,
} from "@querymodule/core/config";
import { TOKEN_NAMES } from "@querymodule/tokens";
import {
  BUILTIN_ADAPTER_KINDS,
  colourTokenChecks,
  preResolvedChecks,
  tokensContrast,
} from "../../packages/api/src/config/load";
import { toPosixRel } from "./cli-io";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface ConfigIo {
  /** undefined when the file does not exist; throws on invalid JSON, or ConfigUnreadableError. */
  readJson(path: string): unknown;
}
/** Thrown by a ConfigIo for a file that exists but cannot be read (not invalid JSON). */
export class ConfigUnreadableError extends Error {
  constructor() {
    super("config.unreadableFile");
    this.name = "ConfigUnreadableError";
  }
}
export interface CheckOptions {
  tokenNames?: readonly string[];
  /** Epoch ms for the contrast/expiry checks; defaults to the clock (the CLI may read it). */
  now?: number;
}
export interface FileReport {
  file: string;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  resolved?: unknown;
}

/** A read through the io: a RawFile, or the file exists but cannot be read (not invalid JSON). */
type Read = RawFile | { unreadable: true };

function read(io: ConfigIo, path: string): Read {
  try {
    return { ok: true, value: io.readJson(path) };
  } catch (e) {
    if (e instanceof ConfigUnreadableError) return { unreadable: true };
    return { ok: false };
  }
}
const isUnreadable = (r: Read): r is { unreadable: true } => "unreadable" in r;
const unreadableAt = (path: string, params: Diagnostic["params"] = {}): Diagnostic => ({
  level: "error",
  path,
  key: "config.unreadableFile",
  params,
});

/**
 * The files config:validate checks: the explicit ones, else the default listing.
 * An empty result fails, so an emptied sites/ and test/ never passes silently.
 */
export function configTargets(
  explicit: string[],
  listDefault: () => string[],
): { ok: true; targets: string[] } | { ok: false; message: string } {
  const targets = explicit.length > 0 ? explicit : listDefault();
  if (targets.length === 0)
    return { ok: false, message: "config:validate: no config files found to check" };
  return { ok: true, targets };
}

export function checkConfigFile(
  file: string,
  io: ConfigIo,
  options: CheckOptions = {},
): FileReport {
  try {
    return check(file, io, options);
  } catch {
    // Any other throw is config.schema at the root: never a stack or a message, which can echo a
    // config value (spec 5.9, #220), and the report for later files goes on (wave review G-I1).
    return {
      file,
      errors: [{ level: "error", path: "", key: "config.schema", params: {} }],
      warnings: [],
    };
  }
}

function check(file: string, io: ConfigIo, options: CheckOptions): FileReport {
  const configDir = resolve(dirname(file), "..");
  const site = read(io, file);
  if (isUnreadable(site)) return { file, errors: [unreadableAt("")], warnings: [] };

  // The base is read only after the site migrates and names it, so a migration fault is never
  // masked by an unreadable base (#303). resolveSiteShape migrates again; migration is pure.
  let base: { id: string; file: RawFile } | undefined;
  if (site.ok && site.value !== undefined) {
    const migrated = migrateConfig(site.value);
    if (!migrated.ok) return { file, errors: [migrated.error], warnings: [] };
    const ext = extendsOf(migrated.config);
    if (!ext.ok) return { file, errors: ext.errors, warnings: [] };
    if (ext.id !== null) {
      const baseFile = read(io, resolve(configDir, "sites", `${ext.id}.json`));
      if (isUnreadable(baseFile)) return { file, errors: [unreadableAt("/extends")], warnings: [] };
      base = { id: ext.id, file: baseFile };
    }
  }
  const shape = resolveSiteShape(site, base);
  if (!shape.ok) return { file, errors: shape.errors, warnings: [], resolved: shape.merged };
  const config = shape.config;

  // Every unreadable locale bundle is reported (not just the first); the rest cannot be checked.
  const locales: Record<string, RawFile> = {};
  const unreadableLocales: Diagnostic[] = [];
  config.locales.forEach((code, i) => {
    const bundle = read(io, resolve(configDir, "locales", `${code}.json`));
    if (isUnreadable(bundle)) unreadableLocales.push(unreadableAt(`/locales/${i}`));
    else locales[code] = bundle;
  });
  if (unreadableLocales.length > 0) return { file, errors: unreadableLocales, warnings: [] };
  // The loader's own pre- and post-checks, so "ok" here means the server starts (G-I1, G-I2).
  const pre = preResolvedChecks(config, locales);
  const result =
    pre.length > 0
      ? { errors: pre, warnings: [] }
      : validateResolved(config, locales, {
          tokenNames: options.tokenNames ?? TOKEN_NAMES,
          adapterKinds: BUILTIN_ADAPTER_KINDS,
          contrast: tokensContrast,
          now: options.now ?? Date.now(),
        });
  if (pre.length === 0 && result.errors.length === 0)
    result.errors.push(...colourTokenChecks(config));

  let mockErrors: Diagnostic[] = [];
  if (config.sources.some((s) => s.kind === "mock")) {
    const mockPath = resolve(configDir, "mock", `${config.site.id}.json`);
    // The mock file's repo-relative posix path rides in every mock diagnostic's params: the
    // "mock" pointer is into the mock document, so a reader needs its path (review C5).
    const mockFile = toPosixRel(relative(REPO_ROOT, mockPath));
    const mock = read(io, mockPath);
    // An unreadable mock file does not hide the errors already found.
    mockErrors = isUnreadable(mock)
      ? [unreadableAt("/mock", { file: mockFile })]
      : checkMockCoverage(config, mock, mockFile);
  }
  return {
    file,
    errors: [...result.errors, ...mockErrors],
    warnings: result.warnings,
    resolved: shape.merged,
  };
}
