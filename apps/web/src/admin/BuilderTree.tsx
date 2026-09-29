import { VisuallyHidden } from "@querymodule/web-ui";
import { memo, useContext, useId, useMemo, useRef, useState } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { ChecksContext } from "./checks.js";
import { asObjects, str } from "./controls.js";
import { type JsonObject, toPointer } from "./draft.js";
import { issueWords, LABELS_ITEM } from "./selection.js";

/** One row of the builder tree: a button that selects `pointer`, and its children. */
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
    const site = Object.keys(doc)
      .filter((k) => k !== "queryTypes")
      .map((k) => {
        const name = SITE_NAMES[k];
        return node(toPointer([k]), name === undefined ? k : t(name), "");
      });
    site.push(node(LABELS_ITEM, t("admin.config.site.labels"), ""));
    return { types, site };
  }, [doc, issues, t, translator]);
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
              <TreeRows
                nodes={shownTypes}
                selected={selected}
                onSelect={onSelect}
                labelledBy={`${uid}-types`}
              />
            </>
          )}
          {shownSite.length > 0 && (
            <>
              <p className="qm-tree__group" id={`${uid}-site`}>
                {t("admin.tree.site")}
              </p>
              <TreeRows
                nodes={shownSite}
                selected={selected}
                onSelect={onSelect}
                labelledBy={`${uid}-site`}
              />
            </>
          )}
        </>
      )}
    </nav>
  );
}

interface TreeRowsProps {
  nodes: TreeNode[];
  selected: string | null;
  onSelect(pointer: string): void;
  labelledBy?: string;
}

/**
 * The rows, memoized on their content: a keystroke in the editor rebuilds the nodes but rarely
 * changes them, and re-rendering every row per keystroke cost the editor tests about a quarter
 * of their time under load (A-D1 verify).
 */
const TreeRows = memo(
  function TreeRows({ nodes, selected, onSelect, labelledBy }: TreeRowsProps) {
    const t = useT();
    const renderNodes = (list: TreeNode[], by?: string) => (
      <ul aria-labelledby={by}>
        {list.map((n) => (
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
            </button>
            {n.children.length > 0 && renderNodes(n.children)}
          </li>
        ))}
      </ul>
    );
    return renderNodes(nodes, labelledBy);
  },
  (a, b) =>
    a.selected === b.selected &&
    a.onSelect === b.onSelect &&
    a.labelledBy === b.labelledBy &&
    JSON.stringify(a.nodes) === JSON.stringify(b.nodes),
);
