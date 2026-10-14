import type { MappingElement, ResponseMapping } from "@querymodule/core/config";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useCallback, useContext, useId, useMemo, useRef, useState } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { applyCardsEdit, cardsSiteOf, configDraftStore, useDraft } from "./builder-store.js";
import {
  addCard,
  cardsByType,
  labelKeyPrefix,
  moveCard,
  newLabelKey,
  type PayloadPath,
  payloadPaths,
  removeCard,
  updateCard,
} from "./cards-model.js";
import { ChecksContext, IssueMessages } from "./checks.js";
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
import { parseMock } from "./mock-model.js";
import { ConditionEditor, useFieldInfo } from "./RulesEditor.js";
import { cardsTypeOf, cardsTypePointer, SelectionContext } from "./selection.js";

/**
 * The Result cards editor (Task 10, #603; FR-060, UX-015, UX-016; spec 4.5; design note
 * 2026-10-07-result-card-config, visual system "Card editor"). A query type's row lists its cards
 * with Add; a card shows where it applies (source, persona, rule), its rows and its Advanced
 * settings. Every edit goes through the cards model, one undo step each (typing coalesces). The
 * path picker reads key names from the draft's mock payloads only; no payload value is shown here.
 */

const CARD_POINTER = /^\/responseMappings\/([0-9]+)(\/|$)/;

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
  const { pointer, select } = useContext(SelectionContext);
  const focus = useFocusRequest();
  const code = pointer === null ? null : cardsTypeOf(pointer);
  const index = cardIndexOf(pointer);
  const card = index === null ? undefined : asObjects(doc.responseMappings)[index];
  if (code !== null)
    return <TypeCards doc={doc} code={code} idPrefix={idPrefix} focus={focus} select={select} />;
  if (index === null || card === undefined) return null;
  return (
    <CardEditor
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
const FORMATS = ["text", "upper", "phone", "date"] as const;

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
  const { mock } = useDraft();
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
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const [gen, setGen] = useState(0);
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
    setElements([...elements, el]);
    setOpen((s) => new Set(s).add(at));
    focus([rowOwner(at), "path"]);
  };
  const moveRow = (from: number, to: number) => {
    const next = [...elements];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    setElements(next);
    setOpen((s) => {
      const out = new Set<number>();
      for (const i of s) out.add(i === from ? to : i === to ? from : i);
      return out;
    });
    setGen((g) => g + 1);
    focus([rowOwner(to), to < from ? "up" : "down"], [rowOwner(to), to < from ? "down" : "up"]);
  };
  const removeRow = (i: number) => {
    setElements(elements.filter((_, j) => j !== i));
    setOpen((s) => {
      const out = new Set<number>();
      for (const j of s) if (j !== i) out.add(j > i ? j - 1 : j);
      return out;
    });
    setGen((g) => g + 1);
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

  // config.duplicateMapping sits at the card's own pointer: under the rule, with the other card.
  const own = (checks.byPointer.get(pointer) ?? []).filter(
    (i) => i.key === "config.duplicateMapping",
  );
  const all = asObjects(doc.responseMappings);
  const otherIndex =
    own.length === 0
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
      <Sect title={t("admin.cards.appliesTo")}>
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
        <fieldset className="qm-mock__radios">
          <legend>{t("admin.cards.when")}</legend>
          <label className="qm-mock__radio">
            <input
              type="radio"
              name={ruleName}
              checked={!ruleOn}
              onChange={() => setPath([...path, "when"], undefined)}
            />{" "}
            {t("admin.cards.always")}
          </label>
          <label className="qm-mock__radio">
            <input
              type="radio"
              name={ruleName}
              checked={ruleOn}
              onChange={() => setPath([...path, "when"], { field: firstField, op: "notEmpty" })}
            />{" "}
            {t("admin.cards.onlyWhen")}
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
      <Sect title={t("admin.cards.rows")}>
        <ul className="qm-mock__scenarios">
          {elements.map((el, i) => (
            <CardRow
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity; gen remounts on move
              key={`${gen}-${i}`}
              el={el}
              index={i}
              count={elements.length}
              owner={rowOwner(i)}
              open={open.has(i)}
              paths={paths}
              cardId={id}
              takenKeys={takenKeys}
              onToggle={() =>
                setOpen((s) => {
                  const out = new Set(s);
                  if (out.has(i)) out.delete(i);
                  else out.add(i);
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
        <TextControl
          idPrefix={idPrefix}
          path={[...path, "id"]}
          label={t("admin.cards.key")}
          value={card.id}
        />
        <p>
          {t("admin.cards.labelPrefix")} <code>{labelKeyPrefix(id)}</code>
        </p>
      </Advanced>
    </EditorSection>
  );
}

interface CardRowProps {
  el: MappingElement;
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
  const format = el.kind === "value" ? (el.format?.type ?? "text") : "text";
  const formats: readonly string[] = FORMATS.includes(format as (typeof FORMATS)[number])
    ? FORMATS
    : [...FORMATS, format];
  return (
    <li className="qm-mock__scenario">
      <fieldset aria-labelledby={headId} className="qm-mock__scenario-box">
        <div className="qm-mock__scenario-head">
          <h5 id={headId}>{shownName}</h5>
          <p className="qm-mock__summary">
            <code>{el.path}</code> {kindWord}, {viewWord}
            {marked ? "" : `, ${t("admin.cards.notMarked")}`}
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
                aria-describedby={unresolved ? warnId : undefined}
                onChange={(e) => onChange({ ...el, path: e.target.value }, true)}
              />
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
                onChange={(e) => setLabel(translator.locale, el.labelKey, e.target.value)}
              />
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
                <select
                  id={`${uid}-format`}
                  value={format}
                  onChange={(e) => {
                    const { format: _old, ...rest } = el;
                    const f = e.target.value;
                    onChange(
                      f === "text"
                        ? rest
                        : f === "date"
                          ? { ...rest, format: { type: "date", pattern: "MM-DD-YY" } }
                          : f === "upper" || f === "phone"
                            ? { ...rest, format: { type: f } }
                            : el,
                    );
                  }}
                >
                  {formats.map((f) => (
                    <option key={f} value={f}>
                      {t(`admin.cards.format.${f}`)}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <Columns el={el} cardId={cardId} takenKeys={takenKeys} onChange={onChange} />
            )}
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

type TableElement = Extract<MappingElement, { kind: "table" }>;

/** A table row's columns: path relative to one entry, label, mark, remove; Add column. */
function Columns({
  el,
  cardId,
  takenKeys,
  onChange,
}: {
  el: TableElement;
  cardId: string;
  takenKeys(): Set<string>;
  onChange(el: MappingElement, coalesce?: boolean): void;
}) {
  const t = useT();
  const translator = useTranslator();
  const labelText = useLabelText();
  const { setLabel } = useDraftSetters();
  const addRef = useRef<HTMLButtonElement>(null);
  const setColumns = (columns: TableElement["columns"], coalesce = false) =>
    onChange({ ...el, columns }, coalesce);
  return (
    <div className="qm-mock__table-wrap">
      <table className="qm-mock__table">
        <caption>{t("admin.cards.columns")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("admin.cards.path")}</th>
            <th scope="col">{t("admin.cards.label")}</th>
            <th scope="col">{t("admin.cards.mark")}</th>
            <th scope="col">
              <VisuallyHidden>{t("admin.cards.column.remove")}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {el.columns.map((c, i) => {
            const n = i + 1;
            const name = labelText(c.labelKey) || c.path || t("admin.cards.column.n", { n });
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns have no identity
              <tr key={i}>
                <td>
                  <input
                    type="text"
                    className="qm-field__input qm-mock__mono"
                    aria-label={t("admin.cards.column.path", { n })}
                    value={c.path}
                    onChange={(e) =>
                      setColumns(
                        el.columns.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)),
                        true,
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    className="qm-field__input"
                    aria-label={t("admin.cards.column.label", { n })}
                    value={labelText(c.labelKey)}
                    onChange={(e) => setLabel(translator.locale, c.labelKey, e.target.value)}
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
                      className="qm-button"
                      onClick={() => {
                        setColumns(el.columns.filter((_, j) => j !== i));
                        // The button goes with its column: focus moves to Add column, never body.
                        addRef.current?.focus();
                      }}
                    >
                      {t("admin.cards.column.remove")}
                      <VisuallyHidden> {name}</VisuallyHidden>
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
