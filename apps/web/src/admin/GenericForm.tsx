import { VisuallyHidden, visuallyHiddenStyle } from "@querymodule/web-ui";
import { useContext, useEffect, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { ChecksContext, IssueMessages, isError, issuesFor } from "./checks.js";
import { controlId, humanize, NumberControl, useDraftSetters } from "./controls.js";
import type { PathSegment, SetPathOptions } from "./draft.js";
import { issueWords } from "./selection.js";

interface NodeEditorProps {
  value: unknown;
  path: readonly PathSegment[];
  idPrefix: string;
  onChange(path: readonly PathSegment[], value: unknown, options?: SetPathOptions): void;
}

const pathText = (path: readonly PathSegment[]): string => path.join(".");

/**
 * A setting's name in words ("Max duration minutes"). Its config path is not in the name (B1): it
 * is a hidden description of the control (PathHint), and legends keep names unique.
 */
function SettingName({ path }: { path: readonly PathSegment[] }) {
  const t = useT();
  const last = path[path.length - 1];
  return <>{last === undefined ? "" : humanize(last, (n) => t("admin.config.item", { n }))}</>;
}

// "_path" cannot end a control id: idSegment escapes every "_" as "_<hex>_", and "p" is not hex, so a
// setting whose key is "path" (a response mapping element) keeps its own id.
const pathHintId = (idPrefix: string, path: readonly PathSegment[]) =>
  `${controlId(idPrefix, path)}_path`;

/** "Setting: terminal.delimiter", visually hidden: the description a control points to. */
function PathHint({ idPrefix, path }: { idPrefix: string; path: readonly PathSegment[] }) {
  const t = useT();
  return (
    <span id={pathHintId(idPrefix, path)} style={visuallyHiddenStyle}>
      {t("admin.config.settingPath", { path: pathText(path) })}
    </span>
  );
}

const describe = (...ids: (string | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

/** Per-source timeoutMs is a server-side setting: shown in the client view, not editable here. */
const isServerSideLeaf = (path: readonly PathSegment[]): boolean =>
  path.length === 3 && path[0] === "sources" && path[2] === "timeoutMs";

type PendingFocus = { kind: "item"; index: number } | { kind: "add" };

/** Keys that name an item in its list (spec 4.1 overlay identities); a cloned item starts blank. */
const IDENTITY_KEYS = ["id", "code", "key", "keyword"] as const;

/** The next item for a list: a copy of the last one with its identity keys cleared (M5). */
function nextItem(last: unknown): unknown {
  const copy = structuredClone(last);
  if (typeof copy === "object" && copy !== null && !Array.isArray(copy)) {
    const obj = copy as Record<string, unknown>;
    for (const k of IDENTITY_KEYS) if (typeof obj[k] === "string") obj[k] = "";
  }
  return copy;
}

/** Array editor; keeps keyboard focus inside the list after an add or a remove (UX-004). */
function ArrayEditor({
  items,
  path,
  idPrefix,
  onChange,
}: Omit<NodeEditorProps, "value"> & { items: readonly unknown[] }) {
  const t = useT();
  const checks = useContext(ChecksContext);
  const issues = issuesFor(checks, path);
  const issuesId = `${controlId(idPrefix, path)}-issues`;
  const root = useRef<HTMLFieldSetElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLSpanElement>(null);
  const [want, setWant] = useState<PendingFocus | null>(null);
  const addReasonId = `${controlId(idPrefix, path)}-add-reason`;
  const empty = items.length === 0;
  useEffect(() => {
    if (want === null) return;
    setWant(null);
    if (want.kind === "item") {
      const item = root.current?.querySelector<HTMLElement>(
        `:scope > [data-item-path="${CSS.escape(pathText([...path, want.index]))}"]`,
      );
      const control = item?.querySelector<HTMLElement>("input, select, textarea, button");
      if (control !== undefined && control !== null) {
        control.focus();
        return;
      }
    }
    // An emptied list has no enabled Add; its reason text takes focus instead (M5).
    if (addRef.current?.disabled) reasonRef.current?.focus();
    else addRef.current?.focus();
  }, [want, path]);
  return (
    <fieldset
      ref={root}
      aria-describedby={describe(
        issues === undefined ? undefined : issuesId,
        pathHintId(idPrefix, path),
      )}
    >
      <legend>
        <SettingName path={path} />
      </legend>
      <PathHint idPrefix={idPrefix} path={path} />
      <IssueMessages id={issuesId} issues={issues} />
      {items.map((item, i) => {
        const itemPath = [...path, i];
        return (
          <div
            key={pathText(itemPath)}
            className="qm-admin__item"
            data-item-path={pathText(itemPath)}
          >
            <NodeEditor value={item} path={itemPath} idPrefix={idPrefix} onChange={onChange} />
            <button
              type="button"
              className="qm-button qm-button--danger"
              aria-label={`${t("admin.config.remove")} ${humanize(i, (n) => t("admin.config.item", { n }))}`}
              aria-describedby={pathHintId(idPrefix, itemPath)}
              onClick={() => {
                const next = items.filter((_, j) => j !== i);
                setWant(i < next.length ? { kind: "item", index: i } : { kind: "add" });
                onChange(path, next);
              }}
            >
              {t("admin.config.remove")}
            </button>
          </div>
        );
      })}
      <button
        ref={addRef}
        type="button"
        className="qm-button"
        disabled={empty}
        aria-describedby={describe(pathHintId(idPrefix, path), empty ? addReasonId : undefined)}
        onClick={() => {
          setWant({ kind: "item", index: items.length });
          onChange(path, [...items, nextItem(items[items.length - 1])]);
        }}
      >
        {t("admin.config.add")}
      </button>
      {empty && (
        <span ref={reasonRef} id={addReasonId} tabIndex={-1}>
          {" "}
          {t("admin.config.addInRaw")}
        </span>
      )}
    </fieldset>
  );
}

/** The generic schema-driven form: one control per JSON leaf, labelled with its path. */
export function NodeEditor({ value, path, idPrefix, onChange }: NodeEditorProps) {
  const t = useT();
  const id = controlId(idPrefix, path);
  const checks = useContext(ChecksContext);
  const issues = issuesFor(checks, path);
  const issuesId = `${id}-issues`;
  const invalid = isError(issues);
  const describedBy = describe(
    issues === undefined ? undefined : issuesId,
    pathHintId(idPrefix, path),
  );
  if (Array.isArray(value)) {
    return <ArrayEditor items={value} path={path} idPrefix={idPrefix} onChange={onChange} />;
  }
  if (typeof value === "object" && value !== null) {
    return (
      <fieldset aria-describedby={describedBy}>
        <legend>
          <SettingName path={path} />
        </legend>
        <PathHint idPrefix={idPrefix} path={path} />
        <IssueMessages id={issuesId} issues={issues} />
        {Object.entries(value as Record<string, unknown>).map(([key, child]) => (
          <NodeEditor
            key={key}
            value={child}
            path={[...path, key]}
            idPrefix={idPrefix}
            onChange={onChange}
          />
        ))}
      </fieldset>
    );
  }
  if (typeof value === "boolean") {
    return (
      <div>
        <input
          id={id}
          type="checkbox"
          checked={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(e) => onChange(path, e.target.checked)}
        />{" "}
        <label htmlFor={id}>
          <SettingName path={path} />
        </label>
        <PathHint idPrefix={idPrefix} path={path} />
        <IssueMessages id={issuesId} issues={issues} />
      </div>
    );
  }
  if (typeof value === "number") {
    return (
      <NumberControl
        idPrefix={idPrefix}
        path={path}
        label={<SettingName path={path} />}
        hint={t("admin.config.settingPath", { path: pathText(path) })}
        hintId={pathHintId(idPrefix, path)}
        value={value}
        readOnly={isServerSideLeaf(path)}
        note={isServerSideLeaf(path) ? t("admin.config.serverSetting") : undefined}
        onChange={onChange}
      />
    );
  }
  return (
    <div>
      <label htmlFor={id}>
        <SettingName path={path} />
      </label>{" "}
      <PathHint idPrefix={idPrefix} path={path} />
      <input
        id={id}
        type="text"
        value={typeof value === "string" ? value : ""}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => onChange(path, e.target.value, { coalesce: true })}
      />
      <IssueMessages id={issuesId} issues={issues} />
    </div>
  );
}

/**
 * One top-level item in the editor (A-D1 A2): the tree selects it, so it renders open under a
 * heading with its plain name, its config key in mono and its issue count (design lead 09-29-26).
 */
export function EditorSection({
  pointer,
  label,
  configKey,
  crumb,
  countPointer = pointer,
  focusOwner,
  children,
}: {
  pointer: string;
  label: string;
  configKey?: string;
  /** Where the item sits, above its heading (A3): "Query types" or "Site". */
  crumb?: string;
  /** The item whose issues the heading counts; the section's own pointer by default. */
  countPointer?: string;
  /** Makes the heading focusable by a focus request (data-owner, role "heading"): a new item's heading. */
  focusOwner?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const checks = useContext(ChecksContext);
  let errors = 0;
  let warnings = 0;
  for (const i of checks.issues)
    if (i.pointer === countPointer || i.pointer.startsWith(`${countPointer}/`)) {
      if (i.level === "error") errors++;
      else warnings++;
    }
  return (
    <section className="qm-editor__section" data-path={pointer}>
      {crumb !== undefined && <p className="qm-editor__crumb">{crumb}</p>}
      <h3
        className="qm-editor__title"
        {...(focusOwner === undefined
          ? {}
          : { tabIndex: -1, "data-owner": focusOwner, "data-role": "heading" })}
      >
        {label}
        {configKey !== undefined && configKey !== label && (
          <>
            {" "}
            <span className="qm-tree__key">{configKey}</span>
          </>
        )}
        {errors + warnings > 0 && (
          <>
            <span
              className={`qm-badge ${errors > 0 ? "qm-badge--critical" : "qm-badge--warning"}`}
              aria-hidden="true"
            >
              {errors + warnings}
            </span>
            <VisuallyHidden>, {issueWords(t, errors, warnings)}</VisuallyHidden>
          </>
        )}
      </h3>
      {children}
    </section>
  );
}

/** The generic form for the keys an editor does not cover. */
export function OtherKeys({
  item,
  path,
  covered,
  idPrefix,
}: {
  item: Record<string, unknown>;
  path: readonly PathSegment[];
  covered: ReadonlySet<string>;
  idPrefix: string;
}) {
  const { setPath } = useDraftSetters();
  return (
    <>
      {Object.entries(item)
        .filter(([k]) => !covered.has(k))
        .map(([k, v]) => (
          <NodeEditor
            key={k}
            value={v}
            path={[...path, k]}
            idPrefix={idPrefix}
            onChange={setPath}
          />
        ))}
    </>
  );
}
