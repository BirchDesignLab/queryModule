import { useContext, useEffect, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { ChecksContext, IssueMessages, isError, issuesFor } from "./checks.js";
import { type PathSegment, toPointer } from "./draft.js";

interface NodeEditorProps {
  value: unknown;
  path: readonly PathSegment[];
  idPrefix: string;
  onChange(path: readonly PathSegment[], value: unknown): void;
}

const pathText = (path: readonly PathSegment[]): string => path.join(".");

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
  const text = pathText(path);
  const checks = useContext(ChecksContext);
  const issues = issuesFor(checks, path);
  const issuesId = `${idPrefix}-${text}-issues`;
  const root = useRef<HTMLFieldSetElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLSpanElement>(null);
  const [want, setWant] = useState<PendingFocus | null>(null);
  const addReasonId = `${idPrefix}-${text}-add-reason`;
  const empty = items.length === 0;
  useEffect(() => {
    if (want === null) return;
    setWant(null);
    if (want.kind === "item") {
      const item = root.current?.querySelector<HTMLElement>(
        `:scope > [data-item-path="${pathText([...path, want.index])}"]`,
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
    <fieldset ref={root} aria-describedby={issues === undefined ? undefined : issuesId}>
      <legend>{text}</legend>
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
              className="qm-button"
              aria-label={`${t("admin.config.remove")} ${pathText(itemPath)}`}
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
        aria-label={`${t("admin.config.add")} ${text}`}
        disabled={empty}
        aria-describedby={empty ? addReasonId : undefined}
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
  const text = pathText(path);
  const id = `${idPrefix}-${text}`;
  const checks = useContext(ChecksContext);
  const issues = issuesFor(checks, path);
  const issuesId = `${id}-issues`;
  const invalid = isError(issues);
  const describedBy = issues === undefined ? undefined : issuesId;
  if (Array.isArray(value)) {
    return <ArrayEditor items={value} path={path} idPrefix={idPrefix} onChange={onChange} />;
  }
  if (typeof value === "object" && value !== null) {
    return (
      <fieldset aria-describedby={describedBy}>
        <legend>{text}</legend>
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
        <label htmlFor={id}>{text}</label>
        <IssueMessages id={issuesId} issues={issues} />
      </div>
    );
  }
  if (typeof value === "number") {
    return (
      <NumberEditor
        id={id}
        label={text}
        value={value}
        readOnly={isServerSideLeaf(path)}
        invalid={invalid}
        describedBy={describedBy}
        onValue={(n) => onChange(path, n)}
      >
        <IssueMessages id={issuesId} issues={issues} />
      </NumberEditor>
    );
  }
  return (
    <div>
      <label htmlFor={id}>{text}</label>{" "}
      <input
        id={id}
        type="text"
        value={typeof value === "string" ? value : ""}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => onChange(path, e.target.value)}
      />
      <IssueMessages id={issuesId} issues={issues} />
    </div>
  );
}

/** A number control that keeps partial text ("", "-") until it parses (M1). */
function NumberEditor({
  id,
  label,
  value,
  readOnly,
  invalid,
  describedBy,
  onValue,
  children,
}: {
  id: string;
  label: string;
  value: number;
  readOnly: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onValue(n: number): void;
  children: React.ReactNode;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) =>
      Number(current) === value && current.trim() !== "" ? current : String(value),
    );
  }, [value]);
  return (
    <div>
      <label htmlFor={id}>{label}</label>{" "}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        readOnly={readOnly}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const n = Number(next);
          if (next.trim() !== "" && Number.isFinite(n)) onValue(n);
        }}
      />
      {children}
    </div>
  );
}

/** Sections open on demand, so a large config does not render every control at once. */
export function Section({ name, children }: { name: string; children: () => React.ReactNode }) {
  const t = useT();
  const checks = useContext(ChecksContext);
  const [open, setOpen] = useState(false);
  const prefix = toPointer([name]);
  const count = checks.issues.filter(
    (i) => i.pointer === prefix || i.pointer.startsWith(`${prefix}/`),
  ).length;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {name}
        {count > 0 && (
          <span className="qm-admin__count"> {t("admin.config.issueCount", { count })}</span>
        )}
      </summary>
      {open && children()}
    </details>
  );
}
