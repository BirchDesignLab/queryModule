import type { SourceState } from "@querymodule/core/rules";
import type { JSX } from "react";

export interface SourceCheckboxesProps {
  /** FormState.sources: only the sources eligible for the current values. */
  sources: readonly SourceState[];
  checked: readonly string[];
  labelOf(sourceId: string): string;
  /** The source's timeout as text ("10 s"), shown in mono on its chip; undefined shows none. */
  timeoutOf?(sourceId: string): string | undefined;
  /** The next checked list, in source order. */
  onChange(sourceIds: string[]): void;
  idPrefix: string;
  t(key: string): string;
}

/**
 * One chip per eligible source (spec 6.2): a checkbox inside a bordered chip that fills when
 * checked, with the source's timeout in mono beside its label. The timeout is aria-hidden and sits
 * outside the label, so the checkbox keeps the source's name. Credential states (aria-disabled)
 * arrive in M3.
 */
export function SourceCheckboxes({
  sources,
  checked,
  labelOf,
  timeoutOf,
  onChange,
  idPrefix,
  t,
}: SourceCheckboxesProps): JSX.Element | null {
  if (sources.length === 0) return null;
  return (
    <fieldset className="qm-query-form__section qm-sources">
      <legend>{t("form.sources")}</legend>
      <div className="qm-sources__chips">
        {sources.map((source) => {
          const id = `${idPrefix}-source-${source.sourceId}`;
          const timeout = timeoutOf?.(source.sourceId);
          return (
            <span key={source.sourceId} className="qm-chip">
              <label htmlFor={id} className="qm-chip__label">
                <input
                  id={id}
                  name={id}
                  type="checkbox"
                  checked={checked.includes(source.sourceId)}
                  onChange={(event) =>
                    onChange(
                      sources
                        .map((s) => s.sourceId)
                        .filter((sid) =>
                          sid === source.sourceId
                            ? event.currentTarget.checked
                            : checked.includes(sid),
                        ),
                    )
                  }
                />
                {labelOf(source.sourceId)}
              </label>
              {timeout === undefined ? null : (
                <small className="qm-chip__meta" aria-hidden="true">
                  {timeout}
                </small>
              )}
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}
