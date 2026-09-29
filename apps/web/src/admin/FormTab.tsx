import { useCallback, useContext, useId } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { configDraftStore } from "./builder-store.js";
import { CommandsEditor, QuickAccessEditor } from "./CommandsEditor.js";
import { ChecksContext, IssueMessages } from "./checks.js";
import type { JsonObject, PathSegment } from "./draft.js";
import { NodeEditor, Section } from "./GenericForm.js";
import { LabelOverlayEditor } from "./LabelOverlay.js";
import { PicklistsEditor } from "./PicklistEditor.js";
import { QueryTypesEditor } from "./TypeEditors.js";

export function FormTab({ doc }: { doc: JsonObject }) {
  const services = useServices();
  const idPrefix = useId();
  const store = configDraftStore(services);
  const onChange = useCallback(
    (path: readonly PathSegment[], value: unknown) => store.getState().setPath(path, value),
    [store],
  );
  const strings = Array.isArray(doc.locales)
    ? doc.locales.filter((l): l is string => typeof l === "string")
    : [];
  const locales = strings.length > 0 ? strings : ["en"];
  const t = useT();
  const rootIssues = useContext(ChecksContext).groups.get("");
  const rootId = `${idPrefix}-root-issues`;
  // #388: issues with no control of their own (a missing top-level key) describe the whole form.
  return (
    <fieldset
      className="qm-admin__form"
      aria-label={t("admin.config.tab.form")}
      aria-describedby={rootIssues === undefined ? undefined : rootId}
      data-testid="form-tab"
    >
      <IssueMessages id={rootId} issues={rootIssues} />
      {Object.entries(doc).map(([name, value]) => (
        <Section key={name} name={name}>
          {() =>
            name === "queryTypes" ? (
              <QueryTypesEditor value={value} idPrefix={idPrefix} />
            ) : name === "picklists" ? (
              <PicklistsEditor value={value} idPrefix={idPrefix} />
            ) : name === "commands" ? (
              <CommandsEditor value={value} doc={doc} idPrefix={idPrefix} />
            ) : name === "quickAccess" ? (
              <QuickAccessEditor value={value} doc={doc} idPrefix={idPrefix} />
            ) : (
              <NodeEditor value={value} path={[name]} idPrefix={idPrefix} onChange={onChange} />
            )
          }
        </Section>
      ))}
      <LabelOverlayEditor locales={locales} idPrefix={idPrefix} />
    </fieldset>
  );
}
