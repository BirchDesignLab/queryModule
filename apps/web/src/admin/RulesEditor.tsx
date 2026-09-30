import { useT } from "../app/i18n-context.js";
import { useDraft } from "./builder-store.js";
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
  useItemIssues,
  useLabelText,
} from "./controls.js";
import type { JsonObject, PathSegment } from "./draft.js";
import { OtherKeys } from "./GenericForm.js";

/**
 * Task 31 part 2 PR2 (#355): rules and conditions (spec 4.2). The editors write exactly the
 * site-config rule schema (packages/core/src/config/schema-fields.ts: Condition, FieldRule) and
 * nothing else: leaf tests, all, any, not, literal values and { $default: field } (checker ruling
 * 09-29-26: no new condition syntax).
 */

export const EFFECTS = ["show", "hide", "require", "setDefault"] as const;
export const OPS = [
  "eq",
  "neq",
  "in",
  "notIn",
  "gt",
  "gte",
  "lt",
  "lte",
  "empty",
  "notEmpty",
] as const;
export const COMPARES = ["value", "default"] as const;
export const KINDS = ["leaf", "all", "any", "not"] as const;
type Kind = (typeof KINDS)[number];
type OpShape = "scalar" | "list" | "none";

const shapeOf = (op: unknown): OpShape =>
  op === "in" || op === "notIn" ? "list" : op === "empty" || op === "notEmpty" ? "none" : "scalar";

/** Value kinds (as for field defaults): a literal is typed by the field it compares. */
export type ValueKind = "number" | "boolean" | "text";
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
  // #388 M3: Not wraps the whole condition and a group keeps its children, so nothing is lost;
  // only a single field test keeps just one leaf (the first found, depth first).
  if (to === "leaf") return firstLeafOf(cond) ?? fallback;
  if (to === "not") return from === "not" ? cond : { not: cond };
  if (from === "all" || from === "any") return { [to]: childrenOf(cond) };
  const inner = from === "not" ? cond.not : cond;
  // Not around a group back to a group: the inner group's children, no extra level (critic m3).
  const innerKind = kindOf(inner);
  if (from === "not" && (innerKind === "all" || innerKind === "any"))
    return { [to]: childrenOf(inner as Obj) };
  return { [to]: [inner ?? fallback] };
}

/** The first field test in a condition, depth first. */
function firstLeafOf(cond: unknown): Obj | undefined {
  if (kindOf(cond) === "leaf")
    return typeof cond === "object" && cond !== null ? (cond as Obj) : undefined;
  for (const child of childrenOf(cond as Obj)) {
    const leaf = firstLeafOf(child);
    if (leaf !== undefined) return leaf;
  }
  return undefined;
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
  // Critic I1: no invented "" literal; a missing value is reported at its control.
  const scalar = Array.isArray(value) ? value[0] : value;
  return scalar === undefined ? { ...rest, op } : { ...rest, op, value: scalar };
}

export interface FieldInfo {
  keys: readonly string[];
  kind(key: unknown): ValueKind;
  /** What a field reads as: its label text, else its key (A3); the key without a label hook. */
  name(key: unknown): string;
}

export function fieldInfo(type: Obj, labelText?: (labelKey: unknown) => string): FieldInfo {
  const fields = asObjects(type.fields);
  const keys = fields.map((f) => str(f.key)).filter((k) => k !== "");
  const kinds = new Map(fields.map((f) => [str(f.key), kindOfType(f.dataType)]));
  const labelKeys = new Map(fields.map((f) => [str(f.key), f.labelKey]));
  return {
    keys,
    kind: (key) => kinds.get(str(key)) ?? "text",
    name: (key) => {
      const text = labelText?.(labelKeys.get(str(key))) ?? "";
      return text === "" ? str(key) : text;
    },
  };
}

/** fieldInfo with plain field names (A3). */
export function useFieldInfo(type: Obj): FieldInfo {
  return fieldInfo(type, useLabelText());
}

/**
 * A rule or condition in plain words (A3, design target "Show when State is not the site default").
 * Read-only: it describes the schema Condition the controls write, and adds no syntax (PR2 ruling).
 */
export function useConditionWords(type: Obj) {
  const t = useT();
  const labelText = useLabelText();
  const info = useFieldInfo(type);
  const { doc } = useDraft();
  const lists = asObjects((doc as JsonObject | null)?.picklists);
  const fields = asObjects(type.fields);
  const value = (field: unknown, v: unknown): string => {
    if (v === undefined) return t("admin.rule.notSet");
    if (isDefaultRef(v))
      return str(v.$default) === str(field)
        ? t("admin.rule.siteDefault")
        : t("admin.rule.siteDefaultOf", { field: info.name(v.$default) });
    if (typeof v === "boolean") return t(v ? "admin.config.yes" : "admin.config.no");
    const def = fields.find((f) => str(f.key) === str(field));
    const list = lists.find((l) => str(l.id) === str(def?.picklist));
    const item = asObjects(list?.values).find((x) => str(x.code) === String(v));
    const text = item === undefined ? "" : labelText(item.labelKey);
    return text === "" ? String(v) : text;
  };
  const when = (cond: unknown, nested = false): string => {
    const c = (typeof cond === "object" && cond !== null ? cond : {}) as Obj;
    const kind = kindOf(c);
    if (kind === "not") return t("admin.rule.not", { when: when(c.not, true) });
    if (kind === "all" || kind === "any") {
      const joined = childrenOf(c)
        .map((x) => when(x, true))
        .join(` ${t(kind === "all" ? "admin.rule.and" : "admin.rule.or")} `);
      return nested && childrenOf(c).length > 1 ? `(${joined})` : joined;
    }
    const op = OPS.includes(c.op as (typeof OPS)[number]) ? str(c.op) : "eq";
    const field = info.name(c.field);
    const values = Array.isArray(c.value) ? c.value.map((x) => value(c.field, x)).join(", ") : "";
    return t(`admin.rule.op.${op}`, { field, value: value(c.field, c.value), values });
  };
  return {
    rule: (rule: Obj): string => {
      const effect = EFFECTS.includes(rule.effect as (typeof EFFECTS)[number])
        ? str(rule.effect)
        : "show";
      return t(`admin.rule.effect.${effect}`, {
        field: info.name(rule.field),
        value: value(rule.field, rule.value),
        when: when(rule.when),
      });
    },
    section: (cond: unknown): string => t("admin.rule.section", { when: when(cond) }),
  };
}

const defaultLeaf = (info: FieldInfo): Obj => ({ field: info.keys[0] ?? "", op: "notEmpty" });

const LEAF_KEYS: ReadonlySet<string> = new Set(["field", "op", "value"]);
const RULE_KEYS: ReadonlySet<string> = new Set(["field", "effect", "value", "when"]);

/** A leaf on another field: a $default follows the field; a literal of another kind is dropped. */
function changeLeafField(leaf: Obj, next: string | undefined, info: FieldInfo): Obj {
  const { value, ...rest } = leaf;
  const field = next ?? "";
  if (isDefaultRef(value)) return { ...rest, field, value: { $default: field } };
  if (value === undefined || info.kind(next) !== info.kind(leaf.field)) return { ...rest, field };
  return { ...rest, field, value };
}

/** One literal, typed by the compared field; blank removes it when `optional`. */
export function LiteralControl({
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
        blank={optional ? t("admin.config.none") : undefined}
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
  number = "",
}: {
  value: unknown;
  path: readonly PathSegment[];
  info: FieldInfo;
  idPrefix: string;
  legend: string;
  /** This condition's position path ("", "1", "1.2"): nested names stay unique (#388 M5). */
  number?: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const cond = (typeof value === "object" && value !== null ? value : {}) as Obj;
  const kind = kindOf(cond);
  const covered: ReadonlySet<string> = kind === "leaf" ? LEAF_KEYS : new Set([kind]);
  const issues = useItemIssues(idPrefix, path, [...covered]);
  return (
    <fieldset className="qm-admin__condition" aria-describedby={issues.describedBy}>
      <legend>{legend}</legend>
      {issues.messages}
      <SelectControl
        idPrefix={idPrefix}
        owner={controlId(idPrefix, path)}
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
          legend={t("admin.config.condition.child", { n: number === "" ? "1" : `${number}.1` })}
          number={number === "" ? "1" : `${number}.1`}
        />
      ) : (
        <ChildConditions
          number={number}
          items={childrenOf(cond)}
          path={[...path, kind]}
          info={info}
          idPrefix={idPrefix}
        />
      )}
      <OtherKeys item={cond} path={path} covered={covered} idPrefix={idPrefix} />
    </fieldset>
  );
}

function ChildConditions({
  number,
  items,
  path,
  info,
  idPrefix,
}: {
  number: string;
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
  const numberOf = (n: number) => (number === "" ? String(n) : `${number}.${n}`);
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
              legend={t("admin.config.condition.child", { n: numberOf(n) })}
              number={numberOf(n)}
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
              {t("admin.config.condition.removeChild", { n: numberOf(n) })}
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
          setPath(path, [...items, defaultLeaf(info)]);
          focus([controlId(idPrefix, [...path, items.length]), "first"]);
        }}
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
        optionLabel={info.name}
        onValue={(next) => setPath(path, changeLeafField(leaf, next, info))}
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
            options={COMPARES}
            optionLabel={(o) => t(`admin.config.condition.compare.${o}`)}
            onValue={(next) =>
              setPath(
                valuePath,
                next === "default"
                  ? { $default: str(leaf.field) || (info.keys[0] ?? "") }
                  : undefined,
              )
            }
          />
          {isDefaultRef(leaf.value) ? (
            <SelectControl
              idPrefix={idPrefix}
              path={[...valuePath, "$default"]}
              label={t("admin.config.condition.defaultOf")}
              value={leaf.value.$default}
              options={info.keys}
              optionLabel={info.name}
            />
          ) : (
            <LiteralControl
              idPrefix={idPrefix}
              path={valuePath}
              label={t("admin.config.condition.value")}
              value={leaf.value}
              kind={valueKind}
              optional
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
  const info = useFieldInfo(type);
  const words = useConditionWords(type);
  const owner = (i: number) => controlId(idPrefix, [...path, i]);
  const listOwner = controlId(idPrefix, path);
  return (
    <div className="qm-admin__list">
      {rules.map((rule, i) => {
        const n = i + 1;
        const rulePath = [...path, i];
        const effect = str(rule.effect);
        return (
          <RuleBox
            key={`${owner(i)}:${gen}`}
            path={rulePath}
            idPrefix={idPrefix}
            rule={rule}
            n={n}
            sentence={words.rule(rule)}
          >
            <SelectControl
              idPrefix={idPrefix}
              path={[...rulePath, "field"]}
              label={t("admin.config.rule.target")}
              value={rule.field}
              options={info.keys}
              optionLabel={info.name}
              owner={owner(i)}
              onValue={(next) => {
                // Critic I2: a value of another kind no longer fits the new target.
                const { value, ...rest } = rule;
                const keep = value !== undefined && info.kind(next) === info.kind(rule.field);
                setPath(
                  rulePath,
                  keep ? { ...rest, field: next, value } : { ...rest, field: next },
                );
              }}
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
            {(effect === "setDefault" || rule.value !== undefined) && (
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
          </RuleBox>
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
    </div>
  );
}

/** One rule's fieldset: its own issues (a missing when, say) and keys no control covers (I3). */
function RuleBox({
  rule,
  path,
  idPrefix,
  n,
  sentence,
  children,
}: {
  rule: Obj;
  path: readonly PathSegment[];
  idPrefix: string;
  n: number;
  /** The rule in plain words, above its controls (A3). */
  sentence: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const issues = useItemIssues(idPrefix, path, [...RULE_KEYS]);
  return (
    <fieldset className="qm-admin__item" aria-describedby={issues.describedBy}>
      <legend>{t("admin.config.rule.legend", { n })}</legend>
      <p className="qm-rule__sentence">{sentence}</p>
      {issues.messages}
      {children}
      <OtherKeys item={rule} path={path} covered={RULE_KEYS} idPrefix={idPrefix} />
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
  const focus = useFocusRequest();
  const info = useFieldInfo(type);
  const words = useConditionWords(type);
  const whenPath = [...path, "when"];
  const owner = controlId(idPrefix, whenPath);
  if (section.when === undefined)
    return (
      <button
        type="button"
        className="qm-button"
        data-owner={owner}
        data-role="add"
        onClick={() => {
          setPath(whenPath, defaultLeaf(info));
          focus([owner, "first"]);
        }}
      >
        {t("admin.config.condition.add")}
      </button>
    );
  return (
    <>
      <p className="qm-rule__sentence">{words.section(section.when)}</p>
      <ConditionEditor
        value={section.when}
        path={whenPath}
        info={info}
        idPrefix={idPrefix}
        legend={t("admin.config.condition.legend")}
      />
      <button
        type="button"
        className="qm-button qm-button--danger"
        onClick={() => {
          setPath(whenPath, undefined);
          focus([owner, "add"]);
        }}
      >
        {t("admin.config.condition.remove")}
      </button>
    </>
  );
}
