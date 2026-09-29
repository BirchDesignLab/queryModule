import type { ResetController } from "@querymodule/client";
import {
  type ClientSiteConfig,
  type Diagnostic,
  type LocaleBundles,
  type SiteConfig,
  SiteConfigSchema,
  validateSiteConfig,
} from "@querymodule/core/config";

/**
 * The config builder's draft (Task 31, BR-001, FR-060). It is memory only: never localStorage,
 * sessionStorage, IndexedDB or a query persister (spec 6.7); the ResetController clears it on
 * logout, a 401 and a user change. Everything here is pure except the store.
 */

export type JsonObject = { [key: string]: unknown };
export type PathSegment = string | number;
/** locale -> label key -> text: the version's locale overlay. */
export type LabelOverlay = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Sections the builder never edits: they are server-only or derived (ADR-0011, ruling 09-29-26). */

/** The editable draft document: the client view without its hash. */
export function docFromClient(config: ClientSiteConfig): JsonObject {
  const { configHash: _hash, ...rest } = config;
  return structuredClone(rest) as JsonObject;
}

/** Immutable set at a path; unrelated branches keep their identity. */
export function setAtPath<T>(doc: T, path: readonly PathSegment[], value: unknown): T {
  const [head, ...rest] = path;
  if (head === undefined) return value as T;
  if (Array.isArray(doc)) {
    const copy: unknown[] = [...doc];
    copy[head as number] = setAtPath(copy[head as number], rest, value);
    return copy as T;
  }
  const obj = (doc ?? {}) as JsonObject;
  return { ...obj, [head]: setAtPath(obj[head], rest, value) } as T;
}

export type RawParse = { ok: true; doc: JsonObject } | { ok: false; message: string };

/** The raw JSON tab's text to a draft document, or the parser's own message. */
export function parseRawDraft(text: string): RawParse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid JSON" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: "The draft must be a JSON object" };
  }
  return { ok: true, doc: value as JsonObject };
}

export interface ShapeIssue {
  pointer: string;
  message: string;
}
export type BuildResult = { ok: true; config: SiteConfig } | { ok: false; issues: ShapeIssue[] };

export const toPointer = (path: readonly PropertyKey[]): string =>
  path.map((s) => `/${String(s).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");

/**
 * Rebuilds a SiteConfig from the client view: server-only parts take schema defaults and
 * sources get kind "mock". Section paths match the real config, so pointers carry over.
 */
export function buildSiteConfig(doc: JsonObject): BuildResult {
  const sources = Array.isArray(doc.sources) ? doc.sources : [];
  const delegation = (doc.delegation ?? {}) as JsonObject;
  const purposes = Array.isArray(delegation.purposes) ? delegation.purposes : [];
  const candidate = {
    ...doc,
    auth: {},
    retention: { payloadDays: null, valuesDays: null },
    delegation: {
      ...delegation,
      purposes: purposes.map((p) => ({ ...(p as JsonObject), delegatorRoles: ["admin"] })),
    },
    sources: sources.map((s) => ({ ...(s as JsonObject), kind: "mock" })),
  };
  const parsed = SiteConfigSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, config: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({ pointer: toPointer(i.path), message: i.message })),
  };
}

type BundleNode = { [key: string]: string | BundleNode };

/** A nested locale bundle to the flat dotted keys validateSiteConfig looks up. */
export function flattenBundle(bundle: BundleNode, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(bundle)) {
    const full = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") out[full] = value;
    else Object.assign(out, flattenBundle(value, full));
  }
  return out;
}

export type DraftValidation =
  | { ok: true; errors: Diagnostic[]; warnings: Diagnostic[] }
  | { ok: false; issues: ShapeIssue[] };

/** validateSiteConfig in the browser, with the bundle plus the draft's label overlay. */
export function validateDraft(
  doc: JsonObject,
  overlay: LabelOverlay,
  bundle: Readonly<Record<string, string>>,
): DraftValidation {
  const built = buildSiteConfig(doc);
  if (!built.ok) return built;
  const locales: Record<string, Record<string, string>> = {};
  for (const locale of built.config.locales) {
    locales[locale] = { ...bundle, ...overlay[locale] };
  }
  const result = validateSiteConfig(built.config, locales as LocaleBundles);
  return { ok: true, errors: result.errors, warnings: result.warnings };
}

export interface ConfigDraftState {
  doc: JsonObject | null;
  labels: LabelOverlay;
  /** Seeds the draft once; a later call keeps the edits. */
  start(doc: JsonObject): void;
  setPath(path: readonly PathSegment[], value: unknown): void;
  setDoc(doc: JsonObject): void;
  setLabel(locale: string, key: string, text: string): void;
  reset(): void;
}

export interface ConfigDraftStore {
  getState(): ConfigDraftState;
  subscribe(listener: () => void): () => void;
}

export function createConfigDraftStore(): ConfigDraftStore {
  const listeners = new Set<() => void>();
  let state: ConfigDraftState;
  const set = (patch: Partial<Pick<ConfigDraftState, "doc" | "labels">>): void => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  };
  state = {
    doc: null,
    labels: {},
    start(doc) {
      if (state.doc === null) set({ doc });
    },
    setPath(path, value) {
      if (state.doc !== null) set({ doc: setAtPath(state.doc, path, value) });
    },
    setDoc(doc) {
      set({ doc });
    },
    setLabel(locale, key, text) {
      set({ labels: { ...state.labels, [locale]: { ...state.labels[locale], [key]: text } } });
    },
    reset() {
      set({ doc: null, labels: {} });
    },
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Logout, a 401 and a user change clear the draft (spec 6.7). */
export function registerConfigDraft(reset: ResetController, store: ConfigDraftStore): () => void {
  return reset.register(() => store.getState().reset());
}
