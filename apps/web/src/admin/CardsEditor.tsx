import type { MappingElement, ResponseMapping } from "@querymodule/core/config";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useContext, useMemo, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { applyCardsEdit, cardsSiteOf, configDraftStore, useDraft } from "./builder-store.js";
import { CardRow } from "./CardRow.js";
import { cardIndexOf, useCardName, useTypeName } from "./card-names.js";
import {
  addCard,
  cardsByType,
  labelKeyPrefix,
  moveCard,
  newLabelKey,
  payloadPaths,
  removeCard,
  updateCard,
} from "./cards-model.js";
import { ChecksContext, IssueMessages } from "./checks.js";
import {
  Advanced,
  asObjects,
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
import { parseMock } from "./mock-model.js";
import { ConditionEditor, useFieldInfo } from "./RulesEditor.js";
import { useRowIds } from "./row-ids.js";
import { cardsTypeOf, cardsTypePointer, SelectionContext } from "./selection.js";
import { WinsTable } from "./WinsTable.js";

/**
 * The Result cards editor (Task 10, #603; FR-060, UX-015, UX-016; spec 4.5; design note
 * 2026-10-07-result-card-config, visual system "Card editor"). A query type's row lists its cards
 * with Add; a card shows where it applies (source, persona, rule), its rows and its Advanced
 * settings. Every edit goes through the cards model, one undo step each (typing coalesces). The
 * path picker reads key names from the draft's mock payloads only; no payload value is shown here.
 */

const ROW_POINTER = /^\/responseMappings\/([0-9]+)\/elements\/([0-9]+)(\/|$)/;

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
  // Decided when the live config is first known and again whenever the live version changes (a
  // publish, a rollback), never while the key is typed (T10-20): a new card whose key is typed to a
  // live id stays editable, and the duplicate shows as a check instead.
  const isLive = (live: JsonObject) =>
    asObjects(live.responseMappings).some((m) => str(m.id) === id);
  const [lock, setLock] = useState<{ live: JsonObject; locked: boolean } | null>(() =>
    server === null ? null : { live: server.liveDoc, locked: isLive(server.liveDoc) },
  );
  if (server !== null && lock?.live !== server.liveDoc)
    setLock({ live: server.liveDoc, locked: isLive(server.liveDoc) });
  const locked = lock?.locked === true;
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

  const setElements = (next: MappingElement[], coalesce: string | false = false) =>
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
  // Typing coalesces per control: the key names the card, the row and the control (T11-14).
  const setElement = (i: number, el: MappingElement, typing?: string) =>
    setElements(
      elements.map((e, j) => (j === i ? el : e)),
      typing === undefined ? false : `card${index}:row${ids[i]}:${typing}`,
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
              onChange={(next, typing) => setElement(i, next, typing)}
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
