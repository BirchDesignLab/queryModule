import type { KeywordStyle } from "@querymodule/core/config";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useId, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { IssueMessages, isError } from "./checks.js";
import type { useFocusRequest } from "./controls.js";
import type { DraftIssue } from "./issues.js";
import { isSeverity, SEVERITIES, type Sev } from "./keyword-severity.js";

interface KeywordRowProps {
  /** 1-based position, for the accessible names. */
  n: number;
  owner: string;
  style: KeywordStyle;
  /** The draft's severity is not one of the three: the select asks for a choice instead of showing Info. */
  severityUnset: boolean;
  /** The keyword for the Remove button's name: its text, else "keyword n". */
  name: string;
  keywordIssues: readonly DraftIssue[] | undefined;
  severityIssues: readonly DraftIssue[] | undefined;
  exceptIssues(j: number): readonly DraftIssue[] | undefined;
  onKeyword(text: string): void;
  onSeverity(severity: Sev): void;
  onExcept(j: number, text: string): void;
  /** Adds a phrase (trimmed; blank adds nothing); true when it was added. */
  onAddExcept(phrase: string): boolean;
  onRemoveExcept(j: number): void;
  onRemove(): void;
  focus: ReturnType<typeof useFocusRequest>;
}

/** One keyword card: its word, severity and exception phrases, and Remove. Each control carries its number. */
export function KeywordRow({
  n,
  owner,
  style,
  severityUnset,
  name,
  keywordIssues,
  severityIssues,
  exceptIssues,
  onKeyword,
  onSeverity,
  onExcept,
  onAddExcept,
  onRemoveExcept,
  onRemove,
  focus,
}: KeywordRowProps) {
  const t = useT();
  const uid = useId();
  const [phrase, setPhrase] = useState("");
  const phrases = style.except ?? [];
  const exAdd = `${owner}-ex-add`;
  const exOwner = (j: number) => `${owner}-ex-${j}`;
  const addPhrase = () => {
    if (!onAddExcept(phrase)) return;
    setPhrase("");
    focus([exAdd, "text"]);
  };
  const removePhrase = (j: number) => {
    onRemoveExcept(j);
    // Focus goes to the phrase that took its place, else the one before it, else the new phrase box.
    const next = j < phrases.length - 1 ? j : j - 1;
    focus(...(next >= 0 ? [[exOwner(next), "phrase"] as const] : []), [exAdd, "text"]);
  };
  // The captions are visual only: each control keeps its numbered accessible name ("Keyword 1").
  return (
    <li className="qm-kw__row">
      <div className="qm-kw__main">
        <div className="qm-kw__cell qm-kw__cell--keyword">
          <span className="qm-kw__cap" aria-hidden="true">
            {t("admin.keywords.col.keyword")}
          </span>
          <input
            type="text"
            className="qm-field__input"
            autoComplete="off"
            aria-label={t("admin.keywords.keyword.n", { n })}
            aria-invalid={isError(keywordIssues)}
            aria-describedby={keywordIssues === undefined ? undefined : `${uid}-keyword-issues`}
            data-owner={owner}
            data-role="keyword"
            value={style.keyword}
            onChange={(e) => onKeyword(e.target.value)}
          />
          <IssueMessages id={`${uid}-keyword-issues`} issues={keywordIssues} />
        </div>
        <div className="qm-kw__cell qm-kw__cell--severity">
          <span className="qm-kw__cap" aria-hidden="true">
            {t("admin.keywords.col.severity")}
          </span>
          <select
            aria-label={t("admin.keywords.severity.n", { n })}
            aria-invalid={isError(severityIssues)}
            aria-describedby={severityIssues === undefined ? undefined : `${uid}-severity-issues`}
            value={severityUnset ? "" : style.severity}
            onChange={(e) => {
              const v = e.target.value;
              if (isSeverity(v)) onSeverity(v);
            }}
          >
            {severityUnset && <option value="">{t("admin.keywords.severity.choose")}</option>}
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t(`severity.${s}`)}
              </option>
            ))}
          </select>
          <IssueMessages id={`${uid}-severity-issues`} issues={severityIssues} />
        </div>
        <button
          type="button"
          className="qm-button qm-button--danger qm-kw__remove"
          onClick={onRemove}
        >
          <span aria-hidden="true">{t("admin.keywords.removeShort")}</span>
          <VisuallyHidden>
            {t("admin.keywords.remove")} {name}
          </VisuallyHidden>
        </button>
      </div>
      <div className="qm-kw__cell">
        <span className="qm-kw__cap" aria-hidden="true">
          {t("admin.keywords.col.except")}
        </span>
        <ul className="qm-kw__phrases">
          {phrases.map((p, j) => {
            const issues = exceptIssues(j);
            const m = j + 1;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: phrases have no identity
              <li key={j}>
                <input
                  type="text"
                  className="qm-field__input qm-kw__input"
                  autoComplete="off"
                  aria-label={t("admin.keywords.except.n", { m, n })}
                  aria-invalid={isError(issues)}
                  aria-describedby={issues === undefined ? undefined : `${uid}-except-${j}-issues`}
                  data-owner={exOwner(j)}
                  data-role="phrase"
                  value={p}
                  onChange={(e) => onExcept(j, e.target.value)}
                />{" "}
                <button
                  type="button"
                  className="qm-button"
                  aria-label={t("admin.keywords.except.removeN", { m, n })}
                  onClick={() => removePhrase(j)}
                >
                  {t("admin.keywords.except.remove")}
                </button>
                <IssueMessages id={`${uid}-except-${j}-issues`} issues={issues} />
              </li>
            );
          })}
        </ul>
        <div className="qm-kw__phrase-add">
          <input
            type="text"
            className="qm-field__input qm-kw__input"
            autoComplete="off"
            aria-label={t("admin.keywords.except.new", { n })}
            data-owner={exAdd}
            data-role="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              addPhrase();
            }}
          />{" "}
          <button
            type="button"
            className="qm-button"
            aria-label={t("admin.keywords.except.addN", { n })}
            onClick={addPhrase}
          >
            {t("admin.keywords.except.add")}
          </button>
        </div>
      </div>
    </li>
  );
}
