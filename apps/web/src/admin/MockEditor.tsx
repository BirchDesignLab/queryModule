import { useContext } from "react";
import { useT } from "../app/i18n-context.js";
import type { JsonObject } from "./draft.js";
import { EditorSection } from "./GenericForm.js";
import { MockCoverage } from "./MockCoverage.js";
import { MockResponse } from "./MockResponse.js";
import { MockSource } from "./MockSource.js";
import { MockEnvContext, useMockEnvValue } from "./mock-context.js";
import { mockPointer } from "./mock-edit.js";
import { SelectionContext } from "./selection.js";

/**
 * The mock responses editor (Task 3a, #549, CFG-2; spec 5.4, 6.6; design 10-05-26): a branch of the
 * builder, not a screen of its own. The tree selects the coverage grid, a mock source or one of its
 * responses; they edit the draft's mock, with the same undo, save and publish as the rest.
 */
export function MockEditor({ doc }: { doc: JsonObject }) {
  const t = useT();
  const env = useMockEnvValue(doc);
  const { pointer } = useContext(SelectionContext);
  const crumb = t("admin.tree.mock");
  if (env === null)
    return (
      <EditorSection
        pointer={mockPointer.coverage}
        label={t("admin.mock.coverage.label")}
        crumb={crumb}
      >
        <p>{t("admin.mock.unreadable")}</p>
      </EditorSection>
    );
  const response = pointer === null ? null : mockPointer.responseOf(pointer);
  const sourceId = pointer === null ? null : mockPointer.sourceOf(pointer);
  const source = sourceId === null ? undefined : env.mock.sources[sourceId];
  const shown = (() => {
    if (response !== null && source?.responses[response.response] !== undefined) {
      const r = source.responses[response.response];
      const types =
        r?.types === undefined
          ? ""
          : `, ${Object.values(r.types)
              .map((c) => env.codeName(c, r.queryType))
              .join(", ")}`;
      return {
        pointer: mockPointer.response(response.sourceId, response.response),
        label: `${env.typeName(r?.queryType ?? "")}${types}`,
        key: r?.queryType,
        crumb: `${crumb} / ${env.sourceName(response.sourceId)}`,
        body: <MockResponse sourceId={response.sourceId} index={response.response} />,
      };
    }
    if (sourceId !== null && source !== undefined && response === null)
      return {
        pointer: mockPointer.source(sourceId),
        label: env.sourceName(sourceId),
        key: sourceId,
        crumb,
        body: <MockSource sourceId={sourceId} />,
      };
    return {
      pointer: mockPointer.coverage,
      label: t("admin.mock.coverage.title"),
      key: undefined,
      crumb,
      body: <MockCoverage />,
    };
  })();
  return (
    <MockEnvContext.Provider value={env}>
      <EditorSection
        key={shown.pointer}
        pointer={shown.pointer}
        label={shown.label}
        {...(shown.key === undefined ? {} : { configKey: shown.key })}
        crumb={shown.crumb}
        focusOwner={shown.pointer}
      >
        {shown.body}
      </EditorSection>
    </MockEnvContext.Provider>
  );
}
