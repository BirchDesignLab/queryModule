import type { ApiClient } from "@querymodule/client";
import {
  type Diagnostic,
  FEATURES,
  SiteConfigSchema,
  toClientSiteConfig,
} from "@querymodule/core/config";
import {
  AdminConfigResponseSchema,
  type ConfigDocument,
  ConfigDocumentSchema,
  type ConfigVersion,
  ConfigVersionListSchema,
  ConfigVersionSchema,
  ValidateConfigResponseSchema,
  type ValidationError,
} from "@querymodule/core/contracts";
import type { EditState, JsonObject, LabelOverlay, ServerBase } from "./draft.js";

/**
 * The builder and the server draft (Task 33 part 2a, #358, ADR-0011). The server stores a
 * ConfigDocument: the raw siteConfig plus the label overlay. The builder edits the client-shaped
 * view of the siteConfig (what dispatchers get, minus the hash); server-only sections (auth,
 * retention, role claims, source adapter settings) ride along untouched when the draft is saved.
 * Nothing here persists in the browser (spec 6.7).
 */

const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const objectOf = (v: unknown): JsonObject => (isObject(v) ? v : {});
const arrayOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const pick = (o: JsonObject, keys: readonly string[]): JsonObject =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** The top-level keys of the client view the builder shows, in the order the client config has them. */
const VIEW_KEYS = [
  "schemaVersion",
  "site",
  "locales",
  "features",
  "personas",
  "delegation",
  "terminal",
  "defaults",
  "picklists",
  "queryTypes",
  "commands",
  "keywords",
  "keywordSeverityStyles",
  "responseMappings",
  "quickAccess",
  "shortcuts",
  "theme",
  "sources",
] as const;

/**
 * Only for a siteConfig that does not validate: toClientSiteConfig needs a parsed config, and a
 * draft may be invalid while the builder must still open it, so this is its tolerant copy.
 */
function project(source: JsonObject): JsonObject {
  const features = objectOf(source.features);
  const delegation = objectOf(source.delegation);
  const view: JsonObject = {
    ...pick(source, VIEW_KEYS),
    ...(source.site === undefined ? {} : { site: pick(objectOf(source.site), ["id", "labelKey"]) }),
    features: Object.fromEntries(FEATURES.map((k) => [k, features[k] === true])),
    delegation: {
      ...(delegation.purposes === undefined
        ? {}
        : {
            purposes: arrayOf(delegation.purposes).map((p) =>
              pick(objectOf(p), ["key", "labelKey", "maxDurationMinutes"]),
            ),
          }),
      ...pick(delegation, ["maxDurationMinutes"]),
    },
  };
  if (source.sources !== undefined)
    view.sources = arrayOf(source.sources).map((s) =>
      pick(objectOf(s), ["id", "labelKey", "scope", "timeoutMs", "requiresCredentials"]),
    );
  return view;
}

/** The view of a siteConfig: schema defaults filled in when it validates, as the client sees it. */
function viewOf(siteConfig: JsonObject): JsonObject {
  const parsed = SiteConfigSchema.safeParse(siteConfig);
  if (parsed.success) {
    // The same function that builds what dispatchers get, so the two cannot drift apart.
    const { configHash: _hash, ...view } = toClientSiteConfig(parsed.data, "0".repeat(64));
    return structuredClone(view as JsonObject);
  }
  return structuredClone(project(siteConfig));
}

/** The server document as the builder's draft: the client-shaped siteConfig and the label overlay. */
export function editorOf(document: ConfigDocument): EditState {
  return { doc: viewOf(document.siteConfig), labels: structuredClone(document.locales) };
}

/**
 * What the builder opens on: the shared draft if there is one, else the live version. The draft's
 * base is the live version it was started from. After a conflict (`preferLive`), a draft that is
 * itself stale (its base is no longer live) is not offered again: it could never be saved.
 */
export function startOf(
  config: AdminConfig,
  options: { preferLive?: boolean } = {},
): EditState & { server: ServerBase } {
  const live = editorOf(config.live.document);
  const draft = config.draft;
  const useDraft =
    draft !== null && !(options.preferLive === true && draft.baseVersion !== config.live.version);
  const own = useDraft ? editorOf(draft.document) : live;
  return {
    ...own,
    server: {
      document: useDraft ? draft.document : config.live.document,
      siteId: config.siteId,
      baseVersion: useDraft ? (draft.baseVersion ?? config.live.version) : config.live.version,
      draftVersion: useDraft ? draft.version : null,
      liveDoc: live.doc,
      liveLabels: live.labels,
      savedDoc: own.doc,
      savedLabels: own.labels,
    },
  };
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => same(x, b[i]))
    );
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => same(a[k], b[k]));
  }
  return false;
}

/** An edited keyed list keeps each surviving item's server-only keys; a new item gets `fresh`. */
function mergeItems(base: unknown, edited: unknown, by: string, fresh: JsonObject): unknown {
  if (!Array.isArray(edited)) return edited;
  const old = new Map(arrayOf(base).map((item) => [objectOf(item)[by], objectOf(item)]));
  return edited.map((item) => {
    const own = objectOf(item);
    return { ...(old.get(own[by]) ?? fresh), ...own };
  });
}

function mergeKey(key: string, base: unknown, edited: unknown): unknown {
  if (key === "sources") return mergeItems(base, edited, "id", { kind: "mock" });
  if (key === "features" && isObject(edited)) return { ...objectOf(base), ...edited };
  if (key === "delegation" && isObject(edited))
    return {
      ...objectOf(base),
      ...edited,
      ...(edited.purposes === undefined
        ? {}
        : { purposes: mergeItems(objectOf(base).purposes, edited.purposes, "key", {}) }),
    };
  return edited;
}

/**
 * The builder's draft as a server document. A section the builder did not change keeps the base
 * document's own value (no defaults written in, no server-only keys lost); a changed one takes the
 * edit with its server-only keys merged back.
 */
export function documentFrom(
  base: ConfigDocument,
  doc: JsonObject,
  labels: LabelOverlay,
): ConfigDocument {
  const view = viewOf(base.siteConfig);
  const siteConfig: JsonObject = { ...base.siteConfig };
  for (const key of Object.keys(doc)) {
    if (!same(doc[key], view[key])) siteConfig[key] = mergeKey(key, base.siteConfig[key], doc[key]);
  }
  for (const key of VIEW_KEYS) if (!(key in doc) && key in view) delete siteConfig[key];
  const locales = Object.fromEntries(
    Object.entries(labels)
      .filter(([, texts]) => Object.keys(texts).length > 0)
      .map(([locale, texts]) => [locale, { ...texts }]),
  );
  return { siteConfig, locales, ...(base.mock === undefined ? {} : { mock: base.mock }) };
}

export type AdminConfig = ReturnType<typeof AdminConfigResponseSchema.parse>;

/** A load that failed: the route answered with an error, or its answer was not the contract. */
export class AdminConfigError extends Error {
  constructor() {
    super("admin config unavailable");
    this.name = "AdminConfigError";
  }
}

/** GET /api/v1/admin/config: the live version and the shared draft, parsed against the contract. */
export async function fetchAdminConfig(api: ApiClient): Promise<AdminConfig> {
  let data: unknown;
  try {
    data = (await api.GET("/api/v1/admin/config")).data;
  } catch {
    throw new AdminConfigError();
  }
  const parsed = AdminConfigResponseSchema.safeParse(data);
  if (!parsed.success) throw new AdminConfigError();
  return parsed.data;
}

export type SaveResult =
  | { ok: true; version: ConfigVersion }
  | { ok: false; reason: "conflict" | "error" };

/** PUT /api/v1/admin/config/draft with the live version the draft starts from. */
export async function saveDraft(
  api: ApiClient,
  baseVersion: number,
  document: ConfigDocument,
): Promise<SaveResult> {
  try {
    const { data, response } = await api.PUT("/api/v1/admin/config/draft", {
      body: { baseVersion, document },
    });
    if (response.status === 409) return { ok: false, reason: "conflict" };
    const parsed = ConfigVersionSchema.safeParse(data);
    return parsed.success ? { ok: true, version: parsed.data } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export type ValidateResult =
  | { ok: true; errors: Diagnostic[]; warnings: Diagnostic[] }
  | { ok: false };

/** POST /api/v1/admin/config/validate: the spec 5.8 chain on the server, diagnostics by pointer. */
export async function validateOnServer(
  api: ApiClient,
  document: ConfigDocument,
): Promise<ValidateResult> {
  try {
    const { data } = await api.POST("/api/v1/admin/config/validate", { body: { document } });
    const parsed = ValidateConfigResponseSchema.safeParse(data);
    return parsed.success
      ? { ok: true, errors: parsed.data.errors, warnings: parsed.data.warnings }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

export type PublishResult =
  | { ok: true; version: ConfigVersion }
  | { ok: false; reason: "conflict" | "error" }
  | { ok: false; reason: "invalid"; errors: ValidationError[] };

/** POST /api/v1/admin/config/publish for the saved draft's version. */
export async function publishDraft(api: ApiClient, draftVersion: number): Promise<PublishResult> {
  try {
    const { data, error, response } = await api.POST("/api/v1/admin/config/publish", {
      body: { draftVersion },
    });
    if (response.status === 409) return { ok: false, reason: "conflict" };
    if (response.status === 400) {
      const errors = (error as { error?: { errors?: ValidationError[] } } | undefined)?.error
        ?.errors;
      return { ok: false, reason: "invalid", errors: errors ?? [] };
    }
    const parsed = ConfigVersionSchema.safeParse(data);
    return parsed.success ? { ok: true, version: parsed.data } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** GET /api/v1/admin/config/versions: the history, newest first; null when it cannot be loaded. */
export async function fetchVersions(api: ApiClient): Promise<ConfigVersion[] | null> {
  try {
    const { data } = await api.GET("/api/v1/admin/config/versions");
    const parsed = ConfigVersionListSchema.safeParse(data);
    return parsed.success ? [...parsed.data.versions].sort((a, b) => b.version - a.version) : null;
  } catch {
    return null;
  }
}

export type RollbackResult =
  | { ok: true; version: ConfigVersion }
  | { ok: false; reason: "conflict" | "invalid" | "error" };

/** POST /api/v1/admin/config/versions/{version}/rollback: an older version published as a new one. */
export async function rollbackTo(api: ApiClient, version: number): Promise<RollbackResult> {
  try {
    const { data, response } = await api.POST("/api/v1/admin/config/versions/{version}/rollback", {
      params: { path: { version } },
    });
    if (response.status === 409) return { ok: false, reason: "conflict" };
    if (response.status === 400) return { ok: false, reason: "invalid" };
    const parsed = ConfigVersionSchema.safeParse(data);
    return parsed.success ? { ok: true, version: parsed.data } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** GET /api/v1/admin/config/versions/{version}/export: one version's document, or null. */
export async function exportVersion(
  api: ApiClient,
  version: number,
): Promise<ConfigDocument | null> {
  try {
    const { data } = await api.GET("/api/v1/admin/config/versions/{version}/export", {
      params: { path: { version } },
    });
    const parsed = ConfigDocumentSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
