import { useMemo } from "react";
import { useT } from "../app/i18n-context.js";
import type { CardsSite, CardWin } from "./cards-model.js";
import { cardWins } from "./cards-model.js";
import { asObjects, type Obj, Sect, str, useLabelText } from "./controls.js";
import type { JsonObject } from "./draft.js";

const WINS_PERSONAS = ["dispatch", "mobileUnit"] as const;

/** Values that make one leaf of a card's rule hold, so the table can show a rule's effect. */
function ruleValues(when: unknown): Record<string, string> | null {
  const c = (typeof when === "object" && when !== null ? when : {}) as Obj;
  if (typeof c.field !== "string") return null;
  const v = c.value;
  const literal = Array.isArray(v) ? v[0] : v;
  if (c.op === "eq" || c.op === "in")
    return typeof literal === "string" ||
      typeof literal === "number" ||
      typeof literal === "boolean"
      ? { [c.field]: String(literal) }
      : null;
  return c.op === "notEmpty" ? { [c.field]: "ZZ" } : null;
}

/**
 * "Which card wins" (design, Card editor): for each source and persona, and for each value that
 * makes a card's rule hold, the winning card by mapResponse's own rule, its score and why. The rows
 * this card wins carry a "This card" tag. Configuration only: no payload content.
 */
export function WinsTable({
  doc,
  index,
  numbered,
}: {
  doc: JsonObject;
  index: number;
  numbered: (i: number) => string;
}) {
  const t = useT();
  const labelText = useLabelText();
  const mapping = asObjects(doc.responseMappings)[index];
  const code = str(mapping?.queryType);
  const type = asObjects(doc.queryTypes).find((q) => str(q.code) === code);
  const rows = useMemo(() => {
    const sources = asObjects(type?.sources).map((s) => str(s.sourceId));
    const personaKeys = asObjects(doc.personas).map((p) => str(p.key));
    const personas = WINS_PERSONAS.filter((k) => personaKeys.includes(k));
    const site = {
      responseMappings: doc.responseMappings,
      queryTypes: doc.queryTypes,
      keywords: doc.keywords,
      defaults: doc.defaults,
      picklists: doc.picklists,
      locales: doc.locales,
    } as unknown as CardsSite;
    const sets = new Map<string, Record<string, string>>([["", {}]]);
    for (const m of asObjects(doc.responseMappings)) {
      const values = m.queryType === code && m.when !== undefined ? ruleValues(m.when) : null;
      if (values !== null && sets.size < 5) sets.set(JSON.stringify(values), values);
    }
    const now = Date.now();
    const out: { key: string; source: string; persona: string; values: string; win: CardWin }[] =
      [];
    try {
      for (const [key, values] of sets)
        for (const source of sources.length > 0 ? sources : [""])
          for (const persona of personas)
            out.push({
              key: `${key}|${source}|${persona}`,
              source,
              persona,
              values: Object.entries(values)
                .map(([k, v]) => `${k} ${v}`)
                .join(", "),
              win: cardWins(
                site,
                { queryType: code, partValues: values, sourceId: source, persona },
                now,
              ),
            });
    } catch {
      // A draft the rule compiler cannot read yet (a half-edited rule): no table until it can.
      return [];
    }
    return out;
  }, [doc, code, type]);
  if (rows.length === 0) return null;
  const sourceName = (id: string) =>
    labelText(asObjects(doc.sources).find((x) => str(x.id) === id)?.labelKey) || id;
  const personaName = (key: string) =>
    labelText(asObjects(doc.personas).find((x) => str(x.key) === key)?.labelKey) || key;
  const why = (w: CardWin): string => {
    const parts: string[] = w.reasons.map((r) => t(`admin.cards.wins.why.${r}`));
    if (w.byOrder || (parts.length === 0 && w.fitting > 1))
      parts.push(t("admin.cards.wins.why.order"));
    if (parts.length === 0) parts.push(t("admin.cards.wins.why.only"));
    return t("admin.cards.wins.score", { score: w.score, why: parts.join(", ") });
  };
  return (
    <Sect wide title={t("admin.cards.wins.title")} hint={t("admin.cards.wins.hint")}>
      <div className="qm-wins">
        <table className="qm-mock__table qm-wins__table" aria-label={t("admin.cards.wins.title")}>
          <thead>
            <tr>
              <th scope="col">{t("admin.cards.wins.source")}</th>
              <th scope="col">{t("admin.cards.wins.persona")}</th>
              <th scope="col">{t("admin.cards.wins.card")}</th>
              <th scope="col">{t("admin.cards.wins.reason")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  {sourceName(r.source)}
                  {r.values !== "" && (
                    <>
                      {" "}
                      <span className="qm-sect__hint">
                        {t("admin.cards.wins.values", { values: r.values })}
                      </span>
                    </>
                  )}
                </td>
                <td>{personaName(r.persona)}</td>
                <td>
                  {r.win.winner === null ? t("admin.cards.wins.none") : numbered(r.win.winner)}
                  {r.win.winner === index && (
                    <>
                      {" "}
                      <strong className="qm-tag">{t("admin.cards.wins.thisCard")}</strong>
                    </>
                  )}
                </td>
                <td>{r.win.winner === null ? "" : why(r.win)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Sect>
  );
}
