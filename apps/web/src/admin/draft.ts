import type { ResetController } from "@querymodule/client";
import {
  type ClientSiteConfig,
  type Diagnostic,
  type LocaleBundles,
  type SiteConfig,
  SiteConfigSchema,
  validateSiteConfig,
} from "@querymodule/core/config";
import type { ConfigDocument } from "@querymodule/core/contracts";

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

/** Immutable set at a path; unrelated branches keep their identity; undefined removes the key. */
export function setAtPath<T>(doc: T, path: readonly PathSegment[], value: unknown): T {
  const [head, ...rest] = path;
  if (head === undefined) return value as T;
  if (Array.isArray(doc)) {
    const copy: unknown[] = [...doc];
    copy[head as number] = setAtPath(copy[head as number], rest, value);
    return copy as T;
  }
  const obj = (doc ?? {}) as JsonObject;
  if (rest.length === 0 && value === undefined) {
    // Setting a key to undefined removes it (a blank optional control, a removed condition).
    const { [head]: _removed, ...others } = obj;
    return others as T;
  }
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
  /** Shipped strings of other locales; a locale absent here is checked against `bundle`. */
  perLocale: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
): DraftValidation {
  const built = buildSiteConfig(doc);
  if (!built.ok) return built;
  const locales: Record<string, Record<string, string>> = {};
  for (const locale of built.config.locales) {
    locales[locale] = { ...(perLocale[locale] ?? bundle), ...overlay[locale] };
  }
  const result = validateSiteConfig(built.config, locales as LocaleBundles);
  return { ok: true, errors: result.errors, warnings: result.warnings };
}

/** What the draft, its labels and the builder's selection were at one moment. */
interface Snapshot {
  doc: JsonObject | null;
  labels: LabelOverlay;
  /** The builder's selection (a tree pointer) then; opaque to the store. */
  meta: string | null;
}

/** What an undo or redo hands back: the selection to restore. */
export interface Restored {
  meta: string | null;
}

/** Steps kept for undo; older ones are dropped. */
export const HISTORY_LIMIT = 100;

/**
 * What the builder knows of the server's copy (Task 33 part 2a, ADR-0011): the live version it is
 * based on, the live view (for the unpublished-changes count and the diff), and the saved draft.
 * Memory only; the ResetController clears it with the draft.
 */
export interface ServerBase {
  /** The document the draft was loaded from or last saved as: what unchanged sections keep. */
  document: ConfigDocument;
  /** The site's id: the export file's name. */
  siteId: string;
  /** The live version the draft is based on (the optimistic lock of PUT /admin/config/draft). */
  baseVersion: number;
  /** The saved draft's version; null while the server has none. */
  draftVersion: number | null;
  liveDoc: JsonObject;
  liveLabels: LabelOverlay;
  /** The edits as last loaded or saved: what "unsaved" is measured against. */
  savedDoc: JsonObject;
  savedLabels: LabelOverlay;
}

/** The edits at one moment. */
export interface EditState {
  doc: JsonObject;
  labels: LabelOverlay;
}

export interface StartOptions {
  labels?: LabelOverlay;
  server?: ServerBase;
}

export interface SetPathOptions {
  coalesce?: boolean;
}

export interface ConfigDraftState {
  doc: JsonObject | null;
  labels: LabelOverlay;
  /** Steps that can be undone and redone (memory only, cleared with the draft). */
  undoCount: number;
  redoCount: number;
  /** What the server holds, once the builder has loaded it. */
  server: ServerBase | null;
  /** Seeds the draft once; a later call keeps the edits. */
  start(doc: JsonObject, options?: StartOptions): void;
  /** Replaces the draft with the server's copy (reload after a conflict or a publish); clears undo. */
  load(doc: JsonObject, labels: LabelOverlay, server: ServerBase): void;
  /**
   * The draft was saved as `document`, from the edits `saved` (what was sent, which may be older
   * than the edits now): it is the new merge base and the new saved copy.
   */
  markSaved(draftVersion: number, document: ConfigDocument, saved: EditState): void;
  /**
   * The live version moved on the server (a check, a roll back): its view replaces the one the
   * diff compares with. The edits, the draft's base version and the undo steps stay.
   */
  setLive(liveDoc: JsonObject, liveLabels: LabelOverlay): void;
  /** `coalesce`: a text entry, whose consecutive edits of one control are one undo step. */
  setPath(path: readonly PathSegment[], value: unknown, options?: SetPathOptions): void;
  setDoc(doc: JsonObject): void;
  setLabel(locale: string, key: string, text: string): void;
  removeLabel(locale: string, key: string): void;
  /** Records the builder's selection, so an undo can restore it. Not a step. */
  setMeta(meta: string | null): void;
  undo(): Restored | null;
  redo(): Restored | null;
  reset(): void;
}

export interface ConfigDraftStore {
  getState(): ConfigDraftState;
  subscribe(listener: () => void): () => void;
}

const valueAt = (doc: unknown, path: readonly PathSegment[]): unknown =>
  path.reduce<unknown>(
    (node, key) =>
      node === null || typeof node !== "object" ? undefined : (node as JsonObject)[key],
    doc,
  );

export function createConfigDraftStore(): ConfigDraftStore {
  const listeners = new Set<() => void>();
  let state: ConfigDraftState;
  let meta: string | null = null;
  let past: Snapshot[] = [];
  let future: Snapshot[] = [];
  // The text entry that made the last step: consecutive edits of that one control are one step
  // (typing is not a hundred undos). A structural edit, a toggle or a choice is always its own
  // step; an undo, a redo or choosing another item ends the run.
  let lastKey: string | null = null;
  const publish = (patch: Partial<ConfigDraftState> = {}): void => {
    state = { ...state, ...patch, undoCount: past.length, redoCount: future.length };
    for (const l of [...listeners]) l();
  };
  const snapshot = (): Snapshot => ({ doc: state.doc, labels: state.labels, meta });
  /** Records the state before an edit as a step, unless it continues the same edit. */
  const record = (key: string | null): void => {
    if (key !== null && key === lastKey && past.length > 0) return;
    past = [...past, snapshot()].slice(-HISTORY_LIMIT);
    future = [];
    lastKey = key;
  };
  const restore = (from: Snapshot): Restored => {
    meta = from.meta;
    lastKey = null;
    publish({ doc: from.doc, labels: from.labels });
    return { meta: from.meta };
  };
  state = {
    doc: null,
    labels: {},
    undoCount: 0,
    redoCount: 0,
    server: null,
    start(doc, options) {
      if (state.doc === null)
        publish({ doc, labels: options?.labels ?? {}, server: options?.server ?? null });
    },
    load(doc, labels, server) {
      meta = null;
      past = [];
      future = [];
      lastKey = null;
      publish({ doc, labels, server });
    },
    markSaved(draftVersion, document, saved) {
      if (state.server === null) return;
      publish({
        server: {
          ...state.server,
          document,
          draftVersion,
          savedDoc: saved.doc,
          savedLabels: saved.labels,
        },
      });
    },
    setLive(liveDoc, liveLabels) {
      if (state.server === null) return;
      publish({ server: { ...state.server, liveDoc, liveLabels } });
    },
    setPath(path, value, options) {
      if (state.doc === null || Object.is(valueAt(state.doc, path), value)) return;
      record(options?.coalesce === true ? `path:${path.join("\u0000")}` : null);
      publish({ doc: setAtPath(state.doc, path, value) });
    },
    setDoc(doc) {
      if (Object.is(state.doc, doc)) return;
      record("doc");
      publish({ doc });
    },
    setLabel(locale, key, text) {
      if (state.labels[locale]?.[key] === text) return;
      record(`label:${locale}\u0000${key}`);
      publish({ labels: { ...state.labels, [locale]: { ...state.labels[locale], [key]: text } } });
    },
    removeLabel(locale, key) {
      const own = state.labels[locale];
      if (own === undefined || !(key in own)) return;
      record(null);
      const { [key]: _gone, ...rest } = own;
      publish({ labels: { ...state.labels, [locale]: rest } });
    },
    setMeta(next) {
      if (next !== meta) lastKey = null;
      meta = next;
    },
    undo() {
      const back = past.at(-1);
      if (back === undefined) return null;
      const current = snapshot();
      past = past.slice(0, -1);
      future = [...future, current];
      return restore(back);
    },
    redo() {
      const forward = future.at(-1);
      if (forward === undefined) return null;
      const current = snapshot();
      future = future.slice(0, -1);
      past = [...past, current];
      return restore(forward);
    },
    reset() {
      meta = null;
      past = [];
      future = [];
      lastKey = null;
      publish({ doc: null, labels: {}, server: null });
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
