import { useSyncExternalStore } from "react";
import type { Services } from "../app/services.js";
import { useServices } from "../app/services-context.js";
import { type ConfigDraftStore, createConfigDraftStore, registerConfigDraft } from "./draft.js";

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
