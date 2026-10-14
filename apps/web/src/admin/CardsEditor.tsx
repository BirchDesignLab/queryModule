import type { MappingElement, ResponseMapping } from "@querymodule/core/config";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useCallback, useContext, useId, useMemo, useRef, useState } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { applyCardsEdit, cardsSiteOf, configDraftStore, useDraft } from "./builder-store.js";
import {
  addCard,
  type CardsSite,
  type CardWin,
  cardsByType,
  cardWins,
  labelKeyPrefix,
  moveCard,
  newLabelKey,
  type PayloadPath,
  payloadPaths,
  removeCard,
  updateCard,
} from "./cards-model.js";
import { ChecksContext, IssueMessages, isError } from "./checks.js";
import {
  Advanced,
  asObjects,
  ItemButtons,
  type Obj,
  Sect,
  SelectControl,
  str,
  TextControl,
  useDraftSetters,
  useFocusRequest,
  useLabelText,
} from "./controls.js";
import { type JsonObject, toPointer } from "./draft.js";
import { EditorSection } from "./GenericForm.js";
import type { DraftIssue } from "./issues.js";
import { parseMock } from "./mock-model.js";
import { ConditionEditor, useFieldInfo } from "./RulesEditor.js";
import { useRowIds } from "./row-ids.js";
import { cardsTypeOf, cardsTypePointer, issueWords, SelectionContext } from "./selection.js";

/**
 * The Result cards editor (Task 10, #603; FR-060, UX-015, UX-016; spec 4.5; design note
 * 2026-10-07-result-card-config, visual system "Card editor"). A query type's row lists its cards
 * with Add; a card shows where it applies (source, persona, rule), its rows and its Advanced
 * settings. Every edit goes through the cards model, one undo step each (typing coalesces). The
 * path picker reads key names from the draft's mock payloads only; no payload value is shown here.
 */

const CARD_POINTER = /^\/responseMappings\/([0-9]+)(\/|$)/;
const ROW_POINTER = /^\/responseMappings\/([0-9]+)\/elements\/([0-9]+)(\/|$)/;

/** The card index a pointer is in or at, else null. */
export function cardIndexOf(pointer: string | null): number | null {
  const m = pointer === null ? null : CARD_POINTER.exec(pointer);
  return m === null ? null : Number(m[1]);
}

/**
 * A card named by its narrowing (design: "All results", "National system", "Mobile unit", "Only
 * when a rule matches"), for the tree, the editor heading and the preview.
 */
export function useCardName(doc: JsonObject | null): (mapping: unknown) => string {
  const t = useT();
  const labelText = useLabelText();
  const sources = asObjects(doc?.sources);
  const personas = asObjects(doc?.personas);
  return useCallback(
    (mapping: unknown) => {
      const m = (typeof mapping === "object" && mapping !== null ? mapping : {}) as Obj;
      const parts: string[] = [];
      if (typeof m.sourceId === "string") {
        const s = sources.find((x) => str(x.id) === m.sourceId);
        parts.push(labelText(s?.labelKey) || m.sourceId);
      }
      if (typeof m.persona === "string") {
        const p = personas.find((x) => str(x.key) === m.persona);
        parts.push(labelText(p?.labelKey) || m.persona);
      }
      if (m.when !== undefined) parts.push(t("admin.cards.name.rule"));
      return parts.length === 0 ? t("admin.cards.name.all") : parts.join(", ");
    },
    [t, labelText, sources, personas],
  );
}

/** What makes two cards the same for the server's `config.duplicateMapping`. */
const narrowing = (m: Obj): string =>
  JSON.stringify([m.queryType, m.sourceId ?? null, m.persona ?? null, m.when ?? null]);

export function CardsEditor({ doc, idPrefix }: { doc: JsonObject; idPrefix: string }) {
  const t = useT();
  const { pointer, select } = useContext(SelectionContext);
  const focus = useFocusRequest();
  const code = pointer === null ? null : cardsTypeOf(pointer);
  const index = cardIndexOf(pointer);
  const card = index === null ? undefined : asObjects(doc.responseMappings)[index];
  if (code !== null)
    return <TypeCards doc={doc} code={code} idPrefix={idPrefix} focus={focus} select={select} />;
  // A selection with no card (the bare list, a card that is gone) still shows something to act on.
  if (index === null || card === undefined) return <p>{t("admin.editor.empty")}</p>;
  return (
    <CardEditor
      // State (open rows) belongs to one card: another card starts closed.
      key={index}
      doc={doc}
      index={index}
      card={card}
      idPrefix={idPrefix}
      focus={focus}
      select={select}
    />
  );
}

type Focus = ReturnType<typeof useFocusRequest>;

interface Shared {
  doc: JsonObject;
  idPrefix: string;
  focus: Focus;
  select: ((pointer: string) => void) | undefined;
}

function useTypeName(doc: JsonObject): (code: string) => string {
  const labelText = useLabelText();
  return (code) => {
    const type = asObjects(doc.queryTypes).find((q) => str(q.code) === code);
    return labelText(type?.labelKey) || code;
  };
}

function useAddCard(shared: Pick<Shared, "idPrefix" | "focus" | "select">) {
  const store = configDraftStore(useServices());
  return (code: string) => {
    let added = -1;
    applyCardsEdit(store, (site) => {
      const r = addCard(site, code);
      added = r.index;
      return r.site;
    });
    if (added < 0) return;
    shared.select?.(toPointer(["responseMappings", added]));
    shared.focus([`${shared.idPrefix}-card-heading`, "heading"]);
  };
}

/** A query type's row: its cards in config order, each one button away, and Add. */
function TypeCards({ doc, code, idPrefix, focus, select }: Shared & { code: string }) {
  const t = useT();
  const typeName = useTypeName(doc)(code);
  const cardName = useCardName(doc);
  const add = useAddCard({ idPrefix, focus, select });
  const entries = cardsByType(cardsSiteOf(doc)).get(code) ?? [];
  return (
    <EditorSection
      pointer={cardsTypePointer(code)}
      label={t("admin.cards.typeHeading", { type: typeName })}
      configKey={code}
      crumb={t("admin.tree.cards")}
      focusOwner={`${idPrefix}-cards-overview`}
    >
      {entries.length === 0 ? (
        <p>{t("admin.cards.none", { type: typeName })}</p>
      ) : (
        <ol className="qm-mock__scenarios">
          {entries.map(({ index, mapping }, k) => (
            <li key={index}>
              <button
                type="button"
                className="qm-button qm-button--ghost"
                onClick={() => select?.(toPointer(["responseMappings", index]))}
              >
                {t("admin.cards.cardRow", { n: k + 1, name: cardName(mapping) })}{" "}
                <span className="qm-tree__key">{mapping.id}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="qm-button" onClick={() => add(code)}>
        {t("admin.cards.addCard", { type: typeName })}
      </button>
    </EditorSection>
  );
}

const VIEWS = ["summary", "detail", "both"] as const;
const FORMATS = ["text", "upper", "phone", "date", "template"] as const;

function CardEditor({
  doc,
  index,
  card,
  idPrefix,
  focus,
  select,
}: Shared & { index: number; card: Obj }) {
  const t = useT();
  const store = configDraftStore(useServices());
  const { mock, server } = useDraft();
  const { setPath } = useDraftSetters();
  const checks = useContext(ChecksContext);
  const labelText = useLabelText();
  const cardName = useCardName(doc);
  const code = str(card.queryType);
  const typeName = useTypeName(doc)(code);
  const add = useAddCard({ idPrefix, focus, select });
  const type = asObjects(doc.queryTypes).find((q) => str(q.code) === code) ?? {};
  const info = useFieldInfo(type);
  const id = str(card.id);
  // A published card's key is what its label keys and the audit trail name: fixed from then on.
  const locked = asObjects(server?.liveDoc.responseMappings).some((m) => str(m.id) === id);
  const path = ["responseMappings", index] as const;
  const pointer = toPointer([...path]);
  const siblings = cardsByType(cardsSiteOf(doc)).get(code) ?? [];
  const position = siblings.findIndex((e) => e.index === index);
  const name = cardName(card);
  const numbered = (i: number) => {
    const k = siblings.findIndex((e) => e.index === i);
    return t("admin.cards.cardRow", { n: k + 1, name: cardName(siblings[k]?.mapping) });
  };
  const parsedMock = useMemo(() => {
    const parsed = mock === null ? null : parseMock(mock);
    return parsed?.ok === true ? parsed.mock : null;
  }, [mock]);
  const paths = useMemo(() => payloadPaths(parsedMock, code), [parsedMock, code]);
  const elements = asObjects(card.elements) as unknown as MappingElement[];
  // The row the selection or the issue button points into opens, so its control can take focus
  // (round 1, C1). Done while rendering, once per selection, so a row the user closes stays closed.
  const selection = useContext(SelectionContext);
  const rowIn = (p: string | null | undefined): number | null => {
    const m = p === null || p === undefined ? null : ROW_POINTER.exec(p);
    return m !== null && Number(m[1]) === index ? Number(m[2]) : null;
  };
  const wanted = rowIn(selection.focus) ?? rowIn(selection.pointer);
  // Rows have no identity of their own: each gets a stable one, so the open set and each row's
  // local state follow the row through a move, a removal, an undo and a redo (CRITIC-M2).
  const { ids, claim } = useRowIds(elements);
  const wantedId = wanted === null ? undefined : ids[wanted];
  const [open, setOpen] = useState<ReadonlySet<number>>(
    () => new Set(wantedId === undefined ? [] : [wantedId]),
  );
  const [seenSeq, setSeenSeq] = useState(selection.seq);
  if (seenSeq !== selection.seq) {
    setSeenSeq(selection.seq);
    if (wantedId !== undefined && !open.has(wantedId)) setOpen(new Set(open).add(wantedId));
  }
  const owner = `${idPrefix}-card-head`;
  const rowOwner = (i: number) => `${idPrefix}-card-row-${i}`;

  const setElements = (next: MappingElement[], coalesce = false) =>
    applyCardsEdit(
      store,
      (site) => {
        const current = site.responseMappings[index];
        return current === undefined
          ? site
          : updateCard(site, index, { ...current, elements: next } as ResponseMapping);
      },
      { coalesce },
    );
  const setElement = (i: number, el: MappingElement, coalesce = false) =>
    setElements(
      elements.map((e, j) => (j === i ? el : e)),
      coalesce,
    );
  const takenKeys = () => {
    const keys = new Set<string>();
    for (const m of asObjects(store.getState().doc?.responseMappings))
      for (const e of asObjects(m.elements)) {
        keys.add(str(e.labelKey));
        for (const c of asObjects(e.columns)) keys.add(str(c.labelKey));
      }
    for (const overlay of Object.values(store.getState().labels))
      for (const k of Object.keys(overlay)) keys.add(k);
    return keys;
  };

  const addRow = () => {
    const el = {
      kind: "value",
      path: "",
      labelKey: newLabelKey(id, takenKeys()),
      view: "summary",
    } as MappingElement;
    const at = elements.length;
    const rowId = claim(el);
    setElements([...elements, el]);
    setOpen((s) => new Set(s).add(rowId));
    focus([rowOwner(at), "path"]);
  };
  const moveRow = (from: number, to: number) => {
    const next = [...elements];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    setElements(next);
    focus([rowOwner(to), to < from ? "up" : "down"], [rowOwner(to), to < from ? "down" : "up"]);
  };
  const removeRow = (i: number) => {
    setElements(elements.filter((_, j) => j !== i));
    // Focus goes to the row that took its place, else the one before it, else Add row.
    const next = i < elements.length - 1 ? i : i - 1;
    focus(...(next >= 0 ? [[rowOwner(next), "toggle"] as const] : []), [`${idPrefix}-rows`, "add"]);
  };
  const moveTo = (target: number | undefined) => {
    if (target === undefined) return;
    applyCardsEdit(store, (site) => moveCard(site, index, target));
    select?.(toPointer(["responseMappings", target]));
    focus([owner, target < index ? "up" : "down"], [owner, target < index ? "down" : "up"]);
  };
  const remove = () => {
    applyCardsEdit(store, (site) => removeCard(site, index));
    select?.(cardsTypePointer(code));
    focus([`${idPrefix}-cards-overview`, "heading"]);
  };

  // Every issue at the card itself (config.duplicateMapping sits under the rule, with the other
  // card), and any inside it that no control below shows: an unknown type, say. The controls
  // below show their own (source, persona, rule, key) and the rows show theirs.
  const own = checks.issues.filter((i) => {
    if (i.pointer === pointer) return true;
    if (!i.pointer.startsWith(`${pointer}/`)) return false;
    const first = i.pointer.slice(pointer.length + 1).split("/")[0] ?? "";
    return !["elements", "sourceId", "persona", "when", "id"].includes(first);
  });
  const rowsOwn = checks.issues.filter((i) => i.pointer === `${pointer}/elements`);
  const rowIssues = (i: number) =>
    checks.issues.filter(
      (x) =>
        x.pointer === `${pointer}/elements/${i}` ||
        x.pointer.startsWith(`${pointer}/elements/${i}/`),
    );
  const duplicate = own.some((i) => i.key === "config.duplicateMapping");
  const all = asObjects(doc.responseMappings);
  const otherIndex = !duplicate
    ? -1
    : all.findIndex((m, i) => i !== index && narrowing(m) === narrowing(card));
  const ruleOn = card.when !== undefined;
  const ruleName = `${idPrefix}-card-${index}-rule`;
  const firstField = info.keys[0] ?? "";

  return (
    <EditorSection
      pointer={pointer}
      label={t("admin.cards.cardHeading", { type: typeName, name })}
      configKey={id}
      crumb={t("admin.tree.cards")}
      focusOwner={`${idPrefix}-card-heading`}
    >
      <div className="qm-mock__scenario-head">
        <p>
          {t("admin.cards.position", { n: position + 1, count: siblings.length, type: typeName })}
        </p>
        <div className="qm-mock__scenario-tools">
          {position > 0 && (
            <button
              type="button"
              className="qm-button"
              data-owner={owner}
              data-role="up"
              onClick={() => moveTo(siblings[position - 1]?.index)}
            >
              {t("admin.cards.moveUp")}
            </button>
          )}
          {position < siblings.length - 1 && (
            <button
              type="button"
              className="qm-button"
              data-owner={owner}
              data-role="down"
              onClick={() => moveTo(siblings[position + 1]?.index)}
            >
              {t("admin.cards.moveDown")}
            </button>
          )}
          <button type="button" className="qm-button qm-button--danger" onClick={remove}>
            {t("admin.cards.remove")}
            <VisuallyHidden> {name}</VisuallyHidden>
          </button>
          <button type="button" className="qm-button" onClick={() => add(code)}>
            {t("admin.cards.addCard", { type: typeName })}
          </button>
        </div>
      </div>
      <Sect
        title={t("admin.cards.appliesTo")}
        hint={t("admin.cards.appliesToHint", { type: typeName })}
        wide
      >
        <div className="qm-pair">
          <SelectControl
            idPrefix={idPrefix}
            path={[...path, "sourceId"]}
            label={t("admin.cards.source")}
            value={card.sourceId}
            options={asObjects(type.sources).map((s) => str(s.sourceId))}
            blank={t("admin.cards.anySource")}
            optionLabel={(s) =>
              labelText(asObjects(doc.sources).find((x) => str(x.id) === s)?.labelKey) || s
            }
          />
          <SelectControl
            idPrefix={idPrefix}
            path={[...path, "persona"]}
            label={t("admin.cards.persona")}
            value={card.persona}
            options={asObjects(doc.personas).map((p) => str(p.key))}
            blank={t("admin.cards.everyone")}
            optionLabel={(p) =>
              labelText(asObjects(doc.personas).find((x) => str(x.key) === p)?.labelKey) || p
            }
          />
        </div>
        <fieldset
          className="qm-choices"
          aria-describedby={own.length > 0 ? `${idPrefix}-card-${index}-issues` : undefined}
        >
          <legend>
            <VisuallyHidden>{t("admin.cards.when")}</VisuallyHidden>
          </legend>
          <label className="qm-choice">
            <input
              type="radio"
              name={ruleName}
              checked={!ruleOn}
              onChange={() => setPath([...path, "when"], undefined)}
            />
            <span>
              <b>{t("admin.cards.always")}</b>
              <span>{t("admin.cards.alwaysHint")}</span>
            </span>
          </label>
          <label className="qm-choice">
            <input
              type="radio"
              name={ruleName}
              checked={ruleOn}
              onChange={() => setPath([...path, "when"], { field: firstField, op: "notEmpty" })}
            />
            <span>
              <b>{t("admin.cards.onlyWhen")}</b>
              <span>{t("admin.cards.onlyWhenHint")}</span>
            </span>
          </label>
        </fieldset>
        {ruleOn && (
          <ConditionEditor
            value={card.when}
            path={[...path, "when"]}
            info={info}
            idPrefix={idPrefix}
            legend={t("admin.cards.whenLegend")}
          />
        )}
        <IssueMessages
          id={`${idPrefix}-card-${index}-issues`}
          issues={own.length > 0 ? own : undefined}
        />
        {otherIndex >= 0 && (
          <button
            type="button"
            className="qm-button"
            onClick={() => select?.(toPointer(["responseMappings", otherIndex]))}
          >
            {t("admin.cards.openOther", { name: numbered(otherIndex) })}
          </button>
        )}
      </Sect>
      <WinsTable doc={doc} index={index} numbered={numbered} />
      <Sect title={t("admin.cards.rows")} wide>
        <IssueMessages
          id={`${idPrefix}-card-${index}-rows-issues`}
          issues={rowsOwn.length > 0 ? rowsOwn : undefined}
        />
        <ul className="qm-mock__scenarios">
          {elements.map((el, i) => (
            <CardRow
              key={ids[i]}
              el={el}
              pointer={`${pointer}/elements/${i}`}
              issues={rowIssues(i)}
              index={i}
              count={elements.length}
              owner={rowOwner(i)}
              open={open.has(ids[i] ?? -1)}
              paths={paths}
              cardId={id}
              takenKeys={takenKeys}
              onToggle={() =>
                setOpen((s) => {
                  const out = new Set(s);
                  const rowId = ids[i] ?? -1;
                  if (out.has(rowId)) out.delete(rowId);
                  else out.add(rowId);
                  return out;
                })
              }
              onChange={(next, coalesce) => setElement(i, next, coalesce)}
              onMove={moveRow}
              onRemove={removeRow}
            />
          ))}
        </ul>
        <button
          type="button"
          className="qm-button"
          data-owner={`${idPrefix}-rows`}
          data-role="add"
          onClick={addRow}
        >
          {t("admin.cards.addRow")}
        </button>
      </Sect>
      <Advanced path={[...path]} keys={["id"]}>
        {locked ? (
          <div>
            <label htmlFor={`${idPrefix}-card-${index}-key`}>{t("admin.cards.key")}</label>{" "}
            <input
              id={`${idPrefix}-card-${index}-key`}
              type="text"
              readOnly
              value={id}
              aria-describedby={`${idPrefix}-card-${index}-key-hint`}
            />
            <p id={`${idPrefix}-card-${index}-key-hint`} className="qm-sect__hint">
              {t("admin.cards.keyLocked")}
            </p>
          </div>
        ) : (
          <TextControl
            idPrefix={idPrefix}
            path={[...path, "id"]}
            label={t("admin.cards.key")}
            value={card.id}
          />
        )}
        <p>
          {t("admin.cards.labelPrefix")} <code>{labelKeyPrefix(id)}</code>
        </p>
      </Advanced>
    </EditorSection>
  );
}

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
function WinsTable({
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

interface CardRowProps {
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
function CardRow({
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
  const viewWord = t(`admin.cards.view.${el.view}`);
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
          <div className="qm-mock__scenario-tools">
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
            <ItemButtons
              owner={owner}
              name={shownName}
              index={index}
              count={count}
              removeLabel={t("admin.cards.row.remove")}
              onMove={onMove}
              onRemove={onRemove}
            />
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

type Format = NonNullable<Extract<MappingElement, { kind: "value" }>["format"]>;

/**
 * A format control: As sent, Upper case, Phone number, Date MM-DD-YY or Template (text with
 * {value} where the value goes). As sent is no format at all (the key is removed). The caller
 * names the select (label or aria-label); the Template text has its own name.
 */
function FormatPicker({
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
function Columns({
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
  onChange(el: MappingElement, coalesce?: boolean): void;
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
  const setColumns = (columns: TableElement["columns"], coalesce = false) =>
    onChange({ ...el, columns }, coalesce);
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
                        true,
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
                    onChange={(format, coalesce) =>
                      setColumns(
                        el.columns.map((x, j) => {
                          if (j !== i) return x;
                          const { format: _old, ...others } = x;
                          return format === undefined ? others : { ...others, format };
                        }),
                        coalesce,
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
