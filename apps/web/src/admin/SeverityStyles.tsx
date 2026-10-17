import { COLOR_TOKENS, tokensContrast } from "@querymodule/tokens";
import { Highlighted, SeverityBadge, VisuallyHidden } from "@querymodule/web-ui";
import { useT, useTranslator } from "../app/i18n-context.js";
import { CheckControl, type Obj, SelectControl, TextControl, useItemIssues } from "./controls.js";
import type { JsonObject } from "./draft.js";
import type { Sev, Styles } from "./keyword-severity.js";

const COLOR_NAMES: readonly string[] = Object.keys(COLOR_TOKENS);
/** The icons the shipped set draws; an unknown name draws a generic mark and still lists. */
const ICONS = ["alert-octagon", "alert-triangle", "info"] as const;
const ICON_LABEL: Readonly<Record<string, string>> = {
  "alert-octagon": "admin.keywords.icon.alertOctagon",
  "alert-triangle": "admin.keywords.icon.alertTriangle",
  info: "admin.keywords.icon.info",
};

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
export function tokenOverrides(doc: JsonObject): TokenOverrides {
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
export function StyleFieldset({
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
    const key = `admin.keywords.color.${token.replace(/^color\./, "").replaceAll(".", "-")}`;
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
