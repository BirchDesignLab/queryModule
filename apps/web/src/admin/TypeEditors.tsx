import { DATA_TYPES, type DataType } from "@querymodule/core/config";
import { VisuallyHidden } from "@querymodule/web-ui";
import { memo, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useDraft } from "./builder-store.js";
import { ChecksContext } from "./checks.js";
import {
  Advanced,
  asObjects,
  CheckControl,
  controlId,
  ItemButtons,
  LabelTextControls,
  moved,
  NumberControl,
  type Obj,
  Sect,
  SelectControl,
  str,
  TextControl,
  useDraftSetters,
  useFocusRequest,
  useGeneration,
  useLabelText,
} from "./controls.js";
import { type JsonObject, type PathSegment, toPointer } from "./draft.js";
import { OtherKeys } from "./GenericForm.js";
import { RulesEditor, SectionCondition } from "./RulesEditor.js";
import { SelectionContext, useSelectedIndex } from "./selection.js";

/**
 * Task 31 part 2 (#355): purpose-built editors for query types, their sections and their fields
 * (FR-060). Keys without a purpose-built control stay editable through the generic form, so the
 * editors never hide part of the config.
 */

const TYPE_KEYS = new Set(["code", "labelKey", "allowPlateOnly", "sections", "fields", "rules"]);
const FIELD_KEYS = new Set([
  "key",
  "labelKey",
  "dataType",
  "required",
  "visible",
  "defaultValue",
  "picklist",
  "transform",
  "pattern",
  "section",
]);
const SECTION_KEYS = new Set(["key", "labelKey", "when"]);
const TRANSFORMS = ["none", "upper"] as const;

const newField = (section: string): Obj => ({
  key: "",
  labelKey: "",
  dataType: "string",
  required: false,
  visible: true,
  section,
});

const newType = (): Obj => ({
  code: "",
  labelKey: "",
  allowPlateOnly: false,
  sections: [{ key: "base", labelKey: "" }],
  fields: [newField("base")],
  rules: [],
  // sources (min 1) left out: the missing-key diagnostic names it (critic M3).
});

/** Value kinds a default can take; a data type change across kinds drops the default. */
const kindOf = (t: unknown): "number" | "boolean" | "text" =>
  t === "number" || t === "year" ? "number" : t === "boolean" ? "boolean" : "text";

/** Settings without a purpose-built control, rendered when opened. */
function MoreSettings(props: Parameters<typeof OtherKeys>[0]) {
  const t = useT();
  const checks = useContext(ChecksContext);
  const [open, setOpen] = useState(false);
  // Open while one of these settings has an issue, so the issue button can reach its control.
  const pointers = Object.keys(props.item)
    .filter((k) => !props.covered.has(k))
    .map((k) => toPointer([...props.path, k]));
  const flagged = checks.issues.some((i) =>
    pointers.some((p) => i.pointer === p || i.pointer.startsWith(`${p}/`)),
  );
  // Latched as Advanced is: fixing the setting never unmounts it under the user's focus.
  useEffect(() => {
    if (flagged) setOpen(true);
  }, [flagged]);
  return (
    <details open={open || flagged} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("admin.config.moreSettings")}</summary>
      {(open || flagged) && <OtherKeys {...props} />}
    </details>
  );
}

/** Every query type opens on demand: only open types render their controls on each draft edit. */
/**
 * The selected query type's editor (A-D1 A2: the tree picks the type; the old list of disclosures
 * is gone). Adding or removing a type moves the selection, so the editor follows it.
 */
export function QueryTypesEditor({ value, idPrefix }: { value: unknown; idPrefix: string }) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const focus = useFocusRequest();
  const { select } = useContext(SelectionContext);
  const types = asObjects(value);
  const path = ["queryTypes"] as const;
  const owner = (i: number) => controlId(idPrefix, [...path, i]);
  const listOwner = controlId(idPrefix, path);
  // Bumped on remove, so the next type at the same index gets fresh local state (critic I2).
  const [gen, bump] = useGeneration();
  // A type count change elsewhere (the raw tab) can leave the index past the end: show the last.
  const i = Math.min(useSelectedIndex("queryTypes") ?? 0, types.length - 1);
  const type = types[i];
  return (
    <div>
      {type !== undefined && (
        <QueryTypeEditor
          key={`${owner(i)}:${gen}`}
          type={type}
          path={[...path, i]}
          owner={owner(i)}
          idPrefix={idPrefix}
          onRemove={() => {
            const next = types.filter((_, j) => j !== i);
            bump();
            setPath(path, next);
            const k = Math.min(i, next.length - 1);
            if (k >= 0) select?.(toPointer([...path, k]));
            focus([owner(k), "first"], [listOwner, "add"]);
          }}
        />
      )}
      <button
        type="button"
        className="qm-button qm-button--secondary"
        data-owner={listOwner}
        data-role="add"
        onClick={() => {
          setPath(path, [...types, newType()]);
          select?.(toPointer([...path, types.length]));
          focus([owner(types.length), "first"]);
        }}
      >
        {t("admin.config.type.add")}
      </button>
    </div>
  );
}

function QueryTypeEditor({
  type,
  path,
  owner,
  idPrefix,
  onRemove,
}: {
  type: Obj;
  path: readonly PathSegment[];
  owner: string;
  idPrefix: string;
  onRemove(): void;
}) {
  const t = useT();
  const code = str(type.code);
  return (
    <fieldset className="qm-admin__item qm-admin__type" data-path={toPointer(path)}>
      {/* The editor heading shows the type's name and code; the group keeps its own name. */}
      <legend className="qm-admin__type-legend">{t("admin.config.type.legend", { code })}</legend>
      <Sect title={t("admin.config.sect.name")} hint={t("admin.config.sect.nameHint")}>
        <LabelTextControls idPrefix={idPrefix} path={path} labelKey={type.labelKey} />
        <TextControl
          idPrefix={idPrefix}
          path={[...path, "code"]}
          label={t("admin.config.code")}
          value={type.code}
          owner={owner}
        />
      </Sect>
      <Sect title={t("admin.config.sect.plateOnly")} hint={t("admin.config.sect.plateOnlyHint")}>
        <CheckControl
          idPrefix={idPrefix}
          path={[...path, "allowPlateOnly"]}
          label={t("admin.config.type.allowPlateOnly")}
          value={type.allowPlateOnly}
        />
      </Sect>
      <Sect title={t("admin.config.sect.sections")} hint={t("admin.config.sect.sectionsHint")}>
        <SectionsEditor
          type={type}
          sections={asObjects(type.sections)}
          path={[...path, "sections"]}
          idPrefix={idPrefix}
        />
      </Sect>
      <Sect title={t("admin.config.sect.fields")}>
        <FieldsEditor type={type} path={[...path, "fields"]} idPrefix={idPrefix} />
      </Sect>
      <Sect title={t("admin.config.sect.rules")} hint={t("admin.config.sect.rulesHint")}>
        <RulesEditor type={type} path={[...path, "rules"]} idPrefix={idPrefix} />
      </Sect>
      <Advanced
        path={path}
        keys={["labelKey", ...Object.keys(type).filter((k) => !TYPE_KEYS.has(k))]}
        attention={str(type.labelKey) === ""}
      >
        <TextControl
          idPrefix={idPrefix}
          path={[...path, "labelKey"]}
          label={t("admin.config.labelKey")}
          value={type.labelKey}
        />
        <OtherKeys item={type} path={path} covered={TYPE_KEYS} idPrefix={idPrefix} />
      </Advanced>
      <ItemButtons
        owner={owner}
        name={code}
        index={0}
        count={1}
        movable={false}
        removeLabel={t("admin.config.type.remove")}
        onRemove={onRemove}
      />
    </fieldset>
  );
}

/** An item's legend: its label text, or "New ..." while it has none; the key in hidden text. */
function ItemLegend({
  labelKey,
  keyText,
  fallback,
}: {
  labelKey: unknown;
  keyText: string;
  fallback: string;
}) {
  const label = useLabelText()(labelKey);
  return (
    <legend>
      {label === "" ? fallback : label}
      <VisuallyHidden>{keyText === "" ? "" : `, ${keyText}`}</VisuallyHidden>
    </legend>
  );
}

function SectionsEditor({
  type,
  sections,
  path,
  idPrefix,
}: {
  type: Obj;
  sections: Obj[];
  path: readonly PathSegment[];
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const focus = useFocusRequest();
  const [gen, bump] = useGeneration();
  const owner = (i: number) => controlId(idPrefix, [...path, i]);
  const listOwner = controlId(idPrefix, path);
  const first = (i: number) =>
    [
      [owner(i), "first"],
      [owner(i), "key"],
    ] as const;
  return (
    <div className="qm-admin__list">
      {sections.map((section, i) => {
        const itemPath = [...path, i];
        const key = str(section.key);
        return (
          <fieldset
            key={`${owner(i)}:${gen}`}
            className="qm-admin__item"
            data-path={toPointer(itemPath)}
          >
            <ItemLegend
              labelKey={section.labelKey}
              keyText={key === "" ? "" : t("admin.config.section.keyText", { key })}
              fallback={t("admin.config.section.new")}
            />
            <LabelTextControls
              idPrefix={idPrefix}
              path={itemPath}
              labelKey={section.labelKey}
              owner={owner(i)}
            />
            <SectionCondition section={section} path={itemPath} type={type} idPrefix={idPrefix} />
            <Advanced
              path={itemPath}
              keys={[
                "key",
                "labelKey",
                ...Object.keys(section).filter((k) => !SECTION_KEYS.has(k)),
              ]}
              attention={key === "" || str(section.labelKey) === ""}
            >
              <TextControl
                idPrefix={idPrefix}
                path={[...itemPath, "key"]}
                label={t("admin.config.section.key")}
                value={section.key}
                owner={owner(i)}
                focusRole="key"
              />
              <TextControl
                idPrefix={idPrefix}
                path={[...itemPath, "labelKey"]}
                label={t("admin.config.labelKey")}
                value={section.labelKey}
              />
              <OtherKeys
                item={section}
                path={itemPath}
                covered={SECTION_KEYS}
                idPrefix={idPrefix}
              />
            </Advanced>
            <ItemButtons
              owner={owner(i)}
              name={key}
              index={i}
              count={sections.length}
              removeLabel={t("admin.config.section.remove")}
              onMove={(from, to) => {
                bump();
                setPath(path, moved(sections, from, to));
                focus(
                  [owner(to), from > to ? "up" : "down"],
                  [owner(to), from > to ? "down" : "up"],
                );
              }}
              onRemove={(at) => {
                bump();
                const next = sections.filter((_, j) => j !== at);
                setPath(path, next);
                focus(...first(Math.min(at, next.length - 1)), [listOwner, "add"]);
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
          setPath(path, [...sections, { key: "", labelKey: "" }]);
          focus(...first(sections.length));
        }}
      >
        {t("admin.config.section.add")}
      </button>
    </div>
  );
}

function FieldsEditor({
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
  const { doc } = useDraft();
  const focus = useFocusRequest();
  const [gen, bump] = useGeneration();
  const fields = asObjects(type.fields);
  const labelText = useLabelText();
  const sectionList = asObjects(type.sections);
  const sectionKeys = [...new Set(sectionList.map((s) => str(s.key)).filter((k) => k !== ""))];
  // A section reads as its label in the field's select; its key while it has none.
  const sectionNames = sectionKeys.map((k) => {
    const text = labelText(sectionList.find((s) => str(s.key) === k)?.labelKey);
    return text === "" ? k : text;
  });
  const picklistIds = asObjects((doc as JsonObject | null)?.picklists)
    .map((p) => str(p.id))
    .filter((id) => id !== "");
  const owner = (i: number) => controlId(idPrefix, [...path, i]);
  const listOwner = controlId(idPrefix, path);
  // Row handlers read the latest list, so memoized rows never act on a stale copy.
  const latest = useRef({ fields, path, owner, listOwner });
  // Written after commit (the #392 pattern), so a discarded render never leaks into a handler.
  useLayoutEffect(() => {
    latest.current = { fields, path, owner, listOwner };
  });
  const onMove = useCallback(
    (from: number, to: number) => {
      const { fields: list, path: at, owner: own } = latest.current;
      bump();
      setPath(at, moved(list, from, to));
      focus([own(to), from > to ? "up" : "down"], [own(to), from > to ? "down" : "up"]);
    },
    [bump, setPath, focus],
  );
  const onRemove = useCallback(
    (index: number) => {
      const { fields: list, path: at, owner: own, listOwner: add } = latest.current;
      bump();
      const next = list.filter((_, j) => j !== index);
      setPath(at, next);
      const k = own(Math.min(index, next.length - 1));
      focus([k, "first"], [k, "key"], [add, "add"]);
    },
    [bump, setPath, focus],
  );
  return (
    <div className="qm-admin__list">
      {fields.map((field, i) => (
        <FieldRow
          key={`${owner(i)}:${gen}`}
          field={field}
          path={[...path, i]}
          owner={owner(i)}
          index={i}
          count={fields.length}
          sectionKeys={sectionKeys}
          sectionNames={sectionNames}
          picklistIds={picklistIds}
          idPrefix={idPrefix}
          onMove={onMove}
          onRemove={onRemove}
        />
      ))}
      <button
        type="button"
        className="qm-button"
        data-owner={listOwner}
        data-role="add"
        onClick={() => {
          setPath(path, [...fields, newField(sectionKeys[0] ?? "base")]);
          focus([owner(fields.length), "first"], [owner(fields.length), "key"]);
        }}
      >
        {t("admin.config.field.add")}
      </button>
    </div>
  );
}

interface FieldRowProps {
  field: Obj;
  path: readonly PathSegment[];
  owner: string;
  index: number;
  count: number;
  sectionKeys: readonly string[];
  /** What each section reads as, in sectionKeys order. */
  sectionNames: readonly string[];
  picklistIds: readonly string[];
  idPrefix: string;
  onMove(from: number, to: number): void;
  onRemove(index: number): void;
}

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * One field row. setAtPath keeps an untouched field's identity, so a keystroke re-renders only
 * the edited row, not every field of the type (render cost under load, PR1 verify).
 */
const FieldRow = memo(
  function FieldRow({
    field,
    path,
    owner,
    index,
    count,
    onMove,
    onRemove,
    ...rest
  }: FieldRowProps) {
    const t = useT();
    return (
      <fieldset className="qm-admin__item" data-path={toPointer(path)}>
        <ItemLegend
          labelKey={field.labelKey}
          keyText={
            str(field.key) === "" ? "" : t("admin.config.field.keyText", { key: str(field.key) })
          }
          fallback={t("admin.config.field.new")}
        />
        <FieldControls field={field} path={path} owner={owner} {...rest} />
        <ItemButtons
          owner={owner}
          name={str(field.key)}
          index={index}
          count={count}
          removeLabel={t("admin.config.field.remove")}
          onMove={onMove}
          onRemove={onRemove}
        />
      </fieldset>
    );
  },
  (a, b) =>
    a.field === b.field &&
    a.owner === b.owner &&
    a.index === b.index &&
    a.count === b.count &&
    a.idPrefix === b.idPrefix &&
    a.onMove === b.onMove &&
    a.onRemove === b.onRemove &&
    sameList(a.path, b.path) &&
    sameList(a.sectionKeys, b.sectionKeys) &&
    sameList(a.sectionNames, b.sectionNames) &&
    sameList(a.picklistIds, b.picklistIds),
);

function FieldControls({
  field,
  path,
  owner,
  sectionKeys,
  sectionNames,
  picklistIds,
  idPrefix,
}: {
  field: Obj;
  path: readonly PathSegment[];
  owner: string;
  sectionKeys: readonly string[];
  sectionNames: readonly string[];
  picklistIds: readonly string[];
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const kind = kindOf(field.dataType);
  const defaultPath = [...path, "defaultValue"];
  const defaultLabel = t("admin.config.field.defaultValue");
  const key = str(field.key);
  return (
    <>
      <LabelTextControls idPrefix={idPrefix} path={path} labelKey={field.labelKey} owner={owner} />
      <SelectControl
        idPrefix={idPrefix}
        path={[...path, "dataType"]}
        label={t("admin.config.field.inputType")}
        value={field.dataType}
        options={DATA_TYPES}
        optionLabel={(o) => t(`admin.config.dataType.${o}`)}
        onValue={(next) => {
          const dataType = (next ?? "string") as DataType;
          const { picklist, defaultValue, ...rest } = field;
          setPath(path, {
            ...rest,
            dataType,
            ...(dataType === "picklist" && picklist !== undefined ? { picklist } : {}),
            ...(kindOf(dataType) === kind && defaultValue !== undefined ? { defaultValue } : {}),
          });
        }}
      />
      {field.dataType === "picklist" && (
        <SelectControl
          idPrefix={idPrefix}
          path={[...path, "picklist"]}
          label={t("admin.config.field.choices")}
          value={field.picklist}
          options={picklistIds}
          blank={t("admin.config.none")}
        />
      )}
      <CheckControl
        idPrefix={idPrefix}
        path={[...path, "required"]}
        label={t("admin.config.field.required")}
        value={field.required}
      />
      <CheckControl
        idPrefix={idPrefix}
        path={[...path, "visible"]}
        label={t("admin.config.field.shown")}
        value={field.visible}
      />
      {kind === "number" ? (
        <NumberControl
          idPrefix={idPrefix}
          path={defaultPath}
          label={defaultLabel}
          value={field.defaultValue}
          optional
        />
      ) : kind === "boolean" ? (
        <SelectControl
          idPrefix={idPrefix}
          path={defaultPath}
          label={defaultLabel}
          value={field.defaultValue === undefined ? "" : String(field.defaultValue)}
          options={["true", "false"]}
          optionLabel={(o) => t(o === "true" ? "admin.config.yes" : "admin.config.no")}
          blank={t("admin.config.none")}
          onValue={(next) => setPath(defaultPath, next === undefined ? undefined : next === "true")}
        />
      ) : (
        <TextControl
          idPrefix={idPrefix}
          path={defaultPath}
          label={defaultLabel}
          value={field.defaultValue}
          optional
        />
      )}
      <SelectControl
        idPrefix={idPrefix}
        path={[...path, "section"]}
        label={t("admin.config.field.section")}
        value={field.section}
        options={sectionKeys}
        optionLabel={(k) => sectionNames[sectionKeys.indexOf(k)] ?? k}
        blank={t("admin.config.none")}
      />
      <Advanced
        path={path}
        keys={[
          "key",
          "labelKey",
          "transform",
          "pattern",
          ...Object.keys(field).filter((k) => !FIELD_KEYS.has(k)),
        ]}
        attention={key === "" || str(field.labelKey) === ""}
      >
        <TextControl
          idPrefix={idPrefix}
          path={[...path, "key"]}
          label={t("admin.config.field.key")}
          value={field.key}
          owner={owner}
          focusRole="key"
        />
        <TextControl
          idPrefix={idPrefix}
          path={[...path, "labelKey"]}
          label={t("admin.config.labelKey")}
          value={field.labelKey}
        />
        <SelectControl
          idPrefix={idPrefix}
          path={[...path, "transform"]}
          label={t("admin.config.field.transform")}
          value={field.transform ?? "none"}
          options={TRANSFORMS}
          optionLabel={(o) => t(`admin.config.transform.${o}`)}
        />
        <TextControl
          idPrefix={idPrefix}
          path={[...path, "pattern"]}
          label={t("admin.config.field.pattern")}
          value={field.pattern}
          optional
        />
        <MoreSettings item={field} path={path} covered={FIELD_KEYS} idPrefix={idPrefix} />
      </Advanced>
    </>
  );
}
