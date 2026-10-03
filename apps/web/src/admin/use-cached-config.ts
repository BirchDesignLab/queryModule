import type { ClientSiteConfig } from "@querymodule/core/config";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useServices } from "../app/services-context.js";
import { editorOf, fetchAdminConfig } from "./admin-config.js";
import { configDraftStore } from "./builder-store.js";
import type { JsonObject } from "./draft.js";

/** The cached GET /api/v1/config (key ["config"]); the header prefetches it, so no new call. */
export function useCachedClientConfig(): ClientSiteConfig | undefined {
  const { queryClient } = useServices();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  return useSyncExternalStore(subscribe, () =>
    queryClient.getQueryData<ClientSiteConfig>(["config"]),
  );
}

/** The cached config's fetch failed and left no data: the preview stops waiting for it. */
export function useCachedConfigFailed(): boolean {
  const { queryClient } = useServices();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  return useSyncExternalStore(
    subscribe,
    () => queryClient.getQueryState(["config"])?.status === "error",
  );
}

export type LiveCheck = "checking" | "done" | "failed";

/**
 * The live version for the Changes view and the publish dialog: what the builder loaded, checked
 * against the server once when the view opens (the live version can move while the draft is open).
 * A failed check leaves the version in hand and says so.
 */
export function useLiveDoc(): { doc: JsonObject | null; check: LiveCheck } {
  const services = useServices();
  const { api } = services;
  const store = configDraftStore(services);
  const [doc, setDoc] = useState<JsonObject | null>(() => store.getState().server?.liveDoc ?? null);
  const [check, setCheck] = useState<LiveCheck>("checking");
  useEffect(() => {
    let open = true;
    fetchAdminConfig(api).then(
      (next) => {
        // No draft means a reset (sign-out, a 401) cleared it while this was in flight: an answer
        // for the previous session is dropped.
        if (!open || store.getState().doc === null) return;
        setDoc(editorOf(next.live.document).doc);
        setCheck("done");
      },
      () => {
        if (open) setCheck("failed");
      },
    );
    return () => {
      open = false;
    };
  }, [api, store]);
  return { doc, check };
}
