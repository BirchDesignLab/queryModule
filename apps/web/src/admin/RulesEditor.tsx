import { useT } from "../app/i18n-context.js";
import {
  asObjects,
  controlId,
  ItemButtons,
  moved,
  NumberControl,
  type Obj,
  SelectControl,
  str,
  TextControl,
  useDraftSetters,
  useFocusRequest,
  useGeneration,
} from "./controls.js";
import type { PathSegment } from "./draft.js";

/**
 * Task 31 part 2 PR2 (#355): rules and conditions (spec 4.2). The editors write exactly the
 * site-config rule schema (packages/core/src/config/schema-fields.ts: Condition, FieldRule) and
 * nothing else: leaf tests, all, any, not, literal values and { $default: field } (checker ruling
 * 09-29-26: no new condition syntax).
 */

const EFFECTS = ["show", "hide", "require", "setDefault"] as const;
const OPS = ["eq", "neq", "in", "notIn", "gt", "gte", "lt", "lte", "empty", "notEmpty"] as const;
const KINDS = ["leaf", "all", "any", "not"] as const;
type Kind = (typeof KINDS)[number];
type OpShape = "scalar" | "list" | "none";

const shapeOf = (op: unknown): OpShape =>
  op === "in" || op === "notIn" ? "list" : op === "empty" || op === "notEmpty" ? "none" : "scalar";

/** Value kinds (as for field defaults): a literal is typed by the field it compares. */
type ValueKind = "number" | "boolean" | "text";
const kindOfType = (t: unknown): ValueKind =>
  t === "number" || t === "year" ? "number" : t === "boolean" ? "boolean" : "text";

const isDefaultRef = (v: unknown): v is { $default: string } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "$default" in v;

function kindOf(cond: unknown): Kind {
  if (typeof cond === "object" && cond !== null) {
    if ("all" in cond) return "all";
    if ("any" in cond) return "any";
    if ("not" in cond) return "not";
  }
  return "leaf";
}

const childrenOf = (cond: Obj): unknown[] => {
  const k = kindOf(cond);
  if (k === "all" || k === "any") return Array.isArray(cond[k]) ? (cond[k] as unknown[]) : [];
  if (k === "not") return [cond.not];
  return [];
};

/** A condition converted to another kind, keeping what fits (the first child, or the leaf). */
function convertKind(cond: Obj, to: Kind, fallback: Obj): Obj {
  const from = kindOf(cond);
  if (from === to) return cond;
  const first = childrenOf(cond)[0];
  const firstLeaf = kindOf(first) === "leaf" && first !== undefined ? (first as Obj) : fallback;
  if (to === "leaf") return from === "leaf" ? cond : firstLeaf;
  if (to === "not") return { not: from === "leaf" ? cond : (first ?? fallback) };
  // to all or any
  if (from === "all" || from === "any") return { [to]: childrenOf(cond) };
  return { [to]: [from === "leaf" ? cond : (first ?? fallback)] };
}

/** A leaf with another operator, its value reshaped to fit (spec 4.2 operand forms). */
function convertOp(leaf: Obj, op: string): Obj {
  const { value, ...rest } = leaf;
  const shape = shapeOf(op);
  if (shape === "none") return { ...rest, op };
  if (shape === "list") {
    const list = Array.isArray(value)
      ? value
      : value === undefined || isDefaultRef(value)
        ? []
        : [value];
    return { ...rest, op, value: list };
  }
  const scalar = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  return { ...rest, op, value: scalar };
}

interface FieldInfo {
  keys: readonly string[];
  kind(key: unknown): ValueKind;
}

function fieldInfo(type: Obj): FieldInfo {
  const fields = asObjects(type.fields);
  const keys = fields.map((f) => str(f.key)).filter((k) => k !== "");
  const kinds = new Map(fields.map((f) => [str(f.key), kindOfType(f.dataType)]));
  return { keys, kind: (key) => kinds.get(str(key)) ?? "text" };
}

const defaultLeaf = (info: FieldInfo): Obj => ({ field: info.keys[0] ?? "", op: "notEmpty" });

/** One literal, typed by the compared field; blank removes it when `optional`. */
function LiteralControl({
  idPrefix,
  path,
  label,
  value,
  kind,
  optional = false,
}: {
  idPrefix: string;
  path: readonly PathSegment[];
  label: string;
  value: unknown;
  kind: ValueKind;
  optional?: boolean;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  if (kind === "number")
    return (
      <NumberControl
        idPrefix={idPrefix}
        path={path}
        label={label}
        value={value}
        optional={optional}
      />
    );
  if (kind === "boolean")
    return (
      <SelectControl
        idPrefix={idPrefix}
        path={path}
        label={label}
        value={value === undefined ? "" : String(value)}
        options={["true", "false"]}
        blank={t("admin.config.none")}
        onValue={(next) => setPath(path, next === undefined ? undefined : next === "true")}
      />
    );
  return (
    <TextControl idPrefix={idPrefix} path={path} label={label} value={value} optional={optional} />
  );
}

export function ConditionEditor({
  value,
  path,
  info,
  idPrefix,
  legend,
}: {
  value: unknown;
  path: readonly PathSegment[];
  info: FieldInfo;
  idPrefix: string;
  legend: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const cond = (typeof value === "object" && value !== null ? value : {}) as Obj;
  const kind = kindOf(cond);
  return (
    <fieldset className="qm-admin__condition">
      <legend>{legend}</legend>
      <SelectControl
        idPrefix={idPrefix}
        path={[...path, "$kind"]}
        label={t("admin.config.condition.type")}
        value={kind}
        options={KINDS}
        optionLabel={(k) => t(`admin.config.condition.kind.${k}`)}
        onValue={(next) =>
          setPath(path, convertKind(cond, (next ?? "leaf") as Kind, defaultLeaf(info)))
        }
      />
      {kind === "leaf" ? (
        <LeafControls leaf={cond} path={path} info={info} idPrefix={idPrefix} />
      ) : kind === "not" ? (
        <ConditionEditor
          value={cond.not}
          path={[...path, "not"]}
          info={info}
          idPrefix={idPrefix}
          legend={t("admin.config.condition.child", { n: 1 })}
        />
      ) : (
        <ChildConditions
          items={childrenOf(cond)}
          path={[...path, kind]}
          info={info}
          idPrefix={idPrefix}
        />
      )}
    </fieldset>
  );
}

function ChildConditions({
  items,
  path,
  info,
  idPrefix,
}: {
  items: readonly unknown[];
  path: readonly PathSegment[];
  info: FieldInfo;
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const [gen, bump] = useGeneration();
  const focus = useFocusRequest();
  const listOwner = controlId(idPrefix, path);
  return (
    <>
      {items.map((child, i) => {
        const n = i + 1;
        return (
          <div key={`${controlId(idPrefix, [...path, i])}:${gen}`} className="qm-admin__item">
            <ConditionEditor
              value={child}
              path={[...path, i]}
              info={info}
              idPrefix={idPrefix}
              legend={t("admin.config.condition.child", { n })}
            />
            <button
              type="button"
              className="qm-button"
              onClick={() => {
                bump();
                setPath(
                  path,
                  items.filter((_, j) => j !== i),
                );
                focus([listOwner, "add"]);
              }}
            >
              {t("admin.config.condition.removeChild", { n })}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="qm-button"
        data-owner={listOwner}
        data-role="add"
        onClick={() => setPath(path, [...items, defaultLeaf(info)])}
      >
        {t("admin.config.condition.add")}
      </button>
    </>
  );
}

function LeafControls({
  leaf,
  path,
  info,
  idPrefix,
}: {
  leaf: Obj;
  path: readonly PathSegment[];
  info: FieldInfo;
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const shape = shapeOf(leaf.op);
  const valueKind = info.kind(leaf.field);
  const valuePath = [...path, "value"];
  return (
    <>
      <SelectControl
        idPrefix={idPrefix}
        path={[...path, "field"]}
        label={t("admin.config.condition.field")}
        value={leaf.field}
        options={info.keys}
      />
      <SelectControl
        idPrefix={idPrefix}
        path={[...path, "op"]}
        label={t("admin.config.condition.operator")}
        value={leaf.op}
        options={OPS}
        optionLabel={(op) => t(`admin.config.op.${op}`)}
        onValue={(next) => setPath(path, convertOp(leaf, next ?? "eq"))}
      />
      {shape === "scalar" && (
        <>
          <SelectControl
            idPrefix={idPrefix}
            path={[...path, "$compare"]}
            label={t("admin.config.condition.compareWith")}
            value={isDefaultRef(leaf.value) ? "default" : "value"}
            options={["value", "default"]}
            optionLabel={(o) => t(`admin.config.condition.compare.${o}`)}
            onValue={(next) =>
              setPath(valuePath, next === "default" ? { $default: str(leaf.field) } : "")
            }
          />
          {isDefaultRef(leaf.value) ? (
            <SelectControl
              idPrefix={idPrefix}
              path={[...valuePath, "$default"]}
              label={t("admin.config.condition.defaultOf")}
              value={leaf.value.$default}
              options={info.keys}
            />
          ) : (
            <LiteralControl
              idPrefix={idPrefix}
              path={valuePath}
              label={t("admin.config.condition.value")}
              value={leaf.value}
              kind={valueKind}
            />
          )}
        </>
      )}
      {shape === "list" && (
        <ValueList
          items={Array.isArray(leaf.value) ? leaf.value : []}
          path={valuePath}
          kind={valueKind}
          idPrefix={idPrefix}
        />
      )}
    </>
  );
}

function ValueList({
  items,
  path,
  kind,
  idPrefix,
}: {
  items: readonly unknown[];
  path: readonly PathSegment[];
  kind: ValueKind;
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const [gen, bump] = useGeneration();
  const focus = useFocusRequest();
  const owner = (i: number) => controlId(idPrefix, [...path, i, "$item"]);
  const listOwner = controlId(idPrefix, path);
  return (
    <fieldset>
      <legend>{t("admin.config.condition.values")}</legend>
      {items.map((item, i) => {
        const n = i + 1;
        return (
          <div key={`${owner(i)}:${gen}`} className="qm-admin__item">
            <LiteralControl
              idPrefix={idPrefix}
              path={[...path, i]}
              label={t("admin.config.condition.valueN", { n })}
              value={item}
              kind={kind}
            />
            <button
              type="button"
              className="qm-button"
              onClick={() => {
                bump();
                setPath(
                  path,
                  items.filter((_, j) => j !== i),
                );
                focus([listOwner, "add"]);
              }}
            >
              {t("admin.config.condition.removeValue", { n })}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="qm-button"
        data-owner={listOwner}
        data-role="add"
        onClick={() => {
          setPath(path, [...items, ""]);
          focus([owner(items.length), "first"]);
        }}
      >
        {t("admin.config.condition.addValue")}
      </button>
    </fieldset>
  );
}

export function RulesEditor({
  type,
  path,
  idPrefix,
}: {
  type: Obj;
  path: readonly PathSegment[];
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const focus = useFocusRequest();
  const [gen, bump] = useGeneration();
  const rules = asObjects(type.rules);
  const info = fieldInfo(type);
  const owner = (i: number) => controlId(idPrefix, [...path, i]);
  const listOwner = controlId(idPrefix, path);
  return (
    <fieldset>
      <legend>{t("admin.config.rules")}</legend>
      {rules.map((rule, i) => {
        const n = i + 1;
        const rulePath = [...path, i];
        const effect = str(rule.effect);
        return (
          <fieldset key={`${owner(i)}:${gen}`} className="qm-admin__item">
            <legend>{t("admin.config.rule.legend", { n })}</legend>
            <SelectControl
              idPrefix={idPrefix}
              path={[...rulePath, "field"]}
              label={t("admin.config.rule.target")}
              value={rule.field}
              options={info.keys}
              owner={owner(i)}
            />
            <SelectControl
              idPrefix={idPrefix}
              path={[...rulePath, "effect"]}
              label={t("admin.config.rule.effect")}
              value={effect}
              options={EFFECTS}
              optionLabel={(e) => t(`admin.config.effect.${e}`)}
              onValue={(next) => {
                // Only setDefault carries a value (config.ruleValueMismatch).
                const { value: _drop, ...rest } = rule;
                setPath(rulePath, { ...rest, effect: next ?? "show" });
              }}
            />
            {effect === "setDefault" && (
              <LiteralControl
                idPrefix={idPrefix}
                path={[...rulePath, "value"]}
                label={t("admin.config.field.defaultValue")}
                value={rule.value}
                kind={info.kind(rule.field)}
                optional
              />
            )}
            <ConditionEditor
              value={rule.when}
              path={[...rulePath, "when"]}
              info={info}
              idPrefix={idPrefix}
              legend={t("admin.config.condition.legend")}
            />
            <ItemButtons
              owner={owner(i)}
              name={t("admin.config.rule.name", { n })}
              index={i}
              count={rules.length}
              removeLabel={t("admin.config.remove")}
              onMove={(from, to) => {
                bump();
                setPath(path, moved(rules, from, to));
                focus(
                  [owner(to), from > to ? "up" : "down"],
                  [owner(to), from > to ? "down" : "up"],
                );
              }}
              onRemove={(at) => {
                bump();
                const next = rules.filter((_, j) => j !== at);
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
          const first = info.keys[0] ?? "";
          setPath(path, [...rules, { field: first, when: defaultLeaf(info), effect: "show" }]);
          focus([owner(rules.length), "first"]);
        }}
      >
        {t("admin.config.rule.add")}
      </button>
    </fieldset>
  );
}

/** A section's optional `when` (spec 4.1 SectionDef): add, edit, remove. */
export function SectionCondition({
  section,
  path,
  type,
  idPrefix,
}: {
  section: Obj;
  path: readonly PathSegment[];
  type: Obj;
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const info = fieldInfo(type);
  const whenPath = [...path, "when"];
  if (section.when === undefined)
    return (
      <button
        type="button"
        className="qm-button"
        onClick={() => setPath(whenPath, defaultLeaf(info))}
      >
        {t("admin.config.condition.add")}
      </button>
    );
  return (
    <>
      <ConditionEditor
        value={section.when}
        path={whenPath}
        info={info}
        idPrefix={idPrefix}
        legend={t("admin.config.condition.legend")}
      />
      <button type="button" className="qm-button" onClick={() => setPath(whenPath, undefined)}>
        {t("admin.config.condition.remove")}
      </button>
    </>
  );
}
