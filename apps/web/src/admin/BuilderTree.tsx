import { useId, useMemo, useRef, useState } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { asObjects, str } from "./controls.js";
import { type JsonObject, toPointer } from "./draft.js";
import { LABELS_ITEM } from "./selection.js";

/** One row of the builder tree: a button that selects `pointer`, and its children. */
interface TreeNode {
  pointer: string;
  /** Shown text: the label users see, or the key when there is none. */
  label: string;
  /** The config key or code beside it, in mono; omitted when it equals the label. */
  key?: string;
  children: TreeNode[];
}

/** Site items with a friendly name (design target); every other top-level key shows its key. */
const SITE_NAMES: Readonly<Record<string, string>> = {
  commands: "admin.config.site.commands",
  quickAccess: "admin.config.site.quickAccess",
  picklists: "admin.config.site.picklists",
  sources: "admin.config.site.sources",
  theme: "admin.config.site.theme",
};

function useTreeNodes(doc: JsonObject): { types: TreeNode[]; site: TreeNode[] } {
  const t = useT();
  const translator = useTranslator();
  return useMemo(() => {
    const label = (labelKey: unknown, fallback: string) => {
      const k = str(labelKey);
      return k !== "" && translator.has(k) ? translator.t(k) : fallback;
    };
    const node = (pointer: string, text: string, key: string, children: TreeNode[] = []) => ({
      pointer,
      label: text,
      ...(key !== "" && key !== text ? { key } : {}),
      children,
    });
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
              );
            });
      return node(toPointer(["queryTypes", i]), label(type.labelKey, code), code, children);
    });
    const site = Object.keys(doc)
      .filter((k) => k !== "queryTypes")
      .map((k) => {
        const name = SITE_NAMES[k];
        return node(toPointer([k]), name === undefined ? k : t(name), "");
      });
    site.push(node(LABELS_ITEM, t("admin.config.site.labels"), ""));
    return { types, site };
  }, [doc, t, translator]);
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
 * The builder tree (A-D1 A2, design target): query types with their sections and fields, then the
 * site items. A button selects what the editor shows and scrolls to; focus stays in the tree so a
 * keyboard user can keep browsing (design lead 09-29-26). Search filters on label and key.
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
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const shownTypes = filterNodes(types, q);
  const shownSite = filterNodes(site, q);
  const renderNodes = (nodes: TreeNode[]) => (
    <ul>
      {nodes.map((n) => (
        <li key={n.pointer}>
          <button
            type="button"
            aria-current={n.pointer === selected ? "true" : undefined}
            onClick={() => onSelect(n.pointer)}
          >
            <span className="qm-tree__label">{n.label}</span>
            {n.key !== undefined && (
              <>
                {" "}
                <span className="qm-tree__key">{n.key}</span>
              </>
            )}
          </button>
          {n.children.length > 0 && renderNodes(n.children)}
        </li>
      ))}
    </ul>
  );
  return (
    <nav className="qm-tree" aria-label={t("admin.tree.label")}>
      <input
        ref={searchRef}
        type="search"
        className="qm-field__input"
        aria-label={t("admin.tree.search")}
        placeholder={t("admin.tree.search")}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
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
              <div aria-labelledby={`${uid}-types`} role="group">
                {renderNodes(shownTypes)}
              </div>
            </>
          )}
          {shownSite.length > 0 && (
            <>
              <p className="qm-tree__group" id={`${uid}-site`}>
                {t("admin.tree.site")}
              </p>
              <div aria-labelledby={`${uid}-site`} role="group">
                {renderNodes(shownSite)}
              </div>
            </>
          )}
        </>
      )}
    </nav>
  );
}
