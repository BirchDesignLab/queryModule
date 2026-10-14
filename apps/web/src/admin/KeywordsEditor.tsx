import type { KeywordStyle } from "@querymodule/core/config";
import { COLOR_TOKENS, tokensContrast } from "@querymodule/tokens";
import { Highlighted, SeverityBadge, VisuallyHidden } from "@querymodule/web-ui";
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
import { ChecksContext, IssueMessages, isError } from "./checks.js";
import {
  asObjects,
  CheckControl,
  type Obj,
  Sect,
  SelectControl,
  str,
  TextControl,
  useFocusRequest,
  useItemIssues,
} from "./controls.js";
import type { JsonObject } from "./draft.js";
import { EditorSection } from "./GenericForm.js";
import type { DraftIssue } from "./issues.js";
import { useRowIds } from "./row-ids.js";

/**
 * The keywords and severity editor (Task 11, #604; FR-060, UX-010, UX-011; spec 4.1, 4.5, 6.5).
 * The keywords with their severity and `except` phrases, the look of each severity (text and
 * background token, bold, icon, marker), and a sample line drawn by the production `Highlighted`.
 * The diagnostics come from validateSiteConfig at the server's pointers (`config.severityContrast`,
 * `config.exceptWithoutKeyword`) and show at the control they are about. Text controls write what
 * is typed, spaces and blanks included, as one undo step (typing coalesces); only Add trims. The
 * sample text is this pane's state only: it is never in the draft.
 */

const SEVERITIES = ["critical", "warning", "info"] as const;
type Sev = (typeof SEVERITIES)[number];
const isSeverity = (v: unknown): v is Sev =>
  (SEVERITIES as readonly string[]).includes(v as string);

const COLOR_NAMES: readonly string[] = Object.keys(COLOR_TOKENS);
/** The icons the shipped set draws; an unknown name draws a generic mark and still lists. */
const ICONS = ["alert-octagon", "alert-triangle", "info"] as const;
const ICON_LABEL: Readonly<Record<string, string>> = {
  "alert-octagon": "admin.keywords.icon.alertOctagon",
  "alert-triangle": "admin.keywords.icon.alertTriangle",
  info: "admin.keywords.icon.info",
};

type Styles = Parameters<typeof Highlighted>[0]["styles"];

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
      <Sect title={t("admin.keywords.keywords.title")} hint={t("admin.keywords.keywords.hint")}>
        {keywords.length === 0 ? (
          <p>{t("admin.keywords.none")}</p>
        ) : (
          <div className="qm-mock__table-wrap">
            <table
              className="qm-mock__table"
              aria-describedby={rest.length > 0 ? restId : undefined}
            >
              <caption>
                <VisuallyHidden>{t("admin.keywords.table")}</VisuallyHidden>
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.keywords.col.keyword")}</th>
                  <th scope="col">{t("admin.keywords.col.severity")}</th>
                  <th scope="col">{t("admin.keywords.col.except")}</th>
                  <th scope="col">
                    <VisuallyHidden>{t("admin.keywords.remove")}</VisuallyHidden>
                  </th>
                </tr>
              </thead>
              <tbody>
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
              </tbody>
            </table>
          </div>
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
      <Sect title={t("admin.keywords.styles.title")} hint={t("admin.keywords.styles.hint")}>
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

interface KeywordRowProps {
  /** 1-based position, for the accessible names. */
  n: number;
  owner: string;
  style: KeywordStyle;
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

/** One keyword: its word, severity and exception phrases, and Remove. Name and cells carry its number. */
function KeywordRow({
  n,
  owner,
  style,
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
  return (
    <tr>
      <td>
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
      </td>
      <td>
        <select
          aria-label={t("admin.keywords.severity.n", { n })}
          aria-invalid={isError(severityIssues)}
          aria-describedby={severityIssues === undefined ? undefined : `${uid}-severity-issues`}
          value={style.severity}
          onChange={(e) => {
            const v = e.target.value;
            if (isSeverity(v)) onSeverity(v);
          }}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t(`severity.${s}`)}
            </option>
          ))}
        </select>
        <IssueMessages id={`${uid}-severity-issues`} issues={severityIssues} />
      </td>
      <td>
        <ul className="qm-kw__phrases">
          {phrases.map((p, j) => {
            const issues = exceptIssues(j);
            const m = j + 1;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: phrases have no identity
              <li key={j}>
                <input
                  type="text"
                  className="qm-field__input"
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
            className="qm-field__input"
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
      </td>
      <td>
        <button type="button" className="qm-button qm-button--danger" onClick={onRemove}>
          {t("admin.keywords.remove")}
          <VisuallyHidden> {name}</VisuallyHidden>
        </button>
      </td>
    </tr>
  );
}

const MODES = [
  { mode: "night", label: "theme.night" },
  { mode: "day", label: "theme.day" },
  { mode: "redShift", label: "theme.redShift" },
] as const;
type Mode = (typeof MODES)[number]["mode"];
type TokenOverrides = Partial<Record<"all" | Mode, Record<string, string>>>;
/** UX-011 floor the shipped styles keep (developer ruling 7); core still errors only below 4.5:1. */
const CONTRAST_FLOOR = 7;

/** The draft's `theme.tokens` overrides per mode, strings only. */
function tokenOverrides(doc: JsonObject): TokenOverrides {
  const theme = doc.theme as Obj | undefined;
  const raw = (typeof theme === "object" && theme !== null ? theme.tokens : undefined) as
    | Record<string, unknown>
    | undefined;
  const out: TokenOverrides = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const k of ["all", "night", "day", "redShift"] as const) {
    const v = raw[k];
    if (typeof v !== "object" || v === null) continue;
    out[k] = Object.fromEntries(
      Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  }
  return out;
}

/** Ratio of the style's text over its background in one theme, floored to two decimals; null if unknown. */
function ratioIn(style: Obj, mode: Mode, tokens: TokenOverrides): string | null {
  if (typeof style.color !== "string" || typeof style.background !== "string") return null;
  const overrides = { ...tokens.all, ...tokens[mode] };
  const fg = tokensContrast.value(style.color, mode, overrides);
  const bg = tokensContrast.value(style.background, mode, overrides);
  if (fg === undefined || bg === undefined) return null;
  const r = tokensContrast.ratio(fg, bg);
  return (Math.floor(r * 100) / 100).toFixed(2);
}

/**
 * One severity's look: text and background from the theme's color tokens, bold, icon and marker.
 * The contrast diagnostic of the pair sits at the style itself (`/keywordSeverityStyles/<severity>`),
 * linked to the fieldset, so the issue button lands on its first control.
 */
function StyleFieldset({
  severity,
  idPrefix,
  style,
  styles,
  tokens,
}: {
  severity: Sev;
  idPrefix: string;
  style: Obj;
  styles: Styles | null;
  tokens: TokenOverrides;
}) {
  const t = useT();
  const translator = useTranslator();
  const label = t(`severity.${severity}`);
  const path = ["keywordSeverityStyles", severity] as const;
  // A token's plain name ("Critical background"); a token with none lists by its key.
  const colorName = (token: string): string => {
    const key = `admin.keywords.color.${token.replace(/^color\./, "")}`;
    return translator.has(key) ? t(key) : token;
  };
  const { describedBy, messages } = useItemIssues(idPrefix, path, [
    "color",
    "background",
    "bold",
    "icon",
    "marker",
    "audibleCue",
  ]);
  const icons: readonly string[] =
    typeof style.icon === "string" && style.icon !== "" && !ICONS.includes(style.icon as never)
      ? [...ICONS, style.icon]
      : ICONS;
  return (
    <fieldset className="qm-kw__style" aria-describedby={describedBy}>
      <legend>{t("admin.keywords.style.legend", { severity: t(`severity.${severity}`) })}</legend>
      <SelectControl
        idPrefix={idPrefix}
        path={[...path, "color"]}
        label={t("admin.keywords.style.color")}
        value={style.color}
        options={COLOR_NAMES}
        optionLabel={colorName}
      />
      <SelectControl
        idPrefix={idPrefix}
        path={[...path, "background"]}
        label={t("admin.keywords.style.background")}
        value={style.background}
        options={COLOR_NAMES}
        optionLabel={colorName}
      />
      <CheckControl
        idPrefix={idPrefix}
        path={[...path, "bold"]}
        label={t("admin.keywords.style.bold")}
        value={style.bold}
      />
      <SelectControl
        idPrefix={idPrefix}
        path={[...path, "icon"]}
        label={t("admin.keywords.style.icon")}
        value={style.icon}
        options={icons}
        optionLabel={(o) => {
          const key = ICON_LABEL[o];
          return key === undefined ? o : t(key);
        }}
      />
      <TextControl
        idPrefix={idPrefix}
        path={[...path, "marker"]}
        label={t("admin.keywords.style.marker")}
        value={style.marker}
      />
      <ul className="qm-kw__ratios" aria-label={t("admin.keywords.style.contrast")}>
        {MODES.map(({ mode, label: key }) => {
          const ratio = ratioIn(style, mode, tokens);
          if (ratio === null) return null;
          const under = Number(ratio) < CONTRAST_FLOOR;
          return (
            <li key={mode}>
              {t("admin.keywords.style.ratio", { theme: t(key), ratio })}
              {under ? ` ${t("admin.keywords.style.under")}` : ""}
            </li>
          );
        })}
      </ul>
      {styles !== null && (
        <fieldset className="qm-kw__live">
          <legend>
            <VisuallyHidden>{t("admin.keywords.style.live")}</VisuallyHidden>
          </legend>
          <SeverityBadge severity={severity} styles={styles} t={translator.t} />{" "}
          <Highlighted
            text={label}
            keywords={[{ keyword: label, severity }]}
            highlight
            styles={styles}
            t={translator.t}
          />
        </fieldset>
      )}
      {messages}
    </fieldset>
  );
}
