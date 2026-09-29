import { useCallback, useContext, useEffect, useState } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { configDraftStore, useDraft } from "./builder-store.js";
import { ChecksContext, IssueMessages, isError, issuesFor } from "./checks.js";
import { type PathSegment, toPointer } from "./draft.js";

/**
 * Controls shared by the purpose-built editors (Task 31 part 2, #355): each writes one draft path
 * and shows the diagnostics for that path at the control (aria-invalid, aria-describedby, UX-004).
 */

export type Obj = Record<string, unknown>;
export const asObjects = (v: unknown): Obj[] =>
  Array.isArray(v) ? v.filter((x): x is Obj => typeof x === "object" && x !== null) : [];
export const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** An id segment safe for any key: every character outside [A-Za-z0-9] is hex-escaped (#388 M10). */
const idSegment = (s: PathSegment): string =>
  String(s).replace(/[^A-Za-z0-9]/g, (c) => `_${(c.codePointAt(0) ?? 0).toString(16)}_`);

/** A DOM id for a draft path; distinct paths give distinct ids ("a.b" vs ["a", "b"]). */
export const controlId = (prefix: string, path: readonly PathSegment[]): string =>
  `${prefix}-${path.map(idSegment).join("-")}`;

/** The draft setters, bound to this app instance's store. */
export function useDraftSetters() {
  const store = configDraftStore(useServices());
  const setPath = useCallback(
    (path: readonly PathSegment[], value: unknown) => store.getState().setPath(path, value),
    [store],
  );
  const setLabel = useCallback(
    (locale: string, key: string, text: string) => store.getState().setLabel(locale, key, text),
    [store],
  );
  return { setPath, setLabel };
}

/** The draft's locales, or English when the draft names none. */
export function useDraftLocales(): string[] {
  const { doc } = useDraft();
  const locales = Array.isArray(doc?.locales)
    ? doc.locales.filter((l): l is string => typeof l === "string")
    : [];
  return locales.length > 0 ? locales : ["en"];
}

interface ControlProps {
  idPrefix: string;
  path: readonly PathSegment[];
  label: string;
}

/** Diagnostics for a path plus an optional local message (text that does not parse). */
function useControlIssues(idPrefix: string, path: readonly PathSegment[], local?: string) {
  const checks = useContext(ChecksContext);
  // A control also claims issues on its own key while the key is absent (grouping would move them
  // to the parent, which has no messages of its own in the purpose-built editors).
  const pointer = toPointer(path);
  const grouped = issuesFor(checks, path);
  const exact = checks.issues.filter((i) => i.pointer === pointer);
  const issues = grouped ?? (exact.length > 0 ? exact : undefined);
  const id = controlId(idPrefix, path);
  const issuesId = `${id}-issues`;
  const localId = `${id}-local`;
  const describedBy =
    [issues === undefined ? null : issuesId, local === undefined ? null : localId]
      .filter((x) => x !== null)
      .join(" ") || undefined;
  const messages = (
    <>
      <IssueMessages id={issuesId} issues={issues} />
      {local !== undefined && (
        <span id={localId} className="qm-admin__issue">
          {" "}
          {local}
        </span>
      )}
    </>
  );
  return { id, invalid: isError(issues) || local !== undefined, describedBy, messages };
}

/**
 * Issues grouped at an item's own pointer that none of its rendered controls claims (a missing
 * key, or a union error on the item itself). The fieldset links them by aria-describedby.
 */
export function useItemIssues(
  idPrefix: string,
  path: readonly PathSegment[],
  claimed: readonly string[],
) {
  const checks = useContext(ChecksContext);
  const own = new Set(claimed.map((k) => toPointer([...path, k])));
  const issues = issuesFor(checks, path)?.filter((i) => !own.has(i.pointer));
  const id = `${controlId(idPrefix, path)}-item-issues`;
  const shown = issues !== undefined && issues.length > 0 ? issues : undefined;
  return {
    describedBy: shown === undefined ? undefined : id,
    messages: <IssueMessages id={id} issues={shown} />,
  };
}

/**
 * A text control; with `optional`, blank text removes the key from the draft. With `owner`, it is
 * the item's first control, which takes focus when the item is added.
 */
export function TextControl({
  idPrefix,
  path,
  label,
  value,
  optional = false,
  owner,
}: ControlProps & { value: unknown; optional?: boolean; owner?: string }) {
  const { setPath } = useDraftSetters();
  const { id, invalid, describedBy, messages } = useControlIssues(idPrefix, path);
  return (
    <div>
      <label htmlFor={id}>{label}</label>{" "}
      <input
        id={id}
        type="text"
        data-owner={owner}
        data-role={owner === undefined ? undefined : "first"}
        value={typeof value === "string" ? value : ""}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) =>
          setPath(path, optional && e.target.value === "" ? undefined : e.target.value)
        }
      />
      {messages}
    </div>
  );
}

export function CheckControl({ idPrefix, path, label, value }: ControlProps & { value: unknown }) {
  const { setPath } = useDraftSetters();
  const { id, invalid, describedBy, messages } = useControlIssues(idPrefix, path);
  return (
    <div>
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => setPath(path, e.target.checked)}
      />{" "}
      <label htmlFor={id}>{label}</label>
      {messages}
    </div>
  );
}

/** A select over fixed options; `blank` adds an empty first option that removes the key. */
export function SelectControl({
  idPrefix,
  path,
  label,
  value,
  options,
  blank,
  onValue,
  optionLabel,
  owner,
}: ControlProps & {
  value: unknown;
  options: readonly string[];
  blank?: string;
  /** Visible text of an option; the option value itself by default. */
  optionLabel?(option: string): string;
  /** As for TextControl: the item's first control, focused when the item is added. */
  owner?: string;
  onValue?(value: string | undefined): void;
}) {
  const { setPath } = useDraftSetters();
  const { id, invalid, describedBy, messages } = useControlIssues(idPrefix, path);
  const current = typeof value === "string" ? value : "";
  // A value the options do not list (a stale reference) stays visible, so the diagnostic reads.
  const shown = current !== "" && !options.includes(current) ? [...options, current] : options;
  return (
    <div>
      <label htmlFor={id}>{label}</label>{" "}
      <select
        id={id}
        data-owner={owner}
        data-role={owner === undefined ? undefined : "first"}
        value={current}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => {
          const next = e.target.value === "" ? undefined : e.target.value;
          if (onValue !== undefined) onValue(next);
          else setPath(path, next);
        }}
      >
        {blank !== undefined && <option value="">{blank}</option>}
        {shown.map((o) => (
          <option key={o} value={o}>
            {optionLabel === undefined ? o : optionLabel(o)}
          </option>
        ))}
      </select>
      {messages}
    </div>
  );
}

/**
 * A number control that keeps partial text ("", "-") until it parses (M1). Text that is not a
 * number is flagged at the control and not written (#388). With `optional`, blank removes the key.
 */
export function NumberControl({
  idPrefix,
  path,
  label,
  value,
  optional = false,
  readOnly = false,
  note,
  onChange,
}: ControlProps & {
  value: unknown;
  optional?: boolean;
  readOnly?: boolean;
  note?: string;
  /** Writes the value; the draft store by default. */
  onChange?(path: readonly PathSegment[], value: unknown): void;
}) {
  const t = useT();
  const setters = useDraftSetters();
  const setPath = onChange ?? setters.setPath;
  const shownValue = typeof value === "number" ? String(value) : "";
  const [text, setText] = useState(shownValue);
  useEffect(() => {
    setText((current) =>
      current.trim() !== "" && Number(current) === value ? current : shownValue,
    );
  }, [value, shownValue]);
  const trimmed = text.trim();
  const bad = trimmed !== "" && trimmed !== "-" && !Number.isFinite(Number(trimmed));
  const { id, invalid, describedBy, messages } = useControlIssues(
    idPrefix,
    path,
    bad ? t("admin.config.notANumber") : undefined,
  );
  const noteId = `${id}-note`;
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
        aria-describedby={
          [describedBy, note === undefined ? undefined : noteId].filter(Boolean).join(" ") ||
          undefined
        }
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const n = Number(next);
          if (next.trim() === "") {
            if (optional) setPath(path, undefined);
          } else if (Number.isFinite(n)) setPath(path, n);
        }}
      />
      {note !== undefined && (
        <span id={noteId} className="qm-admin__note">
          {" "}
          {note}
        </span>
      )}
      {messages}
    </div>
  );
}

/** Label text for a label key, one input per draft locale, written to the draft's overlay. */
export function LabelTextControls({
  idPrefix,
  path,
  labelKey,
}: {
  idPrefix: string;
  /** The item that owns the label key; ids carry it, since items may share a key (critic I1). */
  path: readonly PathSegment[];
  labelKey: unknown;
}) {
  const t = useT();
  const translator = useTranslator();
  const { labels } = useDraft();
  const { setLabel } = useDraftSetters();
  const locales = useDraftLocales();
  const key = typeof labelKey === "string" ? labelKey : "";
  return (
    <>
      {locales.map((locale) => {
        const id = controlId(idPrefix, [...path, "labelText", locale]);
        const overlay = labels[locale]?.[key];
        const shipped =
          locale === translator.locale && translator.has(key) ? translator.t(key) : "";
        return (
          <div key={locale}>
            <label htmlFor={id}>{t("admin.config.labelText", { locale })}</label>{" "}
            <input
              id={id}
              type="text"
              value={overlay ?? shipped}
              disabled={key === ""}
              onChange={(e) => setLabel(locale, key, e.target.value)}
            />
          </div>
        );
      })}
    </>
  );
}

/**
 * Focus after a list edit (UX-004): a list asks for elements by owner and role, and the first one
 * found takes focus once the edit has rendered. Owners are `data-owner` values unique per list item.
 */
export function useFocusRequest() {
  const [want, setWant] = useState<readonly (readonly [string, string])[] | null>(null);
  useEffect(() => {
    if (want === null) return;
    setWant(null);
    for (const [owner, role] of want) {
      const el = document.querySelector<HTMLElement>(
        `[data-owner="${CSS.escape(owner)}"][data-role="${role}"]`,
      );
      if (el !== null && !(el as HTMLButtonElement).disabled) {
        el.focus();
        return;
      }
    }
  }, [want]);
  /** Candidates in order, as [owner, role]; the first one rendered and enabled takes focus. */
  return useCallback((...targets: (readonly [string, string])[]) => setWant(targets), []);
}

/** Move up, move down and remove buttons for one list item. */
export function ItemButtons({
  owner,
  name,
  index,
  count,
  removeLabel,
  onMove,
  onRemove,
  movable = true,
}: {
  owner: string;
  name: string;
  index: number;
  count: number;
  removeLabel: string;
  onMove?(from: number, to: number): void;
  onRemove(index: number): void;
  movable?: boolean;
}) {
  const t = useT();
  const suffix = name === "" ? "" : ` ${name}`;
  return (
    <div className="qm-admin__item-buttons">
      {movable && index > 0 && (
        <button
          type="button"
          className="qm-button"
          data-owner={owner}
          data-role="up"
          onClick={() => onMove?.(index, index - 1)}
        >
          {`${t("admin.config.moveUp")}${suffix}`}
        </button>
      )}{" "}
      {movable && index < count - 1 && (
        <button
          type="button"
          className="qm-button"
          data-owner={owner}
          data-role="down"
          onClick={() => onMove?.(index, index + 1)}
        >
          {`${t("admin.config.moveDown")}${suffix}`}
        </button>
      )}{" "}
      <button
        type="button"
        className="qm-button"
        data-owner={owner}
        data-role="remove"
        onClick={() => onRemove(index)}
      >
        {`${removeLabel}${suffix}`}
      </button>
    </div>
  );
}

/**
 * A list generation: bumped on every remove or move, and part of each item's React key, so
 * per-item local state (partial number text, open disclosures) never shifts to another item
 * (critic I2).
 */
export function useGeneration(): [number, () => void] {
  const [gen, setGen] = useState(0);
  return [gen, useCallback(() => setGen((g) => g + 1), [])];
}

/** A copy of a list with one item moved. */
export function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}
