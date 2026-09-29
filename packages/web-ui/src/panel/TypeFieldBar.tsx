import type { DraftValue, Translator } from "@querymodule/client";
import type { FieldState } from "@querymodule/core/rules";
import type { JSX } from "react";
import { FieldRenderer } from "../field/FieldRenderer.js";

export interface TypeFieldBarProps {
  /** The query type's fields; only visible role:"type" ones render, in the order given. */
  fields: readonly FieldState[];
  values: Readonly<Record<string, DraftValue>>;
  fieldConfig: ReadonlyMap<
    string,
    { inputFormats?: readonly string[]; numberKind?: "integer" | "decimal" }
  >;
  /** True after a blocked submit. */
  showErrors: boolean;
  /** Resolved messages by field key. */
  errors: ReadonlyMap<string, string>;
  onChange(key: string, value: DraftValue): void;
  t: Translator["t"];
  idPrefix: string;
}

/**
 * The type fields (spec 4.1 "Type fields") as the subtype control directly under the quick-access
 * bar (ADR-0010). Rendered through FieldRenderer, so rules, required flags and errors are unchanged.
 */
export function TypeFieldBar({
  fields,
  values,
  fieldConfig,
  showErrors,
  errors,
  onChange,
  t,
  idPrefix,
}: TypeFieldBarProps): JSX.Element | null {
  const shown = fields.filter((f) => f.role === "type" && f.visible);
  if (shown.length === 0) return null;
  return (
    <div className="qm-type-fields">
      {shown.map((field) => {
        const cfg = fieldConfig.get(field.key);
        return (
          <FieldRenderer
            key={field.key}
            field={field}
            userValue={values[field.key] ?? null}
            error={showErrors ? errors.get(field.key) : undefined}
            onChange={onChange}
            t={t}
            idPrefix={idPrefix}
            inputFormats={cfg?.inputFormats}
            numberKind={cfg?.numberKind}
          />
        );
      })}
    </div>
  );
}
