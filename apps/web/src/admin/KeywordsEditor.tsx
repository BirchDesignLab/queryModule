import type { KeywordStyle } from "@querymodule/core/config";
import { Highlighted, VisuallyHidden } from "@querymodule/web-ui";
import { useContext, useId, useState } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { applyCardsEdit, configDraftStore } from "./builder-store.js";
import {
  addExcept,
  addKeyword,
  removeExcept,
  removeKeyword,
  updateKeyword,
} from "./cards-model.js";
import { ChecksContext, IssueMessages } from "./checks.js";
import { asObjects, type Obj, Sect, str, useFocusRequest } from "./controls.js";
import type { JsonObject } from "./draft.js";
import { EditorSection } from "./GenericForm.js";
import { KeywordRow } from "./KeywordRow.js";
import { isSeverity, SEVERITIES, type Sev, type Styles } from "./keyword-severity.js";
import { useRowIds } from "./row-ids.js";
import { StyleFieldset, tokenOverrides } from "./SeverityStyles.js";

/**
 * The keywords and severity editor (Task 11, #604; FR-060, UX-010, UX-011; spec 4.1, 4.5, 6.5).
 * The keywords with their severity and `except` phrases, the look of each severity (text and
 * background token, bold, icon, marker), and a sample line drawn by the production `Highlighted`.
 * The diagnostics come from validateSiteConfig at the server's pointers (`config.severityContrast`,
 * `config.exceptWithoutKeyword`) and show at the control they are about. Text controls write what
 * is typed, spaces and blanks included, as one undo step (typing coalesces); only Add trims. The
 * sample text is this pane's state only: it is never in the draft.
 */

/** The three styles when each is complete, else null: a half-edited style pauses the sample. */
function stylesOf(doc: JsonObject): Styles | null {
  const raw = (
    typeof doc.keywordSeverityStyles === "object" && doc.keywordSeverityStyles !== null
      ? doc.keywordSeverityStyles
      : {}
  ) as Record<string, unknown>;
  const out: Partial<Record<Sev, Styles[Sev]>> = {};
  for (const s of SEVERITIES) {
    const v = raw[s] as Obj | undefined;
    if (
      typeof v !== "object" ||
      v === null ||
      typeof v.color !== "string" ||
      typeof v.background !== "string" ||
      typeof v.bold !== "boolean" ||
      typeof v.icon !== "string" ||
      typeof v.marker !== "string"
    )
      return null;
    out[s] = {
      color: v.color,
      background: v.background,
      bold: v.bold,
      icon: v.icon,
      marker: v.marker,
    };
  }
  return out as Styles;
}

/** The keywords the highlighter can use now: a word and a known severity (blank ones wait). */
function usableKeywords(keywords: readonly Obj[]): KeywordStyle[] {
  return keywords.flatMap((k) =>
    str(k.keyword) !== "" && isSeverity(k.severity)
      ? [
          {
            keyword: str(k.keyword),
            severity: k.severity,
            ...(Array.isArray(k.except)
              ? { except: k.except.filter((e): e is string => typeof e === "string") }
              : {}),
          },
        ]
      : [],
  );
}

const exceptOf = (k: KeywordStyle): string[] => [...(k.except ?? [])];
/** The keyword with `except` replaced as typed (blank phrases included); a list is never emptied here. */
const withExceptList = (k: KeywordStyle, except: string[]): KeywordStyle => ({ ...k, except });

export function KeywordsEditor({ doc, idPrefix }: { doc: JsonObject; idPrefix: string }) {
  const t = useT();
  const translator = useTranslator();
  const store = configDraftStore(useServices());
  const focus = useFocusRequest();
  const checks = useContext(ChecksContext);
  const keywords = asObjects(doc.keywords);
  // Each keyword row keeps its own half-typed text with the keyword through a removal, an undo and
  // a redo (CRITIC-M2): rows are keyed by a stable identity, not by position.
  const { ids } = useRowIds(keywords);
  const [newText, setNewText] = useState("");
  // Add keyword pressed with no word: said out loud, not ignored (demo dry run G3).
  const [needWord, setNeedWord] = useState(false);
  const needWordId = useId();
  const [newSeverity, setNewSeverity] = useState<Sev>("warning");
  const [sampleText, setSampleText] = useState<string | null>(null);
  const addOwner = `${idPrefix}-kw-add`;
  const rowOwner = (i: number) => `${idPrefix}-kw-${i}`;
  const sampleId = useId();
  const newId = useId();
  const newSeverityId = useId();

  const edit = (change: Parameters<typeof applyCardsEdit>[1], coalesce: string | false = false) =>
    applyCardsEdit(store, change, { coalesce });
  const changeKeyword = (
    i: number,
    next: (k: KeywordStyle) => KeywordStyle,
    coalesce: string | false = false,
  ) =>
    edit((site) => {
      const current = site.keywords[i];
      return current === undefined ? site : updateKeyword(site, i, next(current));
    }, coalesce);

  const add = () => {
    let index = -1;
    edit((site) => {
      const r = addKeyword(site, newText, newSeverity);
      index = r.index;
      return r.site;
    });
    if (index < 0) {
      if (newText.trim() === "") {
        setNeedWord(true);
        focus([addOwner, "text"]);
      }
      return;
    }
    setNewText("");
    focus([addOwner, "text"]);
  };
  const remove = (i: number) => {
    edit((site) => removeKeyword(site, i));
    // Focus goes to the keyword that took its place, else the one before it, else the new keyword box.
    const next = i < keywords.length - 1 ? i : i - 1;
    focus(...(next >= 0 ? [[rowOwner(next), "keyword"] as const] : []), [addOwner, "text"]);
  };

  // Issues at a control show there; the rest under the keywords list (the list itself, a keyword
  // with no word, ...). A keyword's own pointers are claimed by its controls.
  const claimed = new Set<string>();
  keywords.forEach((k, i) => {
    claimed.add(`/keywords/${i}/keyword`);
    claimed.add(`/keywords/${i}/severity`);
    for (let j = 0; j < (Array.isArray(k.except) ? k.except.length : 0); j++)
      claimed.add(`/keywords/${i}/except/${j}`);
  });
  const at = (pointer: string) => {
    const found = checks.issues.filter((i) => i.pointer === pointer);
    return found.length > 0 ? found : undefined;
  };
  const rest = checks.issues.filter(
    (i) =>
      (i.pointer === "/keywords" || i.pointer.startsWith("/keywords/")) && !claimed.has(i.pointer),
  );
  const restId = `${idPrefix}-kw-issues`;

  const usable = usableKeywords(keywords);
  const styles = stylesOf(doc);
  const shownSample =
    sampleText ??
    usable
      .slice(0, 6)
      .map((k) => k.keyword)
      .join(", ");
  const rawStyles = (
    typeof doc.keywordSeverityStyles === "object" && doc.keywordSeverityStyles !== null
      ? doc.keywordSeverityStyles
      : {}
  ) as Record<string, unknown>;

  return (
    <EditorSection
      pointer="/keywords"
      label={t("admin.cards.keywordsRow")}
      configKey="keywords"
      crumb={t("admin.tree.cards")}
    >
      <Sect title={t("admin.keywords.sample.title")} hint={t("admin.keywords.sample.hint")}>
        <div>
          <label htmlFor={sampleId}>{t("admin.keywords.sample.label")}</label>{" "}
          <input
            id={sampleId}
            type="text"
            className="qm-field__input"
            autoComplete="off"
            value={shownSample}
            onChange={(e) => setSampleText(e.target.value)}
          />
        </div>
        <fieldset className="qm-kw__sample">
          <legend>
            <VisuallyHidden>{t("admin.keywords.sample.line")}</VisuallyHidden>
          </legend>
          {styles === null ? (
            <span className="qm-sect__hint">{t("admin.keywords.sample.paused")}</span>
          ) : (
            <Highlighted
              text={shownSample}
              keywords={usable}
              highlight
              styles={styles}
              t={translator.t}
            />
          )}
        </fieldset>
      </Sect>
      <Sect
        wide
        title={t("admin.keywords.keywords.title")}
        hint={t("admin.keywords.keywords.hint")}
      >
        {keywords.length === 0 ? (
          <p>{t("admin.keywords.none")}</p>
        ) : (
          <ul
            className="qm-kw__list"
            aria-label={t("admin.keywords.table")}
            aria-describedby={rest.length > 0 ? restId : undefined}
          >
            {keywords.map((k, i) => {
              const n = i + 1;
              const style: KeywordStyle = {
                keyword: str(k.keyword),
                severity: isSeverity(k.severity) ? k.severity : "info",
                ...(Array.isArray(k.except)
                  ? { except: k.except.map((e) => (typeof e === "string" ? e : "")) }
                  : {}),
              };
              const keywordIssues = at(`/keywords/${i}/keyword`);
              const severityIssues = at(`/keywords/${i}/severity`);
              const name =
                style.keyword === "" ? t("admin.keywords.unnamed", { n }) : style.keyword;
              return (
                <KeywordRow
                  key={ids[i]}
                  n={n}
                  owner={rowOwner(i)}
                  style={style}
                  name={name}
                  keywordIssues={keywordIssues}
                  severityIssues={severityIssues}
                  exceptIssues={(j) => at(`/keywords/${i}/except/${j}`)}
                  onKeyword={(text) =>
                    changeKeyword(i, (c) => ({ ...c, keyword: text }), `keyword:${i}`)
                  }
                  onSeverity={(severity) => changeKeyword(i, (c) => ({ ...c, severity }))}
                  onExcept={(j, text) =>
                    changeKeyword(
                      i,
                      (c) =>
                        withExceptList(
                          c,
                          exceptOf(c).map((p, m) => (m === j ? text : p)),
                        ),
                      `except:${i}:${j}`,
                    )
                  }
                  onAddExcept={(phrase) => {
                    let added = false;
                    edit((site) => {
                      const next = addExcept(site, i, phrase);
                      added = next !== site;
                      return next;
                    });
                    return added;
                  }}
                  onRemoveExcept={(j) => edit((site) => removeExcept(site, i, j))}
                  onRemove={() => remove(i)}
                  focus={focus}
                />
              );
            })}
          </ul>
        )}
        <IssueMessages id={restId} issues={rest.length > 0 ? rest : undefined} />
        <div className="qm-kw__add">
          <div>
            <label htmlFor={newId}>{t("admin.keywords.new")}</label>{" "}
            <input
              id={newId}
              type="text"
              className="qm-field__input"
              autoComplete="off"
              data-owner={addOwner}
              data-role="text"
              value={newText}
              aria-invalid={needWord ? "true" : undefined}
              aria-describedby={needWord ? needWordId : undefined}
              onChange={(e) => {
                setNewText(e.target.value);
                setNeedWord(false);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                add();
              }}
            />
            {needWord && (
              <span id={needWordId} className="qm-admin__issues">
                <span className="qm-admin__issue qm-admin__issue--error">
                  {t("admin.config.level.error")} {t("admin.keywords.newRequired")}
                </span>
              </span>
            )}
          </div>
          <div>
            <label htmlFor={newSeverityId}>{t("admin.keywords.newSeverity")}</label>{" "}
            <select
              id={newSeverityId}
              value={newSeverity}
              onChange={(e) => {
                const v = e.target.value;
                if (isSeverity(v)) setNewSeverity(v);
              }}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`severity.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="qm-button" onClick={add}>
            {t("admin.keywords.add")}
          </button>
        </div>
      </Sect>
      <Sect wide title={t("admin.keywords.styles.title")} hint={t("admin.keywords.styles.hint")}>
        {SEVERITIES.map((s) => (
          <StyleFieldset
            key={s}
            severity={s}
            idPrefix={idPrefix}
            styles={styles}
            tokens={tokenOverrides(doc)}
            style={
              (typeof rawStyles[s] === "object" && rawStyles[s] !== null ? rawStyles[s] : {}) as Obj
            }
          />
        ))}
      </Sect>
    </EditorSection>
  );
}
