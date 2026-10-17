import { VisuallyHidden } from "@querymodule/web-ui";
import {
  type FocusEvent,
  Fragment,
  type KeyboardEvent,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { cardsSiteOf, configDraftStore, useDraft } from "./builder-store.js";
import { useCardName } from "./card-names.js";
import { cardsByType } from "./cards-model.js";
import { ChecksContext } from "./checks.js";
import { asObjects, str, useLabelText } from "./controls.js";
import { type JsonObject, toPointer } from "./draft.js";
import { useItemName } from "./FormTab.js";
import { mockPointer } from "./mock-edit.js";
import { parseMock } from "./mock-model.js";
import {
  cardsTypePointer,
  HIDDEN_KEYS,
  isRootIssue,
  issueWords,
  LABELS_ITEM,
} from "./selection.js";
import { type FlatItem, isTypeAheadKey, treeAction, typeAhead } from "./tree-nav.js";

/**
 * Counts of what rendered, for the test that pins the cost of a label keystroke: `rows` is the
 * memoized rows, `labels` the row labels, each of which follows its own key in the draft. Counted
 * in development and test builds only: in production `count` is dead code and the object is
 * dropped from the bundle.
 */
export const treeRenderStats = { rows: 0, labels: 0 };
function count(kind: keyof typeof treeRenderStats): void {
  if (import.meta.env.DEV) treeRenderStats[kind]++;
}

/** One row of the builder tree: a treeitem that selects `pointer`, and its children. */
interface TreeNode {
  pointer: string;
  /** Shown when the label key has no text: the key or code. */
  label: string;
  /** The label key whose text the row shows (the draft's, else the shipped one). */
  labelKey?: string;
  /** The config key or code beside it, in mono; omitted when it equals the label. */
  key?: string;
  /**
   * A shorter name the row shows in place of `label`; the full label stays as its accessible name,
   * so rows that share a short name are still told apart (a mock response by its source).
   */
  short?: string;
  children: TreeNode[];
  errors: number;
  warnings: number;
}

function useTreeNodes(
  doc: JsonObject,
  mock: JsonObject | null,
): { types: TreeNode[]; cards: TreeNode[]; site: TreeNode[]; mock: TreeNode[] } {
  const name = useItemName();
  const t = useT();
  const labelText = useLabelText();
  const cardName = useCardName(doc);
  const { issues } = useContext(ChecksContext);
  return useMemo(() => {
    // Issues at or under a pointer. A section's fields live under /fields, not under the section,
    // so a section adds its fields' counts; a type's pointer already covers all of its parts.
    const under = (pointer: string) => {
      let errors = 0;
      let warnings = 0;
      for (const i of issues)
        if (i.pointer === pointer || i.pointer.startsWith(`${pointer}/`)) {
          if (i.level === "error") errors++;
          else warnings++;
        }
      return { errors, warnings };
    };
    const node = (
      pointer: string,
      text: string,
      key: string,
      children: TreeNode[] = [],
      rollUp = false,
      labelKey = "",
      short = "",
    ): TreeNode => {
      const own = under(pointer);
      const counts = rollUp
        ? children.reduce(
            (c, n) => ({ errors: c.errors + n.errors, warnings: c.warnings + n.warnings }),
            own,
          )
        : own;
      return {
        pointer,
        label: text,
        ...(labelKey !== "" ? { labelKey } : {}),
        ...(short !== "" ? { short } : {}),
        ...(key !== "" ? { key } : {}),
        children,
        ...counts,
      };
    };
    const types = asObjects(doc.queryTypes).map((type, i) => {
      const code = str(type.code);
      const fields = asObjects(type.fields).map((f, j) => ({ f, j }));
      const sections = asObjects(type.sections);
      const fieldNode = ({ f, j }: { f: JsonObject; j: number }) =>
        node(
          toPointer(["queryTypes", i, "fields", j]),
          str(f.key),
          str(f.key),
          [],
          false,
          str(f.labelKey),
        );
      // A field without a section renders in the first one (QueryForm), so it is listed there.
      const firstKey = sections.length > 0 ? str(sections[0]?.key) : null;
      const children =
        sections.length === 0
          ? fields.map(fieldNode)
          : sections.map((section, k) => {
              const key = str(section.key);
              const own = fields.filter(({ f }) => {
                const s = str(f.section);
                return s === key || (s === "" && key === firstKey);
              });
              return node(
                toPointer(["queryTypes", i, "sections", k]),
                key,
                key,
                own.map(fieldNode),
                true,
                str(section.labelKey),
              );
            });
      return node(toPointer(["queryTypes", i]), code, code, children, false, str(type.labelKey));
    });
    // Result cards (Task 10, #603): per query type its cards in config order, numbered and named
    // by their narrowing with the card key in mono, then Keywords and severity.
    const typeLabels = new Map(
      asObjects(doc.queryTypes).map((q) => [str(q.code), str(q.labelKey)]),
    );
    const cards = [...cardsByType(cardsSiteOf(doc)).entries()].map(([code, entries]) =>
      node(
        cardsTypePointer(code),
        t("admin.cards.typeRow", { type: labelText(typeLabels.get(code)) || code }),
        // No code in mono: the Query types row already ends in it, and a lookup by code is that row.
        "",
        entries.map(({ index, mapping }, k) =>
          node(
            toPointer(["responseMappings", index]),
            t("admin.cards.cardRow", { n: k + 1, name: cardName(mapping) }),
            str(mapping.id),
          ),
        ),
        true,
      ),
    );
    if ("keywords" in doc) {
      // The row also counts the issues of the severity styles it edits (contrast, Task 11).
      const row = node("/keywords", t("admin.cards.keywordsRow"), "keywords");
      const styles = under("/keywordSeverityStyles");
      cards.push({
        ...row,
        errors: row.errors + styles.errors,
        warnings: row.warnings + styles.warnings,
      });
    }
    // Every top-level key by its plain name, the key in mono beside it (design lead 09-29-26).
    const site = Object.keys(doc)
      .filter((k) => !CARD_KEYS.has(k) && !HIDDEN_KEYS.has(k))
      .map((k) => node(toPointer([k]), name(k), k));
    site.push(node(LABELS_ITEM, name(LABELS_ITEM), ""));
    // Mock responses (CFG-2): coverage first, then each mock source with its responses.
    const parsed = mock === null ? null : parseMock(mock);
    const mockNodes: TreeNode[] = [];
    if (parsed?.ok === true) {
      const labelKeys = new Map(asObjects(doc.sources).map((s) => [str(s.id), str(s.labelKey)]));
      const typeKeys = new Map(
        asObjects(doc.queryTypes).map((q) => [str(q.code), str(q.labelKey)]),
      );
      mockNodes.push(node(mockPointer.coverage, t("admin.mock.coverage.label"), ""));
      const ids = [
        ...[...labelKeys.keys()].filter((id) => id in parsed.mock.sources),
        ...Object.keys(parsed.mock.sources).filter((id) => !labelKeys.has(id)),
      ];
      for (const id of ids) {
        const source = parsed.mock.sources[id];
        if (source === undefined) continue;
        const sourceName = labelText(labelKeys.get(id)) || id;
        const responses = source.responses.map((r, i) =>
          node(
            mockPointer.response(id, i),
            // Named with a "Mock response:" prefix and its source: the query type's own row is
            // "<type> <code>", and rows that share a name cannot be told apart by a lookup by name.
            t("admin.mock.responseRow", {
              type: labelText(typeKeys.get(r.queryType)) || r.queryType,
              source: sourceName,
            }),
            r.types === undefined
              ? r.queryType
              : `${r.queryType} ${Object.values(r.types).join(" ")}`,
            [],
            false,
            "",
            labelText(typeKeys.get(r.queryType)) || r.queryType,
          ),
        );
        // The last child opens the source's add form (#572): one press from the tree.
        responses.push(
          node(
            mockPointer.addResponse(id),
            t("admin.mock.addResponseRow", { source: sourceName }),
            "",
            [],
            false,
            "",
            t("admin.mock.addResponseShort"),
          ),
        );
        mockNodes.push(
          // Not rolled up: the source's pointer already covers every issue under its responses.
          node(
            mockPointer.source(id),
            t("admin.mock.sourceRow", { source: sourceName }),
            id,
            responses,
            false,
            "",
            sourceName,
          ),
        );
      }
    }
    return { types, cards, site, mock: mockNodes };
  }, [doc, mock, issues, name, t, labelText, cardName]);
}

/**
 * Top-level keys the Site group leaves to other groups (query types, Result cards). The keyword
 * styles are edited with the keywords (Task 11, #604), so they have no row of their own.
 */
const CARD_KEYS: ReadonlySet<string> = new Set([
  "queryTypes",
  "responseMappings",
  "keywords",
  "keywordSeverityStyles",
]);

/** A row's text as the editor shows it: the draft's text, else the shipped one, else the key. */
type LabelText = (node: { label: string; labelKey?: string }) => string;

function useLabelResolver(): LabelText {
  const translator = useTranslator();
  const { labels } = useDraft();
  return useCallback(
    (node) => {
      const k = node.labelKey ?? "";
      if (k === "") return node.label;
      const text = labels[translator.locale]?.[k] ?? (translator.has(k) ? translator.t(k) : "");
      return text === "" ? node.label : text;
    },
    [labels, translator],
  );
}

/**
 * One row's label. It follows its own key in the draft store, so a keystroke in one label
 * re-renders the rows that show it and no others: the memoized rows around it stay as they are.
 */
function TreeLabel({
  node,
}: {
  node: { label: string; labelKey?: string; key?: string; short?: string };
}) {
  count("labels");
  const translator = useTranslator();
  const store = configDraftStore(useServices());
  const key = node.labelKey ?? "";
  const draftText = useSyncExternalStore(store.subscribe, () =>
    key === "" ? undefined : store.getState().labels[translator.locale]?.[key],
  );
  const text = draftText ?? (key !== "" && translator.has(key) ? translator.t(key) : "");
  const shown = text === "" ? node.label : text;
  // A short name is what the row shows; the full label is still its name for a screen reader.
  const short = text === "" ? node.short : undefined;
  return (
    <>
      {short === undefined ? (
        <span className="qm-tree__label">{shown}</span>
      ) : (
        <>
          <VisuallyHidden>{shown}</VisuallyHidden>
          <span className="qm-tree__label" aria-hidden="true">
            {short}
          </span>
        </>
      )}
      {node.key !== undefined && node.key !== shown && (
        <>
          {" "}
          <span className="qm-tree__key" title={node.key}>
            {node.key}
          </span>
        </>
      )}
    </>
  );
}

/** Keeps nodes whose label or key contains `q`, with their ancestors; a match keeps its children. */
function filterNodes(nodes: TreeNode[], q: string, text: LabelText): TreeNode[] {
  if (q === "") return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    const hit = `${text(n)} ${n.key ?? ""}`.toLowerCase().includes(q);
    if (hit) out.push(n);
    else {
      const children = filterNodes(n.children, q, text);
      if (children.length > 0) out.push({ ...n, children });
    }
  }
  return out;
}

/** A top-level group of the tree: its header is a disclosure, its rows are one tree. */
interface TreeGroup {
  id: string;
  title: string;
  nodes: TreeNode[];
  /** Rows at the top of this group can close too (query types). */
  typed: boolean;
  /** The group's rows are on screen. */
  open: boolean;
}

const GROUP_PREFIX = "group:";
/** The pointer of a group's header in the keyboard's list of rows. No JSON pointer starts so. */
const groupPointer = (id: string) => `${GROUP_PREFIX}${id}`;
const isGroupPointer = (pointer: string) => pointer.startsWith(GROUP_PREFIX);

/**
 * The rows on screen, in reading order, as the keyboard sees them: each group's header, then, when
 * the group is open, its rows. A row's children are on screen when it is a section or field's
 * parent that is not collapsible, or an open query type.
 */
function flattenVisible(
  groups: readonly TreeGroup[],
  expanded: ReadonlySet<string>,
  searching: boolean,
  text: LabelText,
) {
  const out: FlatItem[] = [];
  const walk = (
    list: TreeNode[],
    level: number,
    parent: string | null,
    group: number,
    typed: boolean,
  ) => {
    for (const n of list) {
      const topTyped = level === 1 && typed;
      const collapsible = topTyped && !searching && n.children.length > 0;
      const open = n.children.length > 0 && (!topTyped || expanded.has(n.pointer));
      out.push({
        pointer: n.pointer,
        label: text(n),
        level,
        parent,
        hasChildren: n.children.length > 0,
        expanded: open,
        collapsible,
        group,
      });
      if (open) walk(n.children, level + 1, n.pointer, group, typed);
    }
  };
  groups.forEach((g, i) => {
    const pointer = groupPointer(g.id);
    out.push({
      pointer,
      label: g.title,
      level: 0,
      parent: null,
      hasChildren: true,
      expanded: g.open,
      collapsible: !searching,
      group: i,
    });
    if (g.open) walk(g.nodes, 1, pointer, i, g.typed);
  });
  return out;
}

/** A DOM id for a pointer: pointers hold "/" and may hold spaces, which ids and idrefs cannot. */
// Every character but a letter or digit is escaped ("-" and "_" too), so the "-name" and "-group"
// suffixes cannot appear in an escaped pointer and two rows never share an id.
const treeId = (uid: string, pointer: string) =>
  `${uid}-${pointer.replace(/[^A-Za-z0-9]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;

/**
 * The builder tree (A-D1 A2, design target; B1: WAI-ARIA tree pattern): query types with their
 * sections and fields, then the site items, as two trees sharing one Tab stop (roving tabindex).
 * Arrows move focus, Right and Left open, close and step in and out, Home and End go to the ends
 * of a tree, a letter jumps to the next row starting with it, Enter and Space select what the
 * editor shows. Focus stays in the tree so a keyboard user can keep browsing (design lead
 * 09-29-26). Only the selected query type is open unless the user opens another. Search filters on
 * label and key.
 */
export function BuilderTree({
  doc,
  mock,
  selected,
  onSelect,
}: {
  doc: JsonObject;
  /** The draft's mock responses (CFG-2), or null when the site has none. */
  mock: JsonObject | null;
  selected: string | null;
  onSelect(pointer: string): void;
}) {
  const t = useT();
  const uid = useId();
  const { types, cards, site, mock: mockRows } = useTreeNodes(doc, mock);
  const text = useLabelResolver();
  // Whole-config issues have no row of their own: one line lists them, so the rows add up to the
  // toolbar total (critic I1).
  const { issues } = useContext(ChecksContext);
  const root = issues.filter((i) => isRootIssue(doc, i.pointer));
  const rootErrors = root.filter((i) => i.level === "error").length;
  const rootWarnings = root.length - rootErrors;
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const q = query.trim().toLowerCase();
  // Without a search these are the nodes themselves, so the memoized rows see the same arrays.
  const shownTypes = useMemo(() => filterNodes(types, q, text), [types, q, text]);
  const shownCards = useMemo(() => filterNodes(cards, q, text), [cards, q, text]);
  const shownSite = useMemo(() => filterNodes(site, q, text), [site, q, text]);
  const shownMock = useMemo(() => filterNodes(mockRows, q, text), [mockRows, q, text]);
  // Only the selected type is expanded unless the user toggles one; a search shows every match.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  // A selection can be deeper than any row (a control inside a field), so a row holds it when its
  // pointer is the selection or a prefix of it.
  const holds = (list: TreeNode[], pointer: string): boolean =>
    list.some(
      (n) =>
        n.pointer === pointer || pointer.startsWith(`${n.pointer}/`) || holds(n.children, pointer),
    );
  // The top row of a typed group (a query type, a type's cards) that holds the selection.
  const selectedType =
    selected === null
      ? null
      : ([...types, ...cards].find((n) => n.children.length > 0 && holds([n], selected))?.pointer ??
        null);
  const expanded = new Set(
    [...shownTypes, ...shownCards]
      .map((n) => n.pointer)
      .filter((p) => q !== "" || (toggled.get(p) ?? p === selectedType)),
  );
  // A changed type count shifts pointers, so the user's toggles no longer name the same types; a
  // new selection always opens its type (critic m5).
  const typeCount = types.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the type count changes
  useEffect(() => setToggled(new Map()), [typeCount]);
  useEffect(() => {
    if (selectedType !== null)
      setToggled((m) => {
        if (!m.has(selectedType)) return m;
        const next = new Map(m);
        next.delete(selectedType);
        return next;
      });
  }, [selectedType]);
  const onToggle = useCallback(
    (pointer: string, open: boolean) => setToggled((m) => new Map(m).set(pointer, open)),
    [],
  );

  // Which top-level groups the admin has closed: kept for the session, in memory only (#586). A
  // search shows every match, so it holds every group open. A fourth group is one more entry.
  const [closedGroups, setClosedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const groups: TreeGroup[] = [
    { id: "types", title: t("admin.tree.types"), nodes: shownTypes, typed: true },
    { id: "cards", title: t("admin.tree.cards"), nodes: shownCards, typed: true },
    { id: "site", title: t("admin.tree.site"), nodes: shownSite, typed: false },
    { id: "mock", title: t("admin.tree.mock"), nodes: shownMock, typed: false },
  ]
    .filter((g) => g.nodes.length > 0)
    .map((g) => ({ ...g, open: q !== "" || !closedGroups.has(g.id) }));
  const allGroups: [string, TreeNode[]][] = [
    ["types", types],
    ["cards", cards],
    ["site", site],
    ["mock", mockRows],
  ];
  const selectedGroup =
    selected === null ? null : (allGroups.find(([, list]) => holds(list, selected))?.[0] ?? null);
  // A selection inside a closed group opens it first, so focus never lands on a hidden row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection in a closed group reopens it
  useEffect(() => {
    if (selectedGroup === null) return;
    setClosedGroups((c) => {
      if (!c.has(selectedGroup)) return c;
      const next = new Set(c);
      next.delete(selectedGroup);
      return next;
    });
  }, [selectedGroup, selected]);
  const onToggleGroup = useCallback(
    (id: string, open: boolean) =>
      setClosedGroups((c) => {
        const next = new Set(c);
        if (open) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const toggleAny = useCallback(
    (pointer: string, open: boolean) =>
      isGroupPointer(pointer)
        ? onToggleGroup(pointer.slice(GROUP_PREFIX.length), open)
        : onToggle(pointer, open),
    [onToggle, onToggleGroup],
  );

  // Keyboard: one Tab stop for both trees, so Tab comes back to the selected row (APG single-select
  // tree); when a search hides it, the row last focused, else the first. The rows on screen are
  // what the keys walk.
  const flat = flattenVisible(groups, expanded, q !== "", text);
  const flatRef = useRef(flat);
  flatRef.current = flat;
  const [active, setActive] = useState<string | null>(null);
  const has = (p: string | null): p is string => p !== null && flat.some((x) => x.pointer === p);
  // A selection deeper than any row (an issue's pointer inside a scenario) keeps the Tab stop on
  // the deepest row on screen that holds it, not the first row (#572).
  const holder =
    selected === null
      ? null
      : (flat
          .filter((x) => x.pointer === selected || selected.startsWith(`${x.pointer}/`))
          .sort((a, b) => b.pointer.length - a.pointer.length)[0]?.pointer ?? null);
  const tabStop = has(selected)
    ? selected
    : holder !== null
      ? holder
      : has(active)
        ? active
        : (flat[0]?.pointer ?? null);
  // The row that has focus, so focus lost with its row (a type closing when another opens) can be
  // repaired: never moved otherwise.
  const focused = useRef<string | null>(null);
  const focus = useCallback((pointer: string) => {
    navRef.current?.querySelector<HTMLElement>(`[data-pointer="${CSS.escape(pointer)}"]`)?.focus();
  }, []);
  const onItemFocus = useCallback((pointer: string) => {
    focused.current = pointer;
    setActive(pointer);
  }, []);
  const onItemBlur = useCallback((e: FocusEvent<HTMLElement>) => {
    // A row that is gone fires no blur that matters: only a row that is still there and lost focus
    // means the user left the tree.
    if (e.currentTarget.isConnected) focused.current = null;
  }, []);
  const onItemKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, pointer: string) => {
      if (e.target !== e.currentTarget) return;
      const items = flatRef.current;
      if (isTypeAheadKey(e)) {
        const next = typeAhead(items, pointer, e.key);
        if (next !== null) {
          e.preventDefault();
          focus(next);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const action = treeAction(items, pointer, e.key);
      if (action.kind === "none") return;
      // Enter and Space on a group header are the button's own click: leave them to it.
      if (action.kind === "select" && isGroupPointer(action.pointer)) return;
      e.preventDefault();
      if (action.kind === "focus") focus(action.pointer);
      else if (action.kind === "expand") toggleAny(action.pointer, true);
      else if (action.kind === "collapse") toggleAny(action.pointer, false);
      else onSelect(action.pointer);
    },
    [focus, onSelect, toggleAny],
  );
  const previous = useRef<readonly FlatItem[]>(flat);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = flat;
    const at = focused.current;
    if (at === null || has(at)) return;
    const el = document.activeElement;
    if (el !== null && el !== document.body) return;
    // Focus was on a row that is gone: its nearest ancestor still there, else the row that took its
    // place in its own tree, else the one before it (the last row went), never the top of the tree.
    // A group's header is not an ancestor to fall back to: the row before it is nearer.
    const parentOf = (p: string) => {
      const parent = before.find((x) => x.pointer === p)?.parent ?? null;
      return parent !== null && isGroupPointer(parent) ? null : parent;
    };
    let next: string | null = parentOf(at);
    while (next !== null && !has(next)) next = parentOf(next);
    const index = Math.max(
      before.findIndex((x) => x.pointer === at),
      0,
    );
    const group = before[index]?.group;
    const same = flat[index]?.group === group ? flat[index] : undefined;
    const target = next ?? (same ?? flat[index - 1] ?? flat[0])?.pointer ?? null;
    if (target !== null) focus(target);
  });
  return (
    <nav ref={navRef} className="qm-tree" aria-label={t("admin.tree.label")}>
      <input
        ref={searchRef}
        type="search"
        className="qm-field__input"
        aria-label={t("admin.tree.search")}
        placeholder={t("admin.tree.search")}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      {root.length > 0 && (
        <p className="qm-tree__root">
          {t("admin.tree.root")}
          <span
            className={`qm-tree__issues qm-badge ${rootErrors > 0 ? "qm-badge--critical" : "qm-badge--warning"}`}
            aria-hidden="true"
          >
            {root.length}
          </span>
          <VisuallyHidden>, {issueWords(t, rootErrors, rootWarnings)}</VisuallyHidden>
        </p>
      )}
      {shownTypes.length === 0 &&
      shownCards.length === 0 &&
      shownSite.length === 0 &&
      shownMock.length === 0 ? (
        <div className="qm-tree__empty">
          <p>{t("admin.tree.noMatches", { text: query.trim() })}</p>
          <button
            type="button"
            className="qm-button qm-button--ghost"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
          >
            {t("admin.tree.clear")}
          </button>
        </div>
      ) : (
        groups.map((g) => {
          const gid = `${uid}-${g.id}`;
          const pointer = groupPointer(g.id);
          return (
            <Fragment key={g.id}>
              <p className="qm-tree__group" id={gid}>
                <button
                  type="button"
                  className="qm-tree__group-toggle"
                  data-pointer={pointer}
                  tabIndex={pointer === tabStop ? 0 : -1}
                  aria-expanded={g.open}
                  aria-controls={g.open ? `${gid}-tree` : undefined}
                  aria-disabled={q !== "" ? true : undefined}
                  onFocus={() => onItemFocus(pointer)}
                  onBlur={onItemBlur}
                  onKeyDown={(e) => onItemKeyDown(e, pointer)}
                  onClick={() => {
                    if (q === "") onToggleGroup(g.id, !g.open);
                  }}
                >
                  <span className="qm-tree__toggle" aria-hidden="true" data-open={g.open} />
                  {g.title}
                </button>
              </p>
              {g.open && (
                <TreeRows
                  uid={uid}
                  nodes={g.nodes}
                  selected={selected}
                  tabStop={tabStop}
                  onSelect={onSelect}
                  onItemFocus={onItemFocus}
                  onItemKeyDown={onItemKeyDown}
                  onItemBlur={onItemBlur}
                  labelledBy={gid}
                  listId={`${gid}-tree`}
                  {...(g.typed ? { expanded, collapsible: q === "", onToggle } : {})}
                />
              )}
              {g.open && g.id === "site" && (
                <p className="qm-tree__note">{t("admin.config.serverOnly")}</p>
              )}
            </Fragment>
          );
        })
      )}
    </nav>
  );
}

interface TreeRowsProps {
  uid: string;
  nodes: TreeNode[];
  selected: string | null;
  /** The one row in the Tab order (roving tabindex). */
  tabStop: string | null;
  onSelect(pointer: string): void;
  onItemFocus(pointer: string): void;
  onItemBlur(e: FocusEvent<HTMLElement>): void;
  onItemKeyDown(e: KeyboardEvent<HTMLElement>, pointer: string): void;
  labelledBy?: string;
  /** The id of the top-level list, for its group header's aria-controls. */
  listId?: string;
  /** Top-level rows that can close (query types): the open ones, whether they can, and the toggle. */
  expanded?: ReadonlySet<string>;
  collapsible?: boolean;
  onToggle?(pointer: string, open: boolean): void;
}

/**
 * The rows of one tree, memoized on their content: a keystroke in the editor rebuilds the nodes
 * but rarely changes them, and re-rendering every row per keystroke cost the editor tests about a
 * quarter of their time under load (A-D1 verify). Every prop a row reads is in the comparator.
 *
 * The markup is the APG navigation tree: ul[role=tree] > li[role=none] > div[role=treeitem] with
 * its children in a ul[role=group] it owns. A row is named by its own text alone (aria-labelledby),
 * not by the rows under it. The +/- mark is decorative; a mouse click on it opens or closes.
 */
const TreeRows = memo(
  function TreeRows({
    uid,
    nodes,
    selected,
    tabStop,
    onSelect,
    onItemFocus,
    onItemBlur,
    onItemKeyDown,
    labelledBy,
    listId,
    expanded,
    collapsible = false,
    onToggle,
  }: TreeRowsProps) {
    const t = useT();
    count("rows");
    const renderNodes = (list: TreeNode[], level: number, by?: string, gid?: string) => {
      const top = level === 1 && expanded !== undefined;
      return (
        <ul
          role={level === 1 ? "tree" : "group"}
          id={level === 1 ? listId : gid}
          aria-labelledby={by}
        >
          {list.map((n) => {
            const id = treeId(uid, n.pointer);
            const open = n.children.length > 0 && (!top || expanded.has(n.pointer));
            const groupId = `${id}-group`;
            return (
              <li key={n.pointer} role="none">
                <div
                  role="treeitem"
                  id={id}
                  data-pointer={n.pointer}
                  tabIndex={n.pointer === tabStop ? 0 : -1}
                  aria-level={level}
                  aria-selected={n.pointer === selected}
                  aria-expanded={n.children.length > 0 ? open : undefined}
                  aria-owns={open ? groupId : undefined}
                  aria-labelledby={`${id}-name`}
                  className="qm-tree__row"
                  onFocus={() => onItemFocus(n.pointer)}
                  onBlur={onItemBlur}
                  onKeyDown={(e) => onItemKeyDown(e, n.pointer)}
                  onClick={(e) => {
                    if (top && collapsible && (e.target as HTMLElement).closest(".qm-tree__toggle"))
                      onToggle?.(n.pointer, !open);
                    else onSelect(n.pointer);
                  }}
                >
                  {top && n.children.length > 0 && (
                    <span className="qm-tree__toggle" aria-hidden="true" data-open={open} />
                  )}
                  <span id={`${id}-name`} className="qm-tree__name">
                    <TreeLabel node={n} />
                    {n.errors + n.warnings > 0 && (
                      <>
                        <span
                          className={`qm-tree__issues qm-badge ${n.errors > 0 ? "qm-badge--critical" : "qm-badge--warning"}`}
                          aria-hidden="true"
                        >
                          {n.errors + n.warnings}
                        </span>
                        <VisuallyHidden>, {issueWords(t, n.errors, n.warnings)}</VisuallyHidden>
                      </>
                    )}
                  </span>
                </div>
                {open && renderNodes(n.children, level + 1, undefined, groupId)}
              </li>
            );
          })}
        </ul>
      );
    };
    return renderNodes(nodes, 1, labelledBy);
  },
  (a, b) =>
    a.uid === b.uid &&
    a.selected === b.selected &&
    a.tabStop === b.tabStop &&
    a.collapsible === b.collapsible &&
    a.onSelect === b.onSelect &&
    a.onItemFocus === b.onItemFocus &&
    a.onItemBlur === b.onItemBlur &&
    a.onItemKeyDown === b.onItemKeyDown &&
    a.labelledBy === b.labelledBy &&
    a.listId === b.listId &&
    a.onToggle === b.onToggle &&
    [...(a.expanded ?? [])].join() === [...(b.expanded ?? [])].join() &&
    JSON.stringify(a.nodes) === JSON.stringify(b.nodes),
);
