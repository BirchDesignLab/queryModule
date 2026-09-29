import { useContext, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { ChecksContext, isError, issuesFor } from "./checks.js";
import {
  asObjects,
  controlId,
  ItemButtons,
  moved,
  type Obj,
  SelectControl,
  str,
  TextControl,
  useDraftSetters,
  useFocusRequest,
  useGeneration,
  useItemIssues,
} from "./controls.js";
import type { JsonObject, PathSegment } from "./draft.js";
import { OtherKeys } from "./GenericForm.js";
import { type FieldInfo, fieldInfo, LiteralControl } from "./RulesEditor.js";

/**
 * Task 31 part 2 PR3a (#355): terminal commands (FR-050 to FR-055: code, query type, ordered
 * positions with an optional rest-of-line last position, presets) and the quick-access list. The
 * editors write exactly the schema's CommandDef (packages/core/src/config/schema.ts).
 */

const COMMAND_KEYS: ReadonlySet<string> = new Set(["code", "queryType", "positions", "presets"]);

type Position = string | { field: string; rest: true };
const positionField = (p: unknown): string =>
  typeof p === "string" ? p : typeof p === "object" && p !== null ? str((p as Obj).field) : "";
const isRest = (p: unknown): boolean =>
  typeof p === "object" && p !== null && (p as Obj).rest === true;

export function CommandsEditor({
  value,
  doc,
  idPrefix,
}: {
  value: unknown;
  doc: JsonObject;
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const focus = useFocusRequest();
  const [gen, bump] = useGeneration();
  const list = asObjects(value);
  const path = ["commands"] as const;
  const types = asObjects(doc.queryTypes);
  const typeCodes = types.map((q) => str(q.code)).filter((c) => c !== "");
  const owner = (i: number) => controlId(idPrefix, [...path, i]);
  const listOwner = controlId(idPrefix, path);
  return (
    <div>
      {list.map((cmd, i) => {
        const cmdPath = [...path, i];
        const code = str(cmd.code);
        const type = types.find((q) => q.code === cmd.queryType);
        const info = fieldInfo(type ?? {});
        return (
          <CommandBox key={`${owner(i)}:${gen}`} path={cmdPath} idPrefix={idPrefix} code={code}>
            <TextControl
              idPrefix={idPrefix}
              path={[...cmdPath, "code"]}
              label={t("admin.config.code")}
              value={cmd.code}
              owner={owner(i)}
            />
            <SelectControl
              idPrefix={idPrefix}
              path={[...cmdPath, "queryType"]}
              label={t("admin.config.command.queryType")}
              value={cmd.queryType}
              options={typeCodes}
            />
            <StaleFields command={cmd} path={cmdPath} info={info} />
            <PositionsEditor
              positions={Array.isArray(cmd.positions) ? cmd.positions : []}
              path={[...cmdPath, "positions"]}
              info={info}
              idPrefix={idPrefix}
            />
            <PresetsEditor command={cmd} path={cmdPath} info={info} idPrefix={idPrefix} />
            <OtherKeys item={cmd} path={cmdPath} covered={COMMAND_KEYS} idPrefix={idPrefix} />
            <ItemButtons
              owner={owner(i)}
              name={code}
              index={i}
              count={list.length}
              removeLabel={t("admin.config.command.remove")}
              onMove={(from, to) => {
                bump();
                setPath(path, moved(list, from, to));
                focus(
                  [owner(to), from > to ? "up" : "down"],
                  [owner(to), from > to ? "down" : "up"],
                );
              }}
              onRemove={(at) => {
                bump();
                const next = list.filter((_, j) => j !== at);
                setPath(path, next);
                focus([owner(Math.min(at, next.length - 1)), "first"], [listOwner, "add"]);
              }}
            />
          </CommandBox>
        );
      })}
      <button
        type="button"
        className="qm-button"
        data-owner={listOwner}
        data-role="add"
        onClick={() => {
          setPath(path, [...list, { code: "", queryType: typeCodes[0] ?? "", positions: [] }]);
          focus([owner(list.length), "first"]);
        }}
      >
        {t("admin.config.command.add")}
      </button>
    </div>
  );
}

function PositionsEditor({
  positions,
  path,
  info,
  idPrefix,
}: {
  positions: readonly unknown[];
  path: readonly PathSegment[];
  info: FieldInfo;
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const focus = useFocusRequest();
  const [gen, bump] = useGeneration();
  const owner = (i: number) => controlId(idPrefix, [...path, i]);
  const listOwner = controlId(idPrefix, path);
  const used = new Set(positions.map(positionField));
  const checks = useContext(ChecksContext);
  const listIssues = useItemIssues(
    idPrefix,
    path,
    positions.map((_, j) => String(j)),
  );
  return (
    <fieldset aria-describedby={listIssues.describedBy}>
      <legend>{t("admin.config.command.positions")}</legend>
      {listIssues.messages}
      {positions.map((pos, i) => {
        const n = i + 1;
        const field = positionField(pos);
        const rest = isRest(pos);
        const restId = `${controlId(idPrefix, [...path, i])}-rest`;
        // #388 M2: restNotLast and restNotString sit on the position; the checkbox shares them.
        const posIssues = issuesFor(checks, [...path, i]);
        return (
          <fieldset key={`${owner(i)}:${gen}`} className="qm-admin__item">
            <legend>{t("admin.config.command.position", { n })}</legend>
            <SelectControl
              idPrefix={idPrefix}
              path={[...path, i]}
              label={t("admin.config.condition.field")}
              value={field}
              options={info.keys}
              owner={owner(i)}
              onValue={(next) => {
                const f = next ?? "";
                const shaped: Position = rest ? { field: f, rest: true } : f;
                setPath([...path, i], shaped);
              }}
            />
            <div>
              <input
                id={restId}
                type="checkbox"
                checked={rest}
                aria-invalid={isError(posIssues)}
                aria-describedby={
                  posIssues === undefined
                    ? undefined
                    : `${controlId(idPrefix, [...path, i])}-issues`
                }
                onChange={(e) =>
                  setPath([...path, i], e.target.checked ? { field, rest: true } : field)
                }
              />{" "}
              <label htmlFor={restId}>{t("admin.config.command.rest")}</label>
            </div>
            <ItemButtons
              owner={owner(i)}
              name={t("admin.config.command.positionName", { n })}
              index={i}
              count={positions.length}
              removeLabel={t("admin.config.remove")}
              onMove={(from, to) => {
                bump();
                setPath(path, moved(positions, from, to));
                focus(
                  [owner(to), from > to ? "up" : "down"],
                  [owner(to), from > to ? "down" : "up"],
                );
              }}
              onRemove={(at) => {
                bump();
                const next = positions.filter((_, j) => j !== at);
                setPath(path, next);
                focus([owner(Math.min(at, next.length - 1)), "first"], [listOwner, "add"]);
              }}
            />
          </fieldset>
        );
      })}
      <button
        type="button"
        className="qm-button"
        data-owner={listOwner}
        data-role="add"
        onClick={() => {
          const next = info.keys.find((k) => !used.has(k)) ?? info.keys[0] ?? "";
          setPath(path, [...positions, next]);
          focus([owner(positions.length), "first"]);
        }}
      >
        {t("admin.config.command.addPosition")}
      </button>
    </fieldset>
  );
}

/**
 * A command's presets (field -> literal). A new preset is a pending row that writes nothing until
 * a value is entered (critic I4: no invented "", 0 or false). A row offers only fields that are
 * neither positioned nor preset elsewhere (critic I3).
 */
function PresetsEditor({
  command,
  path,
  info,
  idPrefix,
}: {
  command: Obj;
  path: readonly PathSegment[];
  info: FieldInfo;
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const focus = useFocusRequest();
  const [gen, bump] = useGeneration();
  const [pending, setPending] = useState<string | null>(null);
  const presetsPath = [...path, "presets"];
  const presets =
    typeof command.presets === "object" && command.presets !== null ? (command.presets as Obj) : {};
  const entries = Object.entries(presets);
  const positioned = new Set(
    (Array.isArray(command.positions) ? command.positions : []).map(positionField),
  );
  const free = (own: string | null) =>
    info.keys.filter((k) => k === own || (!positioned.has(k) && !(k in presets) && k !== pending));
  const owner = (i: number) => controlId(idPrefix, [...presetsPath, i]);
  const listOwner = controlId(idPrefix, presetsPath);
  const issues = useItemIssues(
    idPrefix,
    presetsPath,
    entries.map(([k]) => k),
  );
  /** Presets with one entry replaced or dropped, key order kept; none left removes the key. */
  const write = (at: number, entry: [string, unknown] | null) => {
    const next = entries.flatMap((e, j) => (j !== at ? [e] : entry === null ? [] : [entry]));
    setPath(presetsPath, next.length === 0 ? undefined : Object.fromEntries(next));
  };
  const canAdd = pending === null && free(null).length > 0;
  return (
    <fieldset aria-describedby={issues.describedBy}>
      <legend>{t("admin.config.command.presets")}</legend>
      {issues.messages}
      {entries.map(([key, value], i) => {
        const n = i + 1;
        return (
          <fieldset key={`${owner(i)}:${gen}`} className="qm-admin__item">
            <legend>{t("admin.config.command.preset", { n })}</legend>
            <SelectControl
              idPrefix={idPrefix}
              path={[...presetsPath, `$key${i}`]}
              label={t("admin.config.condition.field")}
              value={key}
              options={free(key)}
              owner={owner(i)}
              onValue={(next) => {
                const to = next ?? "";
                if (info.kind(to) === info.kind(key)) write(i, [to, value]);
                else {
                  // A value of another kind does not carry over: the row becomes pending.
                  bump();
                  write(i, null);
                  setPending(to);
                }
              }}
            />
            <LiteralControl
              idPrefix={idPrefix}
              path={[...presetsPath, key]}
              label={t("admin.config.condition.value")}
              value={value}
              kind={info.kind(key)}
            />
            <ItemButtons
              owner={owner(i)}
              name={t("admin.config.command.presetName", { n })}
              index={i}
              count={entries.length}
              movable={false}
              removeLabel={t("admin.config.remove")}
              onRemove={(at) => {
                bump();
                write(at, null);
                focus([owner(Math.min(at, entries.length - 2)), "first"], [listOwner, "add"]);
              }}
            />
          </fieldset>
        );
      })}
      {pending !== null && (
        <PendingPreset
          field={pending}
          options={free(pending)}
          n={entries.length + 1}
          info={info}
          owner={owner(entries.length)}
          onField={setPending}
          onValue={(v) => {
            setPending(null);
            setPath(presetsPath, { ...presets, [pending]: v });
          }}
          onRemove={() => {
            setPending(null);
            focus([listOwner, "add"]);
          }}
        />
      )}
      <button
        type="button"
        className="qm-button"
        data-owner={listOwner}
        data-role="add"
        disabled={!canAdd}
        onClick={() => {
          const key = free(null)[0];
          if (key === undefined) return;
          setPending(key);
          focus([owner(entries.length), "first"]);
        }}
      >
        {t("admin.config.command.addPreset")}
      </button>
    </fieldset>
  );
}

/** A preset row not yet in the draft: its first non-blank value commits it. */
function PendingPreset({
  field,
  options,
  n,
  info,
  owner,
  onField,
  onValue,
  onRemove,
}: {
  field: string;
  options: readonly string[];
  n: number;
  info: FieldInfo;
  owner: string;
  onField(field: string): void;
  onValue(value: string | number | boolean): void;
  onRemove(): void;
}) {
  const t = useT();
  const kind = info.kind(field);
  const fieldId = `${owner}-pending-field`;
  const valueId = `${owner}-pending-value`;
  return (
    <fieldset className="qm-admin__item">
      <legend>{t("admin.config.command.preset", { n })}</legend>
      <div>
        <label htmlFor={fieldId}>{t("admin.config.condition.field")}</label>{" "}
        <select
          id={fieldId}
          data-owner={owner}
          data-role="first"
          value={field}
          onChange={(e) => onField(e.target.value)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={valueId}>{t("admin.config.condition.value")}</label>{" "}
        {kind === "boolean" ? (
          <select
            id={valueId}
            value=""
            onChange={(e) => {
              if (e.target.value !== "") onValue(e.target.value === "true");
            }}
          >
            <option value="">{t("admin.config.none")}</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            id={valueId}
            type="text"
            inputMode={kind === "number" ? "decimal" : undefined}
            defaultValue=""
            onChange={(e) => {
              const text = e.target.value;
              if (text.trim() === "") return;
              if (kind !== "number") onValue(text);
              else if (Number.isFinite(Number(text))) onValue(Number(text));
            }}
          />
        )}
      </div>
      <div className="qm-admin__item-buttons">
        <button type="button" className="qm-button" onClick={onRemove}>
          {`${t("admin.config.remove")} ${t("admin.config.command.presetName", { n })}`}
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Positions and presets on fields the command's query type lacks (after a type change). They stay
 * until the user removes them here: arrowing through a closed select fires a change per step, so a
 * type change never drops data by itself (critic I1; #388 M1).
 */
function StaleFields({
  command,
  path,
  info,
}: {
  command: Obj;
  path: readonly PathSegment[];
  info: FieldInfo;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const keys = new Set(info.keys);
  const positions = Array.isArray(command.positions) ? command.positions : [];
  const presets =
    typeof command.presets === "object" && command.presets !== null ? (command.presets as Obj) : {};
  const stale =
    positions.some((p) => !keys.has(positionField(p))) ||
    Object.keys(presets).some((k) => !keys.has(k));
  if (!stale) return null;
  return (
    <button
      type="button"
      className="qm-button"
      onClick={() => {
        const { presets: _old, ...rest } = command;
        const kept = Object.entries(presets).filter(([k]) => keys.has(k));
        setPath(path, {
          ...rest,
          positions: positions.filter((p) => keys.has(positionField(p))),
          ...(kept.length > 0 ? { presets: Object.fromEntries(kept) } : {}),
        });
      }}
    >
      {t("admin.config.command.removeStale", { type: str(command.queryType) })}
    </button>
  );
}

/** One command's fieldset: its own issues (a missing key, a union error) (critic I2). */
function CommandBox({
  path,
  idPrefix,
  code,
  children,
}: {
  path: readonly PathSegment[];
  idPrefix: string;
  code: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const issues = useItemIssues(idPrefix, path, [...COMMAND_KEYS]);
  return (
    <fieldset className="qm-admin__item" aria-describedby={issues.describedBy}>
      <legend>
        {code === "" ? t("admin.config.command.new") : t("admin.config.command.legend", { code })}
      </legend>
      {issues.messages}
      {children}
    </fieldset>
  );
}

/** The quick-access list: query type codes in button order (spec 6.2). */
export function QuickAccessEditor({
  value,
  doc,
  idPrefix,
}: {
  value: unknown;
  doc: JsonObject;
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const focus = useFocusRequest();
  const [gen, bump] = useGeneration();
  const codes = Array.isArray(value) ? value.map(str) : [];
  const typeCodes = asObjects(doc.queryTypes)
    .map((q) => str(q.code))
    .filter((c) => c !== "");
  const path = ["quickAccess"] as const;
  const owner = (i: number) => controlId(idPrefix, [...path, i]);
  const listOwner = controlId(idPrefix, path);
  return (
    <fieldset>
      <legend>{t("admin.config.quickAccess.legend")}</legend>
      {codes.map((code, i) => (
        <div key={`${owner(i)}:${gen}`} className="qm-admin__item">
          <SelectControl
            idPrefix={idPrefix}
            path={[...path, i]}
            label={t("admin.config.quickAccess.item", { n: i + 1 })}
            value={code}
            options={typeCodes}
            owner={owner(i)}
          />
          <ItemButtons
            owner={owner(i)}
            name={code}
            index={i}
            count={codes.length}
            removeLabel={t("admin.config.remove")}
            onMove={(from, to) => {
              bump();
              setPath(path, moved(codes, from, to));
              focus([owner(to), from > to ? "up" : "down"], [owner(to), from > to ? "down" : "up"]);
            }}
            onRemove={(at) => {
              bump();
              const next = codes.filter((_, j) => j !== at);
              setPath(path, next);
              focus([owner(Math.min(at, next.length - 1)), "first"], [listOwner, "add"]);
            }}
          />
        </div>
      ))}
      <button
        type="button"
        className="qm-button"
        data-owner={listOwner}
        data-role="add"
        onClick={() => {
          const next = typeCodes.find((c) => !codes.includes(c)) ?? typeCodes[0] ?? "";
          setPath(path, [...codes, next]);
          focus([owner(codes.length), "first"]);
        }}
      >
        {t("admin.config.quickAccess.add")}
      </button>
    </fieldset>
  );
}
