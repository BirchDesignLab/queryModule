import { useSyncExternalStore } from "react";
import type { Services } from "../app/services.js";
import { useServices } from "../app/services-context.js";
import type { CardsSite } from "./cards-model.js";
import {
  type ConfigDraftStore,
  createConfigDraftStore,
  type JsonObject,
  registerConfigDraft,
} from "./draft.js";

const stores = new WeakMap<Services["reset"], ConfigDraftStore>();

/** One draft store per app instance, registered with its ResetController on first use. */
export function configDraftStore(services: Services): ConfigDraftStore {
  let store = stores.get(services.reset);
  if (store === undefined) {
    store = createConfigDraftStore();
    registerConfigDraft(services.reset, store);
    stores.set(services.reset, store);
  }
  return store;
}

export function useDraft() {
  const services = useServices();
  const store = configDraftStore(services);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return state;
}

const arrayOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Runs a cards-model edit on the draft (Task 9, #602). The edit sees the draft's own cards,
 * keywords and query types; what it changes is written back to `responseMappings` and `keywords`
 * as one undo step each, like any other edit of the draft. `coalesce` (true, or a control key) makes consecutive edits of
 * one text control one step (typing a keyword is not a hundred undos). Returns whether the draft
 * changed; a no-op, or a draft not loaded yet, changes nothing and records no step.
 */
export function applyCardsEdit(
  store: ConfigDraftStore,
  edit: (site: CardsSite) => CardsSite,
  options: { coalesce?: boolean | string } = {},
): boolean {
  const { doc, setPath } = store.getState();
  if (doc === null) return false;
  const before = cardsSiteOf(doc);
  const after = edit(before);
  let changed = false;
  if (after.responseMappings !== before.responseMappings) {
    setPath(["responseMappings"], after.responseMappings, options);
    changed = true;
  }
  if (after.keywords !== before.keywords) {
    setPath(["keywords"], after.keywords, options);
    changed = true;
  }
  return changed;
}

/** The draft's cards and keywords as the card editor reads them; empty before the draft loads. */
export function cardsSiteOf(doc: JsonObject | null): CardsSite {
  return {
    responseMappings: arrayOf(doc?.responseMappings),
    keywords: arrayOf(doc?.keywords),
    queryTypes: arrayOf(doc?.queryTypes),
  } as unknown as CardsSite;
}
