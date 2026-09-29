import { useT } from "../app/i18n-context.js";
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
} from "./controls.js";
import type { JsonObject, PathSegment } from "./draft.js";
import { OtherKeys } from "./GenericForm.js";
import { type FieldInfo, fieldInfo, LiteralControl, type ValueKind } from "./RulesEditor.js";

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

/** A preset value of the field's kind, visible in its control (no hidden blank literal). */
const blankOf = (kind: ValueKind): string | number | boolean =>
  kind === "number" ? 0 : kind === "boolean" ? false : "";

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
          <fieldset key={`${owner(i)}:${gen}`} className="qm-admin__item">
            <legend>{t("admin.config.command.legend", { code })}</legend>
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
          </fieldset>
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
  return (
    <fieldset>
      <legend>{t("admin.config.command.positions")}</legend>
      {positions.map((pos, i) => {
        const n = i + 1;
        const field = positionField(pos);
        const rest = isRest(pos);
        const restId = `${controlId(idPrefix, [...path, i])}-rest`;
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
  const presetsPath = [...path, "presets"];
  const presets =
    typeof command.presets === "object" && command.presets !== null ? (command.presets as Obj) : {};
  const entries = Object.entries(presets);
  const positioned = new Set(
    (Array.isArray(command.positions) ? command.positions : []).map(positionField),
  );
  const owner = (i: number) => controlId(idPrefix, [...presetsPath, i]);
  const listOwner = controlId(idPrefix, presetsPath);
  /** Presets with one entry replaced or dropped, key order kept; none left removes the key. */
  const write = (at: number, entry: [string, unknown] | null) => {
    const next = entries.flatMap((e, j) => (j !== at ? [e] : entry === null ? [] : [entry]));
    setPath(presetsPath, next.length === 0 ? undefined : Object.fromEntries(next));
  };
  return (
    <fieldset>
      <legend>{t("admin.config.command.presets")}</legend>
      {entries.map(([key, value], i) => {
        const n = i + 1;
        return (
          <fieldset key={owner(i)} className="qm-admin__item">
            <legend>{t("admin.config.command.preset", { n })}</legend>
            <SelectControl
              idPrefix={idPrefix}
              path={[...presetsPath, `$key${i}`]}
              label={t("admin.config.condition.field")}
              value={key}
              options={info.keys}
              owner={owner(i)}
              onValue={(next) => write(i, [next ?? "", value])}
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
                write(at, null);
                focus([owner(Math.min(at, entries.length - 2)), "first"], [listOwner, "add"]);
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
          const key = info.keys.find((k) => !positioned.has(k) && !(k in presets));
          if (key === undefined) return;
          setPath(presetsPath, { ...presets, [key]: blankOf(info.kind(key)) });
          focus([owner(entries.length), "first"]);
        }}
      >
        {t("admin.config.command.addPreset")}
      </button>
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
