import { dirname, resolve } from "node:path";
import {
  type Diagnostic,
  mergeSiteOverlay,
  migrateConfig,
  pointer,
  type SiteConfig,
  SiteConfigSchema,
  type ValidateContext,
  validateSiteConfig,
} from "@querymodule/core/config";
import { BOUNDED_ID_PATTERN, MockFileSchema } from "@querymodule/core/contracts";

export interface ConfigIo {
  /** undefined when the file does not exist; throws on invalid JSON. */
  readJson(path: string): unknown;
}
export interface CheckOptions {
  tokenNames?: readonly string[];
  /** Adapter kinds from the API's registry (spec 5.8, ruling W3-1). The CLI sets neither in P0. */
  adapterKinds?: readonly string[];
}
export interface FileReport {
  file: string;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  resolved?: unknown;
}

const err = (path: string, key: string, params: Diagnostic["params"] = {}): Diagnostic => ({
  level: "error",
  path,
  key,
  params,
});

function read(io: ConfigIo, path: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: io.readJson(path) };
  } catch {
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
  const fail = (errors: Diagnostic[], resolved?: unknown): FileReport => ({
    file,
    errors,
    warnings: [],
    resolved,
  });
  const raw = read(io, file);
  if (!raw.ok) return fail([err("", "config.invalidJson")]);
  if (raw.value === undefined) return fail([err("", "config.fileMissing")]);
  const migrated = migrateConfig(raw.value);
  if (!migrated.ok) return fail([migrated.error]);

  let merged: unknown = migrated.config;
  const ext = migrated.config.extends;
  // BR-001: mergeSiteOverlay drops `extends` before the strict parse, so check the id here,
  // before it becomes a path. Never echo the value (spec 5.9).
  if (ext !== undefined && (typeof ext !== "string" || !BOUNDED_ID_PATTERN.test(ext)))
    return fail([err("/extends", "config.schema", { code: "invalid_format" })]);
  if (typeof ext === "string") {
    const baseRaw = read(io, resolve(dirname(file), "..", "sites", `${ext}.json`));
    if (!baseRaw.ok) return fail([err("/extends", "config.invalidJson", { extends: ext })]);
    if (baseRaw.value === undefined)
      return fail([err("/extends", "config.unknownBase", { extends: ext })]);
    const base = migrateConfig(baseRaw.value);
    if (!base.ok) return fail([base.error]);
    const m = mergeSiteOverlay(base.config, migrated.config);
    if (m.errors.length > 0) return fail(m.errors);
    merged = m.config;
  }

  const parsed = SiteConfigSchema.safeParse(merged);
  if (!parsed.success) {
    return fail(
      parsed.error.issues.map((i) =>
        err(pointer(...i.path.map((s) => String(s))), "config.schema", { code: i.code }),
      ),
      merged,
    );
  }
  const config = parsed.data;

  const locales: Record<string, Record<string, string>> = {};
  const localeErrors: Diagnostic[] = [];
  config.locales.forEach((code, i) => {
    const bundle = read(io, resolve(dirname(file), "..", "locales", `${code}.json`));
    if (!bundle.ok) {
      // Invalid JSON is a different fault than a missing file (item 4): report it
      // here, and mark the bundle present-but-empty so validateSiteConfig's own
      // missingLocale check does not also fire for the same locale.
      localeErrors.push(err(pointer("locales", i), "config.invalidJson", { locale: code }));
      locales[code] = {};
      return;
    }
    if (bundle.value !== undefined) locales[code] = bundle.value as Record<string, string>;
  });
  const context: ValidateContext = {};
  if (options.tokenNames) context.tokenNames = options.tokenNames;
  if (options.adapterKinds) context.adapterKinds = options.adapterKinds;
  const result = validateSiteConfig(config, locales, context);
  return {
    file,
    errors: [...localeErrors, ...result.errors, ...checkMocks(file, config, io)],
    warnings: result.warnings,
    resolved: merged,
  };
}

export function checkMocks(file: string, config: SiteConfig, io: ConfigIo): Diagnostic[] {
  if (!config.sources.some((s) => s.kind === "mock")) return [];
  const raw = read(io, resolve(dirname(file), "..", "mock", `${config.site.id}.json`));
  // Invalid JSON here is a fault in the mock file, not the site file: point the
  // diagnostic into the mock document (the "mock" pointer prefix, same shape as
  // the mockSchema diagnostics below) so a reader is sent to the right file (item 5).
  if (!raw.ok) return [err(pointer("mock"), "config.invalidJson", { siteId: config.site.id })];
  if (raw.value === undefined)
    return [err("/site/id", "config.missingMockFile", { siteId: config.site.id })];
  const parsed = MockFileSchema.safeParse(raw.value);
  if (!parsed.success) {
    return parsed.error.issues.map((i) =>
      err(pointer("mock", ...i.path.map((s) => String(s))), "config.mockSchema", { code: i.code }),
    );
  }
  const out: Diagnostic[] = [];
  if (parsed.data.siteId !== config.site.id)
    out.push(err("/site/id", "config.mockSiteMismatch", { siteId: parsed.data.siteId }));
  config.sources.forEach((s, i) => {
    if (s.kind !== "mock") return;
    const spec = parsed.data.sources[s.id];
    if (!spec) {
      out.push(err(pointer("sources", i, "id"), "config.missingMock", { sourceId: s.id }));
      return;
    }
    for (const qt of config.queryTypes) {
      if (
        qt.sources.some((x) => x.sourceId === s.id) &&
        !spec.responses.some((r) => r.queryType === qt.code)
      ) {
        out.push(
          err(pointer("sources", i, "id"), "config.missingMockResponse", {
            sourceId: s.id,
            queryType: qt.code,
          }),
        );
      }
    }
  });
  return out;
}
