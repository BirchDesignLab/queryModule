import { MockFileSchema } from "../contracts/mock-file";
import { BOUNDED_ID_PATTERN } from "../contracts/primitives";
import { type Diagnostic, pointer } from "./diagnostic";
import { mergeSiteOverlay } from "./merge";
import { migrateConfig } from "./migrate";
import { type SiteConfig, SiteConfigSchema } from "./schema";
import { type ValidateContext, validateSiteConfig } from "./validate";

/** One read file: ok false = invalid JSON; value undefined = file missing. */
export type RawFile = { ok: true; value: unknown } | { ok: false };

export type ShapeResult =
  | { ok: true; config: SiteConfig; merged: unknown; extendsChain: string[] }
  | { ok: false; errors: Diagnostic[]; merged?: unknown };

const err = (path: string, key: string, params: Diagnostic["params"] = {}): Diagnostic => ({
  level: "error",
  path,
  key,
  params,
});

/** Spec 5.8 step 1: the base site id named by `extends`, checked before it becomes a path. */
export function extendsOf(
  site: unknown,
): { ok: true; id: string | null } | { ok: false; errors: Diagnostic[] } {
  const ext = (site as { extends?: unknown } | null | undefined)?.extends;
  if (ext === undefined) return { ok: true, id: null };
  // BR-001: mergeSiteOverlay drops `extends` before the strict parse, so check the id here,
  // before it becomes a path. Never echo the value (spec 5.9).
  if (typeof ext !== "string" || !BOUNDED_ID_PATTERN.test(ext))
    return { ok: false, errors: [err("/extends", "config.schema", { code: "invalid_format" })] };
  return { ok: true, id: ext };
}

/** Spec 5.8 steps 2 to 4: migrate each file, merge the overlay, strict parse. */
export function resolveSiteShape(site: RawFile, base?: { id: string; file: RawFile }): ShapeResult {
  const fail = (errors: Diagnostic[], merged?: unknown): ShapeResult =>
    merged === undefined ? { ok: false, errors } : { ok: false, errors, merged };
  if (!site.ok) return fail([err("", "config.invalidJson")]);
  if (site.value === undefined) return fail([err("", "config.fileMissing")]);
  const migrated = migrateConfig(site.value);
  if (!migrated.ok) return fail([migrated.error]);

  let merged: unknown = migrated.config;
  const extendsChain: string[] = [];
  const ext = extendsOf(migrated.config);
  if (!ext.ok) return fail(ext.errors);
  if (ext.id !== null) {
    if (!base || base.id !== ext.id)
      return fail([err("/extends", "config.unknownBase", { extends: ext.id })]);
    if (!base.file.ok) return fail([err("/extends", "config.invalidJson", { extends: ext.id })]);
    if (base.file.value === undefined)
      return fail([err("/extends", "config.unknownBase", { extends: ext.id })]);
    const baseMigrated = migrateConfig(base.file.value);
    if (!baseMigrated.ok) return fail([baseMigrated.error]);
    const m = mergeSiteOverlay(baseMigrated.config, migrated.config);
    if (m.errors.length > 0) return fail(m.errors);
    merged = m.config;
    extendsChain.push(ext.id);
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
  return { ok: true, config: parsed.data, merged, extendsChain };
}

/** Spec 5.8 step 5 (core half): locale bundles plus validateSiteConfig; drops the duplicate missingLocale for an unreadable bundle. */
export function validateResolved(
  config: SiteConfig,
  locales: Readonly<Record<string, RawFile>>,
  context: ValidateContext = {},
): { errors: Diagnostic[]; warnings: Diagnostic[] } {
  const bundles: Record<string, Record<string, string>> = {};
  const localeErrors: Diagnostic[] = [];
  const invalidLocalePointers = new Set<string>();
  config.locales.forEach((code, i) => {
    const bundle = locales[code];
    if (bundle && !bundle.ok) {
      // Invalid JSON is a different fault than a missing file. Leave the locale out of
      // `bundles` (seeding `{}` would flood config.missingLabel) and drop core's own
      // config.missingLocale for the same pointer below so the fault is reported once.
      localeErrors.push(err(pointer("locales", i), "config.invalidJson", { locale: code }));
      invalidLocalePointers.add(pointer("locales", i));
      return;
    }
    if (bundle?.value !== undefined) bundles[code] = bundle.value as Record<string, string>;
  });
  const result = validateSiteConfig(config, bundles, context);
  const resultErrors = result.errors.filter(
    (d) => !(d.key === "config.missingLocale" && invalidLocalePointers.has(d.path)),
  );
  return { errors: [...localeErrors, ...resultErrors], warnings: result.warnings };
}

/** Spec 5.4: mock coverage for kind "mock" sources; `mockFile` is the label carried in params. */
export function checkMockCoverage(
  config: SiteConfig,
  mock: RawFile,
  mockFile: string,
): Diagnostic[] {
  if (!config.sources.some((s) => s.kind === "mock")) return [];
  // Invalid JSON is a fault in the mock file: point into the mock document.
  if (!mock.ok)
    return [err(pointer("mock"), "config.invalidJson", { siteId: config.site.id, file: mockFile })];
  if (mock.value === undefined)
    return [err("/site/id", "config.missingMockFile", { siteId: config.site.id })];
  const parsed = MockFileSchema.safeParse(mock.value);
  if (!parsed.success) {
    return parsed.error.issues.map((i) =>
      err(pointer("mock", ...i.path.map((s) => String(s))), "config.mockSchema", {
        code: i.code,
        file: mockFile,
      }),
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
