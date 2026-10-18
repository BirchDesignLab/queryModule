import { useSyncExternalStore } from "react";
import type { Services } from "../app/services.js";
import { useServices } from "../app/services-context.js";
import type { AuditFilters } from "./audit-api.js";
import type { AuditForm } from "./audit-model.js";

/**
 * The audit log's view state, in memory only (spec 6.7): the user and request ids in the filters
 * are query data, so they never go in the URL, the history or a browser store. It lives in the
 * app's reset controller, so a sign-out, a 401 or a user change empties it; Back from the request
 * view restores the filters from here. Rows are not kept here: the page holds them in its state.
 */
export interface AuditViewState {
  /** The form as typed; null until the page first opens (the default window needs the clock). */
  form: AuditForm | null;
  /** The filters of the last Apply: what the table, paging and export use. */
  applied: AuditFilters | null;
  /** The cursor of each page shown so far; index 0 is the first page (no cursor). */
  cursors: (string | undefined)[];
  pageSize: number;
  /** The request link last used, so Back from the request view can return focus to it. */
  focusRequest: string | null;
}

export const DEFAULT_AUDIT_PAGE_SIZE = 50;
export const AUDIT_PAGE_SIZES = [25, 50, 100, 200] as const;

const initial = (): AuditViewState => ({
  form: null,
  applied: null,
  cursors: [undefined],
  pageSize: DEFAULT_AUDIT_PAGE_SIZE,
  focusRequest: null,
});

export interface AuditStore {
  getState(): AuditViewState;
  subscribe(listener: () => void): () => void;
  /** Replaces the state with the changes given. */
  set(changes: Partial<AuditViewState>): void;
  reset(): void;
}

export function createAuditStore(): AuditStore {
  let state = initial();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(changes) {
      state = { ...state, ...changes };
      emit();
    },
    reset() {
      state = initial();
      emit();
    },
  };
}

const stores = new WeakMap<Services["reset"], AuditStore>();

/** One store per app instance, registered with its ResetController on first use. */
export function auditStore(services: Services): AuditStore {
  let store = stores.get(services.reset);
  if (store === undefined) {
    store = createAuditStore();
    services.reset.register(() => store?.reset());
    stores.set(services.reset, store);
  }
  return store;
}

export function useAuditView(): { store: AuditStore; state: AuditViewState } {
  const store = auditStore(useServices());
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { store, state };
}
