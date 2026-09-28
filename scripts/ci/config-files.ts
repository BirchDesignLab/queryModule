import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkMockCoverage,
  type Diagnostic,
  extendsOf,
  type RawFile,
  resolveSiteShape,
  validateResolved,
} from "@querymodule/core/config";
import { TOKEN_NAMES } from "@querymodule/tokens";
import { BUILTIN_ADAPTER_KINDS, tokensContrast } from "../../packages/api/src/config/load";
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

class Unreadable extends Error {
  constructor(readonly at: string) {
    super("config.unreadableFile");
  }
}

/** Reads through the io; a file that exists but cannot be read aborts as config.unreadableFile at `at`. */
function read(io: ConfigIo, path: string, at: string): RawFile {
  try {
    return { ok: true, value: io.readJson(path) };
  } catch (e) {
    if (e instanceof ConfigUnreadableError) throw new Unreadable(at);
    return { ok: false };
  }
}

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
  } catch (e) {
    if (!(e instanceof Unreadable)) throw e;
    const errors: Diagnostic[] = [
      { level: "error", path: e.at, key: "config.unreadableFile", params: {} },
    ];
    return { file, errors, warnings: [] };
  }
}

function check(file: string, io: ConfigIo, options: CheckOptions): FileReport {
  const configDir = resolve(dirname(file), "..");
  const site = read(io, file, "");
  const ext = extendsOf(site.ok ? (site.value as { extends?: unknown } | undefined) : undefined);
  // extendsOf tolerates a non-object site; resolveSiteShape reports the real fault.
  if (!ext.ok) return { file, errors: ext.errors, warnings: [] };
  const base =
    ext.id === null
      ? undefined
      : { id: ext.id, file: read(io, resolve(configDir, "sites", `${ext.id}.json`), "/extends") };
  const shape = resolveSiteShape(site, base);
  if (!shape.ok) return { file, errors: shape.errors, warnings: [], resolved: shape.merged };
  const config = shape.config;

  const locales: Record<string, RawFile> = {};
  config.locales.forEach((code, i) => {
    locales[code] = read(io, resolve(configDir, "locales", `${code}.json`), `/locales/${i}`);
  });
  const result = validateResolved(config, locales, {
    tokenNames: options.tokenNames ?? TOKEN_NAMES,
    adapterKinds: BUILTIN_ADAPTER_KINDS,
    contrast: tokensContrast,
    now: options.now ?? Date.now(),
  });

  let mockErrors: Diagnostic[] = [];
  if (config.sources.some((s) => s.kind === "mock")) {
    const mockPath = resolve(configDir, "mock", `${config.site.id}.json`);
    // The mock file's repo-relative posix path rides in every mock diagnostic's params: the
    // "mock" pointer is into the mock document, so a reader needs its path (review C5).
    const mockFile = toPosixRel(relative(REPO_ROOT, mockPath));
    mockErrors = checkMockCoverage(config, read(io, mockPath, "/mock"), mockFile);
  }
  return {
    file,
    errors: [...result.errors, ...mockErrors],
    warnings: result.warnings,
    resolved: shape.merged,
  };
}
