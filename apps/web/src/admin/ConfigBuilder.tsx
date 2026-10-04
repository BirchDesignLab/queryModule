import { useEffect, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { fetchAdminConfig, startOf } from "./admin-config.js";
import { BuilderBody } from "./BuilderBody.js";
import { configDraftStore, useDraft } from "./builder-store.js";

export { configDraftStore } from "./builder-store.js";

export { TABS } from "./tabs.js";

/**
 * The config builder (Task 31 and Task 33 part 2a): the generic form and the raw JSON tab over one
 * draft that comes from, and is saved to, the server (GET and PUT /admin/config). The browser keeps
 * nothing: the draft is in memory, and the saved copy is on the server (spec 6.7).
 */
export function ConfigBuilder() {
  const t = useT();
  const services = useServices();
  const { doc } = useDraft();
  const seeded = doc !== null;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Q8: also reseeds after a reset while the builder stays open.
    if (seeded) return;
    let open = true;
    setFailed(false);
    fetchAdminConfig(services.api).then(
      (config) => {
        if (!open) return;
        const next = startOf(config);
        configDraftStore(services)
          .getState()
          .start(next.doc, { labels: next.labels, server: next.server });
      },
      () => {
        if (open) setFailed(true);
      },
    );
    return () => {
      open = false;
    };
  }, [services, seeded]);
  if (doc === null && failed)
    return (
      <p className="qm-builder__body" role="alert">
        {t("admin.config.loadError")}
      </p>
    );
  if (doc === null)
    return (
      <p className="qm-builder__body" aria-busy="true">
        {t("admin.config.loading")}
      </p>
    );
  return <BuilderBody doc={doc} />;
}
