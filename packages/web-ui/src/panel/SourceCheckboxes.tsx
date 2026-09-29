import type { SourceState } from "@querymodule/core/rules";
import type { JSX } from "react";
import { CheckboxField } from "../field/CheckboxField.js";

export interface SourceCheckboxesProps {
  /** FormState.sources: only the sources eligible for the current values. */
  sources: readonly SourceState[];
  checked: readonly string[];
  labelOf(sourceId: string): string;
  /** The next checked list, in source order. */
  onChange(sourceIds: string[]): void;
  idPrefix: string;
  t(key: string): string;
}

/** One checkbox per eligible source (spec 6.2). Credential states (aria-disabled) arrive in M3. */
export function SourceCheckboxes({
  sources,
  checked,
  labelOf,
  onChange,
  idPrefix,
  t,
}: SourceCheckboxesProps): JSX.Element | null {
  if (sources.length === 0) return null;
  return (
    <fieldset className="qm-query-form__section qm-sources">
      <legend>{t("form.sources")}</legend>
      {sources.map((source) => (
        <CheckboxField
          key={source.sourceId}
          id={`${idPrefix}-source-${source.sourceId}`}
          label={labelOf(source.sourceId)}
          requiredText=""
          checked={checked.includes(source.sourceId)}
          onChange={(isChecked) =>
            onChange(
              sources
                .map((s) => s.sourceId)
                .filter((id) => (id === source.sourceId ? isChecked : checked.includes(id))),
            )
          }
        />
      ))}
    </fieldset>
  );
}
