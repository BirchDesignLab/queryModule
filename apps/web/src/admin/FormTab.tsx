import { useCallback, useContext, useId } from "react";
import { useServices } from "../app/services-context.js";
import { configDraftStore } from "./builder-store.js";
import { ChecksContext, IssueMessages } from "./checks.js";
import type { JsonObject, PathSegment } from "./draft.js";
import { NodeEditor, Section } from "./GenericForm.js";
import { LabelOverlayEditor } from "./LabelOverlay.js";

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
  const rootIssues = useContext(ChecksContext).groups.get("");
  return (
    <div>
      <IssueMessages id={`${idPrefix}-root-issues`} issues={rootIssues} />
      {Object.entries(doc).map(([name, value]) => (
        <Section key={name} name={name}>
          {() => <NodeEditor value={value} path={[name]} idPrefix={idPrefix} onChange={onChange} />}
        </Section>
      ))}
      <LabelOverlayEditor locales={locales} idPrefix={idPrefix} />
    </div>
  );
}
