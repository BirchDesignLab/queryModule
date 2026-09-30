import { VisuallyHidden } from "@querymodule/web-ui";
import {
  type FocusEvent,
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
} from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { ChecksContext } from "./checks.js";
import { asObjects, str } from "./controls.js";
import { type JsonObject, toPointer } from "./draft.js";
import { useItemName } from "./FormTab.js";
import { HIDDEN_KEYS, isRootIssue, issueWords, LABELS_ITEM } from "./selection.js";
import { type FlatItem, isTypeAheadKey, treeAction, typeAhead } from "./tree-nav.js";

/** One row of the builder tree: a treeitem that selects `pointer`, and its children. */
interface TreeNode {
  pointer: string;
  /** Shown text: the label users see, or the key when there is none. */
  label: string;
  /** The config key or code beside it, in mono; omitted when it equals the label. */
  key?: string;
  children: TreeNode[];
  errors: number;
  warnings: number;
}

function useTreeNodes(doc: JsonObject): { types: TreeNode[]; site: TreeNode[] } {
  const translator = useTranslator();
  const name = useItemName();
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
    const label = (labelKey: unknown, fallback: string) => {
      const k = str(labelKey);
      return k !== "" && translator.has(k) ? translator.t(k) : fallback;
    };
    const node = (
      pointer: string,
      text: string,
      key: string,
      children: TreeNode[] = [],
      rollUp = false,
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
        ...(key !== "" && key !== text ? { key } : {}),
        children,
        ...counts,
      };
    };
    const types = asObjects(doc.queryTypes).map((type, i) => {
      const code = str(type.code);
      const fields = asObjects(type.fields).map((f, j) => ({ f, j }));
      const sections = asObjects(type.sections);
      const fieldNode = ({ f, j }: { f: JsonObject; j: number }) =>
        node(toPointer(["queryTypes", i, "fields", j]), label(f.labelKey, str(f.key)), str(f.key));
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
                label(section.labelKey, key),
                key,
                own.map(fieldNode),
                true,
              );
            });
      return node(toPointer(["queryTypes", i]), label(type.labelKey, code), code, children);
    });
    // Every top-level key by its plain name, the key in mono beside it (design lead 09-29-26).
    const site = Object.keys(doc)
      .filter((k) => k !== "queryTypes" && !HIDDEN_KEYS.has(k))
      .map((k) => node(toPointer([k]), name(k), k));
    site.push(node(LABELS_ITEM, name(LABELS_ITEM), ""));
    return { types, site };
  }, [doc, issues, name, translator]);
}

/** Keeps nodes whose label or key contains `q`, with their ancestors; a match keeps its children. */
function filterNodes(nodes: TreeNode[], q: string): TreeNode[] {
  if (q === "") return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    const hit = `${n.label} ${n.key ?? ""}`.toLowerCase().includes(q);
    if (hit) out.push(n);
    else {
      const children = filterNodes(n.children, q);
      if (children.length > 0) out.push({ ...n, children });
    }
  }
  return out;
}

/**
 * The rows on screen, in reading order, as the keyboard sees them. A row's children are on screen
 * when it is a section or field's parent that is not collapsible, or an open query type.
 */
function flattenVisible(
  groups: readonly TreeNode[][],
  expanded: ReadonlySet<string>,
  searching: boolean,
) {
  const out: FlatItem[] = [];
  const walk = (list: TreeNode[], level: number, parent: string | null, group: number) => {
    for (const n of list) {
      const collapsible = level === 1 && group === 0 && !searching && n.children.length > 0;
      const open =
        n.children.length > 0 && (!(level === 1 && group === 0) || expanded.has(n.pointer));
      out.push({
        pointer: n.pointer,
        label: n.label,
        level,
        parent,
        hasChildren: n.children.length > 0,
        expanded: open,
        collapsible,
        group,
      });
      if (open) walk(n.children, level + 1, n.pointer, group);
    }
  };
  groups.forEach((g, i) => {
    walk(g, 1, null, i);
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
  selected,
  onSelect,
}: {
  doc: JsonObject;
  selected: string | null;
  onSelect(pointer: string): void;
}) {
  const t = useT();
  const uid = useId();
  const { types, site } = useTreeNodes(doc);
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
  const shownTypes = filterNodes(types, q);
  const shownSite = filterNodes(site, q);
  // Only the selected type is expanded unless the user toggles one; a search shows every match.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const selectedType =
    selected === null ? null : (/^\/queryTypes\/[0-9]+/.exec(selected)?.[0] ?? null);
  const expanded = new Set(
    shownTypes
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

  // Keyboard: one Tab stop for both trees, so Tab comes back to the selected row (APG single-select
  // tree); when a search hides it, the row last focused, else the first. The rows on screen are
  // what the keys walk.
  const flat = flattenVisible([shownTypes, shownSite], expanded, q !== "");
  const flatRef = useRef(flat);
  flatRef.current = flat;
  const [active, setActive] = useState<string | null>(null);
  const has = (p: string | null): p is string => p !== null && flat.some((x) => x.pointer === p);
  const tabStop = has(selected) ? selected : has(active) ? active : (flat[0]?.pointer ?? null);
  // The row that has focus, so focus lost with its row (a type closing when another opens) can be
  // repaired: never moved otherwise.
  const focused = useRef<string | null>(null);
  const focus = useCallback((pointer: string) => {
    navRef.current
      ?.querySelector<HTMLElement>(`[role="treeitem"][data-pointer="${CSS.escape(pointer)}"]`)
      ?.focus();
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
      e.preventDefault();
      if (action.kind === "focus") focus(action.pointer);
      else if (action.kind === "expand") onToggle(action.pointer, true);
      else if (action.kind === "collapse") onToggle(action.pointer, false);
      else onSelect(action.pointer);
    },
    [focus, onSelect, onToggle],
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
    let next: string | null = before.find((x) => x.pointer === at)?.parent ?? null;
    while (next !== null && !has(next))
      next = before.find((x) => x.pointer === next)?.parent ?? null;
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
      {shownTypes.length === 0 && shownSite.length === 0 ? (
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
        <>
          {shownTypes.length > 0 && (
            <>
              <p className="qm-tree__group" id={`${uid}-types`}>
                {t("admin.tree.types")}
              </p>
              <TreeRows
                uid={uid}
                nodes={shownTypes}
                selected={selected}
                tabStop={tabStop}
                onSelect={onSelect}
                onItemFocus={onItemFocus}
                onItemKeyDown={onItemKeyDown}
                onItemBlur={onItemBlur}
                labelledBy={`${uid}-types`}
                expanded={expanded}
                collapsible={q === ""}
                onToggle={onToggle}
              />
            </>
          )}
          {shownSite.length > 0 && (
            <>
              <p className="qm-tree__group" id={`${uid}-site`}>
                {t("admin.tree.site")}
              </p>
              <TreeRows
                uid={uid}
                nodes={shownSite}
                selected={selected}
                tabStop={tabStop}
                onSelect={onSelect}
                onItemFocus={onItemFocus}
                onItemKeyDown={onItemKeyDown}
                onItemBlur={onItemBlur}
                labelledBy={`${uid}-site`}
              />
              <p className="qm-tree__note">{t("admin.config.serverOnly")}</p>
            </>
          )}
        </>
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
    expanded,
    collapsible = false,
    onToggle,
  }: TreeRowsProps) {
    const t = useT();
    const renderNodes = (list: TreeNode[], level: number, by?: string, gid?: string) => {
      const top = level === 1 && expanded !== undefined;
      return (
        <ul role={level === 1 ? "tree" : "group"} id={gid} aria-labelledby={by}>
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
                    <span className="qm-tree__label">{n.label}</span>
                    {n.key !== undefined && (
                      <>
                        {" "}
                        <span className="qm-tree__key">{n.key}</span>
                      </>
                    )}
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
    a.onToggle === b.onToggle &&
    [...(a.expanded ?? [])].join() === [...(b.expanded ?? [])].join() &&
    JSON.stringify(a.nodes) === JSON.stringify(b.nodes),
);
