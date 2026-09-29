import { createStore, type StoreApi } from "zustand/vanilla";

/** User values as entered (spec 6.7). */
export type DraftValue = string | boolean | null;

/** Form or terminal (spec 6.2 "toggle" layout); one global mode, memory only (D-B10). */
export type PanelMode = "form" | "terminal";

/** `sources: null` means the FormState defaults. */
export interface QueryDraft {
  values: Readonly<Record<string, DraftValue>>;
  sources: readonly string[] | null;
}

export interface DraftState {
  queryType: string | null;
  drafts: Readonly<Record<string, QueryDraft>>;
  /** Keeps every other type's draft (spec 4.4 draft merge, 6.7). */
  select(queryType: string): void;
  /** On the selected type. */
  setValue(key: string, value: DraftValue): void;
  setSources(sourceIds: readonly string[]): void;
  /** M1 P3 applies mergeDraft through this. */
  replaceValues(queryType: string, values: Readonly<Record<string, DraftValue>>): void;
  /** Global, not per query type (D-B10); "form" after reset. */
  mode: PanelMode;
  setMode(mode: PanelMode): void;
  /** The terminal input's text; "" after reset. */
  terminalText: string;
  setTerminalText(text: string): void;
  reset(): void;
}

export type DraftStore = StoreApi<DraftState>;

const EMPTY_DRAFT: QueryDraft = { values: {}, sources: null };

/** Own keys only: a type named "constructor" or "toString" must not hit Object.prototype. */
function draftOf(drafts: Readonly<Record<string, QueryDraft>>, queryType: string): QueryDraft {
  return Object.hasOwn(drafts, queryType) ? (drafts[queryType] ?? EMPTY_DRAFT) : EMPTY_DRAFT;
}

/**
 * Holds user-entered values only; effective values and defaults never enter the store
 * (spec 4.3 step 3, 6.7). In memory only: no persist middleware (SEC-006).
 */
export function createDraftStore(): DraftStore {
  return createStore<DraftState>()((set) => ({
    queryType: null,
    drafts: {},
    mode: "form",
    terminalText: "",
    select: (queryType) =>
      set((s) => ({
        queryType,
        drafts: Object.hasOwn(s.drafts, queryType)
          ? s.drafts
          : { ...s.drafts, [queryType]: EMPTY_DRAFT },
      })),
    setValue: (key, value) =>
      set((s) => {
        if (s.queryType === null) return s;
        const draft = draftOf(s.drafts, s.queryType);
        return {
          drafts: {
            ...s.drafts,
            [s.queryType]: { ...draft, values: { ...draft.values, [key]: value } },
          },
        };
      }),
    setSources: (sourceIds) =>
      set((s) => {
        if (s.queryType === null) return s;
        const draft = draftOf(s.drafts, s.queryType);
        return { drafts: { ...s.drafts, [s.queryType]: { ...draft, sources: [...sourceIds] } } };
      }),
    replaceValues: (queryType, values) =>
      set((s) => {
        const draft = draftOf(s.drafts, queryType);
        return { drafts: { ...s.drafts, [queryType]: { ...draft, values: { ...values } } } };
      }),
    setMode: (mode) => set({ mode }),
    setTerminalText: (terminalText) => set({ terminalText }),
    reset: () => set({ queryType: null, drafts: {}, mode: "form", terminalText: "" }),
  }));
}
