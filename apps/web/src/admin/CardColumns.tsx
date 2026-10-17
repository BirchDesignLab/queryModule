import type { MappingElement } from "@querymodule/core/config";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useId, useRef } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { newLabelKey } from "./cards-model.js";
import { IssueMessages, isError } from "./checks.js";
import { useDraftSetters, useLabelText } from "./controls.js";
import type { DraftIssue } from "./issues.js";

const FORMATS = ["text", "upper", "phone", "date", "template"] as const;

type Format = NonNullable<Extract<MappingElement, { kind: "value" }>["format"]>;

/**
 * A format control: As sent, Upper case, Phone number, Date MM-DD-YY or Template (text with
 * {value} where the value goes). As sent is no format at all (the key is removed). The caller
 * names the select (label or aria-label); the Template text has its own name.
 */
export function FormatPicker({
  id,
  ariaLabel,
  value,
  templateLabel,
  onChange,
}: {
  id?: string;
  ariaLabel?: string;
  value: Format | undefined;
  templateLabel: string;
  onChange(format: Format | undefined, coalesce?: boolean): void;
}) {
  const t = useT();
  const type = value?.type ?? "text";
  const formats: readonly string[] = FORMATS.includes(type as (typeof FORMATS)[number])
    ? FORMATS
    : [...FORMATS, type];
  return (
    <>
      <select
        id={id}
        aria-label={ariaLabel}
        value={type}
        onChange={(e) => {
          const f = e.target.value;
          if (f === "text") onChange(undefined);
          else if (f === "date") onChange({ type: "date", pattern: "MM-DD-YY" });
          else if (f === "template") onChange({ type: "template", template: "{value}" });
          else if (f === "upper" || f === "phone") onChange({ type: f });
        }}
      >
        {formats.map((f) => (
          <option key={f} value={f}>
            {FORMATS.includes(f as (typeof FORMATS)[number]) ? t(`admin.cards.format.${f}`) : f}
          </option>
        ))}
      </select>
      {value?.type === "template" && (
        <>
          {" "}
          <input
            type="text"
            className="qm-field__input qm-mock__mono"
            aria-label={templateLabel}
            value={value.template}
            onChange={(e) => onChange({ type: "template", template: e.target.value }, true)}
          />
        </>
      )}
    </>
  );
}

type TableElement = Extract<MappingElement, { kind: "table" }>;

/** A table row's columns: path relative to one entry, label, mark, remove; Add column. */
export function Columns({
  el,
  pointer,
  issues,
  cardId,
  takenKeys,
  onChange,
}: {
  el: TableElement;
  pointer: string;
  issues: readonly DraftIssue[];
  cardId: string;
  takenKeys(): Set<string>;
  /** `typing` names the text control being typed in, so its keystrokes undo as one step. */
  onChange(el: MappingElement, typing?: string): void;
}) {
  const t = useT();
  const translator = useTranslator();
  const labelText = useLabelText();
  const { setLabel } = useDraftSetters();
  const addRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const at = (p: string) => {
    const found = issues.filter((i) => i.pointer === p);
    return found.length > 0 ? found : undefined;
  };
  const setColumns = (columns: TableElement["columns"], typing?: string) =>
    onChange({ ...el, columns }, typing);
  return (
    <div className="qm-mock__table-wrap">
      <table className="qm-mock__table qm-columns__table">
        <caption>{t("admin.cards.columns")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("admin.cards.path")}</th>
            <th scope="col">{t("admin.cards.label")}</th>
            <th scope="col">{t("admin.cards.formatLabel")}</th>
            <th scope="col">
              <span aria-hidden="true">{t("admin.cards.column.markShort")}</span>
              <VisuallyHidden>{t("admin.cards.mark")}</VisuallyHidden>
            </th>
            <th scope="col">
              <VisuallyHidden>{t("admin.cards.column.remove")}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {el.columns.map((c, i) => {
            const n = i + 1;
            const name = labelText(c.labelKey) || c.path || t("admin.cards.column.n", { n });
            const pathIssues = at(`${pointer}/columns/${i}/path`);
            const labelIssues = at(`${pointer}/columns/${i}/labelKey`);
            const pathId = `${uid}-c${i}-path-issues`;
            const labelId = `${uid}-c${i}-label-issues`;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns have no identity
              <tr key={i}>
                <td>
                  <input
                    type="text"
                    className="qm-field__input qm-mock__mono"
                    aria-label={t("admin.cards.column.path", { n })}
                    aria-invalid={isError(pathIssues)}
                    aria-describedby={pathIssues === undefined ? undefined : pathId}
                    value={c.path}
                    onChange={(e) =>
                      setColumns(
                        el.columns.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)),
                        `column${i}:path`,
                      )
                    }
                  />
                  <IssueMessages id={pathId} issues={pathIssues} />
                </td>
                <td>
                  <input
                    type="text"
                    className="qm-field__input"
                    aria-label={t("admin.cards.column.label", { n })}
                    aria-invalid={isError(labelIssues)}
                    aria-describedby={labelIssues === undefined ? undefined : labelId}
                    value={labelText(c.labelKey)}
                    onChange={(e) => setLabel(translator.locale, c.labelKey, e.target.value)}
                  />
                  <IssueMessages id={labelId} issues={labelIssues} />
                </td>
                <td>
                  <FormatPicker
                    ariaLabel={t("admin.cards.column.format", { n })}
                    value={c.format}
                    templateLabel={t("admin.cards.column.template", { n })}
                    onChange={(format, typing) =>
                      setColumns(
                        el.columns.map((x, j) => {
                          if (j !== i) return x;
                          const { format: _old, ...others } = x;
                          return format === undefined ? others : { ...others, format };
                        }),
                        typing ? `column${i}:template` : undefined,
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t("admin.cards.column.mark", { n })}
                    checked={c.highlight !== false}
                    onChange={(e) =>
                      setColumns(
                        el.columns.map((x, j) =>
                          j === i ? { ...x, highlight: e.target.checked } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  {el.columns.length > 1 && (
                    <button
                      type="button"
                      className="qm-button qm-columns__remove"
                      onClick={() => {
                        setColumns(el.columns.filter((_, j) => j !== i));
                        // The button goes with its column: focus moves to Add column, never body.
                        addRef.current?.focus();
                      }}
                    >
                      <span aria-hidden="true">{"×"}</span>
                      <VisuallyHidden>
                        {t("admin.cards.column.remove")} {name}
                      </VisuallyHidden>
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        ref={addRef}
        type="button"
        className="qm-button"
        onClick={() =>
          setColumns([...el.columns, { path: "", labelKey: newLabelKey(cardId, takenKeys()) }])
        }
      >
        {t("admin.cards.column.add")}
      </button>
    </div>
  );
}
