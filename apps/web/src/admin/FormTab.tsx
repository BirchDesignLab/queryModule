import { useCallback, useContext, useId } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { configDraftStore, useDraft } from "./builder-store.js";
import { CommandsEditor, QuickAccessEditor } from "./CommandsEditor.js";
import { ChecksContext, IssueMessages } from "./checks.js";
import { asObjects, str, useLabelText } from "./controls.js";
import { type JsonObject, type PathSegment, type SetPathOptions, toPointer } from "./draft.js";
import { EditorSection, NodeEditor } from "./GenericForm.js";
import { LabelOverlayEditor } from "./LabelOverlay.js";
import { MockEditor } from "./MockEditor.js";
import { PicklistsEditor } from "./PicklistEditor.js";
import {
  HIDDEN_KEYS,
  isRootIssue,
  LABELS_ITEM,
  SelectionContext,
  topItem,
  useSelectedIndex,
} from "./selection.js";
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
    (path: readonly PathSegment[], value: unknown, options?: SetPathOptions) =>
      store.getState().setPath(path, value, options),
    [store],
  );
  const strings = Array.isArray(doc.locales)
    ? doc.locales.filter((l): l is string => typeof l === "string")
    : [];
  const locales = strings.length > 0 ? strings : ["en"];
  const t = useT();
  const name = useItemName();
  const { pointer } = useContext(SelectionContext);
  // #388 and A-D1 critic: issues with no item of their own (the whole config, a missing
  // top-level key, schemaVersion) are shown here, whatever item is selected.
  const { issues } = useContext(ChecksContext);
  const root = issues.filter((i) => isRootIssue(doc, i.pointer));
  const rootIssues = root.length > 0 ? root : undefined;
  const rootId = `${idPrefix}-root-issues`;
  const top = pointer === null ? null : topItem(pointer);
  const { mock } = useDraft();
  const shown =
    top !== null &&
    (top === LABELS_ITEM || (top === "mock" ? mock !== null : top in doc && !HIDDEN_KEYS.has(top)));
  const value = top === null ? undefined : doc[top];
  // A query type's heading is the type itself (A3): its name, its code in mono, its issues.
  const labelText = useLabelText();
  const types = asObjects(doc.queryTypes);
  const typeIndex = Math.min(useSelectedIndex("queryTypes") ?? 0, types.length - 1);
  const type = top === "queryTypes" ? types[typeIndex] : undefined;
  const typeName = type === undefined ? "" : labelText(type.labelKey);
  const heading =
    type === undefined
      ? { label: top === null ? "" : name(top), configKey: top ?? undefined }
      : {
          label: typeName === "" ? str(type.code) : typeName,
          configKey: str(type.code),
          countPointer: toPointer(["queryTypes", typeIndex]),
        };
  const crumb = t(top === "queryTypes" ? "admin.tree.types" : "admin.tree.site");
  return (
    <fieldset
      className="qm-admin__form"
      aria-label={t("admin.config.tab.form")}
      aria-describedby={rootIssues === undefined ? undefined : rootId}
      data-testid="form-tab"
    >
      {rootIssues !== undefined && (
        // The issue button focuses these messages (they have no control of their own).
        <div className="qm-editor__root-issues" tabIndex={-1} data-root-issues="">
          <IssueMessages id={rootId} issues={rootIssues} />
        </div>
      )}
      {!shown || top === null ? (
        <p>{t("admin.editor.empty")}</p>
      ) : top === "mock" ? (
        <MockEditor doc={doc} />
      ) : top === LABELS_ITEM ? (
        <EditorSection pointer={LABELS_ITEM} label={name(LABELS_ITEM)} crumb={crumb}>
          <LabelOverlayEditor locales={locales} idPrefix={idPrefix} />
        </EditorSection>
      ) : (
        <EditorSection key={top} pointer={toPointer([top])} crumb={crumb} {...heading}>
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
