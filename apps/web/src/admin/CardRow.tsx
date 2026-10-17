import type { MappingElement } from "@querymodule/core/config";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useId } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { Columns, FormatPicker } from "./CardColumns.js";
import { newLabelKey, type PayloadPath } from "./cards-model.js";
import { IssueMessages, isError } from "./checks.js";
import { useDraftSetters, useLabelText } from "./controls.js";
import type { DraftIssue } from "./issues.js";
import { issueWords } from "./selection.js";

const VIEWS = ["summary", "detail", "both"] as const;

export interface CardRowProps {
  el: MappingElement;
  /** The row's pointer, "/responseMappings/<card>/elements/<row>". */
  pointer: string;
  /** Every issue at or inside the row. */
  issues: readonly DraftIssue[];
  index: number;
  count: number;
  owner: string;
  open: boolean;
  paths: readonly PayloadPath[];
  cardId: string;
  takenKeys(): Set<string>;
  onToggle(): void;
  onChange(el: MappingElement, coalesce?: boolean): void;
  onMove(from: number, to: number): void;
  onRemove(index: number): void;
}

/** One row of a card: a bordered item as the mock editor's scenarios, body behind Edit. */
export function CardRow({
  el,
  pointer,
  issues,
  index,
  count,
  owner,
  open,
  paths,
  cardId,
  takenKeys,
  onToggle,
  onChange,
  onMove,
  onRemove,
}: CardRowProps) {
  const t = useT();
  const translator = useTranslator();
  const labelText = useLabelText();
  const { setLabel } = useDraftSetters();
  const uid = useId();
  const label = labelText(el.labelKey);
  const shownName = label || el.path || t("admin.cards.row.unnamed");
  const headId = `${uid}-head`;
  const bodyId = `${uid}-body`;
  const kindWord = t(el.kind === "table" ? "admin.cards.kind.table" : "admin.cards.kind.value");
  const viewWord = t(`admin.cards.viewShown.${el.view}`);
  const marked = el.highlight !== false;
  const wanted = el.kind === "table" ? "array" : "leaf";
  const found = paths.filter((p) => p.kind === wanted);
  const unresolved = el.path !== "" && !paths.some((p) => p.path === el.path);
  const warnId = `${uid}-warn`;
  const listId = `${uid}-paths`;
  // Each control shows the issues at its own pointer; the rest of the row's show under the row.
  const claimed = new Set([
    `${pointer}/path`,
    `${pointer}/labelKey`,
    ...(el.kind === "table"
      ? el.columns.flatMap((_, j) => [
          `${pointer}/columns/${j}/path`,
          `${pointer}/columns/${j}/labelKey`,
        ])
      : []),
  ]);
  const at = (p: string) => {
    const found = issues.filter((i) => i.pointer === p);
    return found.length > 0 ? found : undefined;
  };
  const pathIssues = at(`${pointer}/path`);
  const labelIssues = at(`${pointer}/labelKey`);
  const rest = issues.filter((i) => !claimed.has(i.pointer));
  const restId = `${uid}-row-issues`;
  const words = issueWords(
    t,
    issues.filter((i) => i.level === "error").length,
    issues.filter((i) => i.level !== "error").length,
  );
  const setKind = (kind: "value" | "table") => {
    if (kind === el.kind) return;
    const { path, labelKey, view, highlight } = el;
    const base = { path, labelKey, view, ...(highlight === undefined ? {} : { highlight }) };
    onChange(
      (kind === "value"
        ? { kind, ...base }
        : {
            kind,
            ...base,
            columns: [{ path: "", labelKey: newLabelKey(cardId, takenKeys()) }],
          }) as MappingElement,
    );
  };
  return (
    <li className="qm-mock__scenario">
      <fieldset
        aria-labelledby={headId}
        aria-describedby={open && rest.length > 0 ? restId : undefined}
        className="qm-mock__scenario-box"
      >
        <div className="qm-mock__scenario-head">
          <h5 id={headId}>{shownName}</h5>
          <p className="qm-mock__summary">
            <code>{el.path}</code> {kindWord}, {viewWord}
            {marked ? "" : `, ${t("admin.cards.notMarked")}`}
            {words === "" ? "" : `, ${words}`}
          </p>
          <div className="qm-mock__scenario-tools qm-mock__scenario-tools--row">
            <button
              type="button"
              className="qm-button"
              aria-expanded={open}
              aria-controls={open ? bodyId : undefined}
              data-owner={owner}
              data-role="toggle"
              onClick={onToggle}
            >
              {t(open ? "admin.cards.row.close" : "admin.cards.row.edit")}
              <VisuallyHidden> {shownName}</VisuallyHidden>
            </button>
            {(["up", "down"] as const).map((kind) => {
              const target = kind === "up" ? index - 1 : index + 1;
              const blocked = target < 0 || target >= count;
              return (
                <button
                  key={kind}
                  type="button"
                  className="qm-button qm-button--ghost qm-mock__icon"
                  aria-disabled={blocked ? "true" : undefined}
                  aria-label={t(
                    kind === "up" ? "admin.cards.row.moveUp" : "admin.cards.row.moveDown",
                    {
                      name: shownName,
                    },
                  )}
                  data-owner={owner}
                  data-role={kind}
                  onClick={() => {
                    if (!blocked) onMove?.(index, target);
                  }}
                >
                  <span aria-hidden="true">{kind === "up" ? "↑" : "↓"}</span>
                </button>
              );
            })}
            <button
              type="button"
              className="qm-button qm-button--ghost qm-mock__icon"
              aria-label={t("admin.cards.row.remove", { name: shownName })}
              data-owner={owner}
              data-role="remove"
              onClick={() => onRemove(index)}
            >
              <span aria-hidden="true" className="qm-icon-x">
                ×
              </span>
            </button>
          </div>
        </div>
        {open && (
          <div id={bodyId} className="qm-mock__scenario-body">
            <fieldset className="qm-mock__radios">
              <legend>{t("admin.cards.kindLegend")}</legend>
              {(["value", "table"] as const).map((k) => (
                <label key={k} className="qm-mock__radio">
                  <input
                    type="radio"
                    name={`${uid}-kind`}
                    checked={el.kind === k}
                    onChange={() => setKind(k)}
                  />{" "}
                  {t(`admin.cards.kind.${k}`)}
                </label>
              ))}
            </fieldset>
            <div>
              <label htmlFor={`${uid}-path`}>{t("admin.cards.path")}</label>{" "}
              <input
                id={`${uid}-path`}
                type="text"
                className="qm-field__input qm-mock__mono"
                list={listId}
                data-owner={owner}
                data-role="path"
                value={el.path}
                aria-invalid={isError(pathIssues)}
                aria-describedby={
                  [
                    pathIssues === undefined ? null : `${uid}-path-issues`,
                    unresolved ? warnId : null,
                  ]
                    .filter((x) => x !== null)
                    .join(" ") || undefined
                }
                onChange={(e) => onChange({ ...el, path: e.target.value }, true)}
              />
              <IssueMessages id={`${uid}-path-issues`} issues={pathIssues} />
              <datalist id={listId}>
                {found.map((p) => (
                  <option key={p.path} value={p.path} />
                ))}
              </datalist>
              {unresolved && (
                <p id={warnId} className="qm-admin__issue qm-admin__issue--warning">
                  {t("admin.config.level.warning")} {t("admin.cards.unresolved")}
                </p>
              )}
              {found.length > 0 && (
                <fieldset className="qm-mock__scenario-box" aria-label={t("admin.cards.pickPaths")}>
                  {found.map((p) => (
                    <button
                      key={p.path}
                      type="button"
                      className="qm-button qm-button--ghost qm-mock__mono"
                      aria-pressed={el.path === p.path}
                      onClick={() => onChange({ ...el, path: p.path })}
                    >
                      {p.path}
                    </button>
                  ))}
                </fieldset>
              )}
            </div>
            <div>
              <label htmlFor={`${uid}-label`}>{t("admin.cards.label")}</label>{" "}
              <input
                id={`${uid}-label`}
                type="text"
                className="qm-field__input"
                value={label}
                disabled={el.labelKey === ""}
                aria-invalid={isError(labelIssues)}
                aria-describedby={labelIssues === undefined ? undefined : `${uid}-label-issues`}
                onChange={(e) => setLabel(translator.locale, el.labelKey, e.target.value)}
              />
              <IssueMessages id={`${uid}-label-issues`} issues={labelIssues} />
            </div>
            <fieldset className="qm-mock__radios">
              <legend>{t("admin.cards.showIn")}</legend>
              {VIEWS.map((v) => (
                <label key={v} className="qm-mock__radio">
                  <input
                    type="radio"
                    name={`${uid}-view`}
                    checked={el.view === v}
                    onChange={() => onChange({ ...el, view: v })}
                  />{" "}
                  {t(`admin.cards.view.${v}`)}
                </label>
              ))}
            </fieldset>
            {el.kind === "value" ? (
              <div>
                <label htmlFor={`${uid}-format`}>{t("admin.cards.formatLabel")}</label>{" "}
                <FormatPicker
                  id={`${uid}-format`}
                  value={el.format}
                  templateLabel={t("admin.cards.template")}
                  onChange={(format, coalesce) => {
                    const { format: _old, ...others } = el;
                    onChange(format === undefined ? others : { ...others, format }, coalesce);
                  }}
                />
              </div>
            ) : (
              <Columns
                el={el}
                pointer={pointer}
                issues={issues}
                cardId={cardId}
                takenKeys={takenKeys}
                onChange={onChange}
              />
            )}
            <IssueMessages id={restId} issues={rest.length > 0 ? rest : undefined} />
            <div>
              <input
                id={`${uid}-mark`}
                type="checkbox"
                checked={marked}
                aria-describedby={`${uid}-mark-hint`}
                onChange={(e) => onChange({ ...el, highlight: e.target.checked })}
              />{" "}
              <label htmlFor={`${uid}-mark`}>{t("admin.cards.mark")}</label>
              <p id={`${uid}-mark-hint`} className="qm-sect__hint">
                {t("admin.cards.markHint")}
              </p>
            </div>
          </div>
        )}
      </fieldset>
    </li>
  );
}
