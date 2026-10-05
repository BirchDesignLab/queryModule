import { FIXTURE_LEAF_KEYS, normaliseFixtureKey } from "@querymodule/core/config";
import type { SourcePayload } from "@querymodule/core/contracts";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useContext, useId, useRef } from "react";
import { useT } from "../app/i18n-context.js";
import { ChecksContext } from "./checks.js";
import type { PathSegment } from "./draft.js";
import { useMockEnv } from "./mock-context.js";
import {
  addPayloadChild,
  payloadPointer,
  removePayloadAt,
  renamePayloadKey,
  setPayloadValue,
} from "./mock-edit.js";
import { payloadKeyOptions } from "./mock-model.js";

/**
 * The payload editor (Task 3a, #549, CFG-2; design 10-05-26): key and value rows in mono, groups
 * and lists nested by an indent and a guide line. Keys come from the fixture allowlist (a datalist);
 * the diagnostic of a row, from `checkFixturePolicy`, sits under the row with a fix button, and
 * names the rule, never the value (spec 5.9). The server's check on publish stays the authority.
 */

interface Row {
  path: PathSegment[];
  depth: number;
  /** An object key, or the index of a list item. */
  segment: PathSegment;
  kind: "value" | "group" | "list" | "item";
  value: unknown;
  /** Fields in a group, items in a list. */
  count: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function rowsOf(value: unknown, path: PathSegment[] = [], depth = 0): Row[] {
  const entries: [PathSegment, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : isObject(value)
      ? Object.entries(value)
      : [];
  return entries.flatMap(([segment, v]) => {
    const at = [...path, segment];
    const inList = typeof segment === "number";
    const container = Array.isArray(v) || isObject(v);
    const kind: Row["kind"] = Array.isArray(v)
      ? "list"
      : isObject(v)
        ? inList
          ? "item"
          : "group"
        : "value";
    const row: Row = {
      path: at,
      depth,
      segment,
      kind,
      value: v,
      count: container ? (Array.isArray(v) ? v.length : Object.keys(v as object).length) : 0,
    };
    return [row, ...(container ? rowsOf(v, at, depth + 1) : [])];
  });
}

const ALLOWED = new Set(Object.values(FIXTURE_LEAF_KEYS).flat());
const keyAllowed = (key: string): boolean => ALLOWED.has(normaliseFixtureKey(key));

/** What a fix button writes for a fixture finding; null removes the row. */
const FIX: Record<string, { label: string; value: string } | null> = {
  "fixture.realPlate": { label: "admin.mock.fix.plate", value: "ZZ-0001" },
  "fixture.plausibleDob": { label: "admin.mock.fix.dob", value: "1901-01-01" },
  "fixture.nonSyntheticName": { label: "admin.mock.fix.name", value: "TESTERSON" },
  "fixture.nonExampleAddress": { label: "admin.mock.fix.address", value: "1 Example Ave" },
};

export function MockPayload({
  base,
  payload,
  onChange,
  title,
  hint,
}: {
  /** The payload's pointer in the mock file: where the server reports its findings. */
  base: string;
  payload: SourcePayload;
  onChange(next: SourcePayload, coalesce?: string): void;
  title: string;
  hint: string;
}) {
  const t = useT();
  const env = useMockEnv();
  const checks = useContext(ChecksContext);
  const uid = useId();
  const listId = `${uid}-keys`;
  const rows = rowsOf(payload);
  // The error count when a field took focus: leaving it announces the new count if it changed.
  const before = useRef(0);
  const entered = () => {
    before.current = env.errorCount();
  };
  const left = () => {
    const now = env.errorCount();
    if (now === before.current) return;
    env.announce(
      t("admin.mock.errorsIn", {
        errors: t(now === 1 ? "admin.issues.error" : "admin.issues.errors", { count: now }),
      }),
    );
  };
  const id = (path: readonly PathSegment[], what: string) => `${uid}-${path.join("_")}-${what}`;
  const nameOf = (row: Row, index: number): string =>
    row.kind === "item" || typeof row.segment === "number"
      ? t("admin.config.item", { n: Number(row.segment) + 1 })
      : String(row.segment) === ""
        ? t("admin.mock.rowN", { n: index + 1 })
        : String(row.segment);
  return (
    <fieldset className="qm-mock__payload" aria-labelledby={`${uid}-title`}>
      <legend className="qm-mock__label" id={`${uid}-title`}>
        {title}
      </legend>
      <p className="qm-sect__hint">{hint}</p>
      <datalist id={listId}>
        {payloadKeyOptions().map((o) => (
          <option key={o.key} value={o.key} />
        ))}
      </datalist>
      <ul className="qm-mock__rows">
        {rows.map((row, index) => {
          const pointer = payloadPointer(base, row.path);
          const issues = (checks.byPointer.get(pointer) ?? []).filter((i) => i.level === "error");
          const keyBad =
            typeof row.segment === "string" &&
            (!keyAllowed(row.segment) || row.kind === "group" || row.kind === "list") &&
            issues.length > 0;
          const valueBad = issues.length > 0 && !keyBad;
          const errorId = `${uid}-${index}-e`;
          const name = nameOf(row, index);
          const container = row.kind === "group" || row.kind === "list" || row.kind === "item";
          return (
            <li
              // Position, not key: a renamed key keeps its row, and its focus.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={index}
              className={`qm-mock__row${row.depth > 0 ? " qm-mock__row--nested" : ""}`}
              style={{ marginInlineStart: `calc(${row.depth} * var(--qm-space-5))` }}
            >
              {typeof row.segment === "number" ? (
                <span className="qm-mock__item">
                  {t("admin.config.item", { n: row.segment + 1 })}
                </span>
              ) : (
                <>
                  <label htmlFor={id(row.path, "k")}>
                    <VisuallyHidden>{t("admin.mock.keyRow", { n: index + 1 })}</VisuallyHidden>
                  </label>
                  <input
                    id={id(row.path, "k")}
                    className="qm-field__input qm-mock__mono"
                    list={listId}
                    value={row.segment}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={keyBad || undefined}
                    aria-describedby={keyBad ? errorId : undefined}
                    onFocus={entered}
                    onBlur={left}
                    onChange={(e) =>
                      onChange(
                        renamePayloadKey(payload, row.path, e.target.value),
                        id(row.path, "k"),
                      )
                    }
                  />
                </>
              )}
              {container ? (
                <span className="qm-mock__tag">
                  {row.kind === "list"
                    ? t(row.count === 1 ? "admin.mock.listOne" : "admin.mock.listMany", {
                        count: row.count,
                      })
                    : t(row.count === 1 ? "admin.mock.groupOne" : "admin.mock.groupMany", {
                        count: row.count,
                      })}
                </span>
              ) : (
                <>
                  <label htmlFor={id(row.path, "v")}>
                    <VisuallyHidden>{t("admin.mock.valueFor", { name })}</VisuallyHidden>
                  </label>
                  <input
                    id={id(row.path, "v")}
                    className="qm-field__input qm-mock__mono"
                    value={String(row.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={valueBad || undefined}
                    aria-describedby={valueBad ? errorId : undefined}
                    onFocus={entered}
                    onBlur={left}
                    onChange={(e) =>
                      onChange(
                        setPayloadValue(payload, row.path, e.target.value),
                        id(row.path, "v"),
                      )
                    }
                  />
                </>
              )}
              <span className="qm-mock__tools">
                {container && row.kind !== "item" && (
                  <button
                    type="button"
                    className="qm-button qm-button--ghost qm-mock__icon"
                    aria-label={t(
                      row.kind === "list"
                        ? "admin.mock.addItemInside"
                        : "admin.mock.addFieldInside",
                      { name },
                    )}
                    onClick={() =>
                      onChange(
                        addPayloadChild(payload, row.path, row.kind === "list" ? "group" : "value"),
                      )
                    }
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                )}
                {row.kind === "item" && (
                  <button
                    type="button"
                    className="qm-button qm-button--ghost qm-mock__icon"
                    aria-label={t("admin.mock.addFieldInside", { name })}
                    onClick={() => onChange(addPayloadChild(payload, row.path, "value"))}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                )}
                <button
                  type="button"
                  className="qm-button qm-button--ghost qm-mock__icon"
                  aria-label={t(container ? "admin.mock.removeRowWith" : "admin.mock.removeRow", {
                    name,
                  })}
                  onClick={() => onChange(removePayloadAt(payload, row.path))}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </span>
              {issues.map((issue) => {
                const fix = FIX[issue.key] ?? null;
                return (
                  <p key={issue.key} className="qm-mock__error" id={errorId}>
                    <span aria-hidden="true">⚠</span>
                    <span data-issue-pointer={issue.pointer}>
                      <VisuallyHidden>{t("admin.config.level.error")} </VisuallyHidden>
                      {t(issue.key, issue.params)}
                    </span>
                    <button
                      type="button"
                      className="qm-button qm-button--ghost"
                      onClick={() => {
                        onChange(
                          fix === null || keyBad
                            ? removePayloadAt(payload, row.path)
                            : setPayloadValue(payload, row.path, fix.value),
                        );
                        // Focus stays where the row was: the fix button went with the message.
                        const next = env.errorCount();
                        env.announce(
                          t("admin.mock.fixed", {
                            errors: t(next === 1 ? "admin.issues.error" : "admin.issues.errors", {
                              count: next,
                            }),
                          }),
                        );
                      }}
                    >
                      {fix === null || keyBad ? t("admin.mock.fix.remove") : t(fix.label)}
                    </button>
                  </p>
                );
              })}
            </li>
          );
        })}
      </ul>
      <div className="qm-mock__add">
        <button
          type="button"
          className="qm-button qm-button--ghost"
          onClick={() => onChange(addPayloadChild(payload, [], "value"))}
        >
          {t("admin.mock.addField")}
        </button>
        <button
          type="button"
          className="qm-button qm-button--ghost"
          onClick={() => onChange(addPayloadChild(payload, [], "group"))}
        >
          {t("admin.mock.addGroup")}
        </button>
        <button
          type="button"
          className="qm-button qm-button--ghost"
          onClick={() => onChange(addPayloadChild(payload, [], "list"))}
        >
          {t("admin.mock.addList")}
        </button>
      </div>
    </fieldset>
  );
}
