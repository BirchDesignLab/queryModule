import { useCallback, useContext, useId } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { configDraftStore } from "./builder-store.js";
import { CommandsEditor, QuickAccessEditor } from "./CommandsEditor.js";
import { ChecksContext, IssueMessages } from "./checks.js";
import { type JsonObject, type PathSegment, toPointer } from "./draft.js";
import { EditorSection, NodeEditor } from "./GenericForm.js";
import { LabelOverlayEditor } from "./LabelOverlay.js";
import { PicklistsEditor } from "./PicklistEditor.js";
import { HIDDEN_KEYS, LABELS_ITEM, SelectionContext, topItem } from "./selection.js";
import { QueryTypesEditor } from "./TypeEditors.js";

/** The plain name of a top-level item (design lead 09-29-26); an unknown key shows as itself. */
export function useItemName(): (key: string) => string {
  const t = useT();
  return useCallback(
    (key: string) => {
      if (key === LABELS_ITEM) return t("admin.config.site.labels");
      const name = `admin.config.site.${key}`;
      const text = t(name);
      return text === name ? key : text;
    },
    [t],
  );
}

/** The editor (A-D1 A2): only the item the tree selected, not every top-level key. */
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
  const name = useItemName();
  const { pointer } = useContext(SelectionContext);
  const rootIssues = useContext(ChecksContext).groups.get("");
  const rootId = `${idPrefix}-root-issues`;
  const top = pointer === null ? null : topItem(pointer);
  const shown = top !== null && (top === LABELS_ITEM || (top in doc && !HIDDEN_KEYS.has(top)));
  const value = top === null ? undefined : doc[top];
  // #388: issues with no control of their own (a missing top-level key) describe the whole form.
  return (
    <fieldset
      className="qm-admin__form"
      aria-label={t("admin.config.tab.form")}
      aria-describedby={rootIssues === undefined ? undefined : rootId}
      data-testid="form-tab"
    >
      <IssueMessages id={rootId} issues={rootIssues} />
      {!shown || top === null ? (
        <p>{t("admin.editor.empty")}</p>
      ) : top === LABELS_ITEM ? (
        <EditorSection pointer={LABELS_ITEM} label={name(LABELS_ITEM)}>
          <LabelOverlayEditor locales={locales} idPrefix={idPrefix} />
        </EditorSection>
      ) : (
        <EditorSection key={top} pointer={toPointer([top])} label={name(top)} configKey={top}>
          {top === "queryTypes" ? (
            <QueryTypesEditor value={value} idPrefix={idPrefix} />
          ) : top === "picklists" ? (
            <PicklistsEditor value={value} idPrefix={idPrefix} />
          ) : top === "commands" ? (
            <CommandsEditor value={value} doc={doc} idPrefix={idPrefix} />
          ) : top === "quickAccess" ? (
            <QuickAccessEditor value={value} doc={doc} idPrefix={idPrefix} />
          ) : (
            <NodeEditor value={value} path={[top]} idPrefix={idPrefix} onChange={onChange} />
          )}
        </EditorSection>
      )}
    </fieldset>
  );
}
