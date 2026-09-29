import { DATA_TYPES, type DataType } from "@querymodule/core/config";
import { useEffect, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useDraft } from "./builder-store.js";
import {
  asObjects,
  CheckControl,
  controlId,
  ItemButtons,
  LabelTextControls,
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
import type { JsonObject, PathSegment } from "./draft.js";
import { NodeEditor } from "./GenericForm.js";

/**
 * Task 31 part 2 (#355): purpose-built editors for query types, their sections and their fields
 * (FR-060). Keys without a purpose-built control stay editable through the generic form, so the
 * editors never hide part of the config.
 */

const TYPE_KEYS = new Set(["code", "labelKey", "allowPlateOnly", "sections", "fields"]);
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

/** The generic form for the keys an editor does not cover. */
function OtherKeys({
  item,
  path,
  covered,
  idPrefix,
}: {
  item: Obj;
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

/** Settings without a purpose-built control, rendered when opened. */
function MoreSettings(props: Parameters<typeof OtherKeys>[0]) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("admin.config.moreSettings")}</summary>
      {open && <OtherKeys {...props} />}
    </details>
  );
}

/** Every query type opens on demand: only open types render their controls on each draft edit. */
export function QueryTypesEditor({ value, idPrefix }: { value: unknown; idPrefix: string }) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const focus = useFocusRequest();
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set());
  const [gen, bump] = useGeneration();
  // A count change this editor did not make (the raw tab) closes every type: indexes moved (critic M1).
  const ownCount = useRef<number | null>(null);
  const types = asObjects(value);
  const path = ["queryTypes"] as const;
  useEffect(() => {
    if (ownCount.current !== null && ownCount.current !== types.length) {
      setOpened(new Set());
      bump();
    }
    ownCount.current = types.length;
  }, [types.length, bump]);
  const owner = (i: number) => controlId(idPrefix, [...path, i]);
  const listOwner = controlId(idPrefix, path);
  const setOpen = (i: number, open: boolean) =>
    setOpened((s) => {
      if (s.has(i) === open) return s;
      const next = new Set(s);
      if (open) next.add(i);
      else next.delete(i);
      return next;
    });
  return (
    <div>
      {types.map((type, i) => (
        <details
          key={`${owner(i)}:${gen}`}
          open={opened.has(i)}
          onToggle={(e) => setOpen(i, e.currentTarget.open)}
        >
          <summary data-owner={owner(i)} data-role="summary">
            {t("admin.config.type.legend", { code: str(type.code) })}
          </summary>
          {opened.has(i) && (
            <QueryTypeEditor
              type={type}
              path={[...path, i]}
              owner={owner(i)}
              idPrefix={idPrefix}
              onRemove={() => {
                const next = types.filter((_, j) => j !== i);
                ownCount.current = next.length;
                bump();
                setPath(path, next);
                setOpened(
                  (s) => new Set([...s].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))),
                );
                const k = Math.min(i, next.length - 1);
                focus([owner(k), "first"], [owner(k), "summary"], [listOwner, "add"]);
              }}
            />
          )}
        </details>
      ))}
      <button
        type="button"
        className="qm-button"
        data-owner={listOwner}
        data-role="add"
        onClick={() => {
          ownCount.current = types.length + 1;
          setPath(path, [...types, newType()]);
          setOpen(types.length, true);
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
    <fieldset className="qm-admin__item">
      <legend>{t("admin.config.type.legend", { code })}</legend>
      <TextControl
        idPrefix={idPrefix}
        path={[...path, "code"]}
        label={t("admin.config.code")}
        value={type.code}
        owner={owner}
      />
      <TextControl
        idPrefix={idPrefix}
        path={[...path, "labelKey"]}
        label={t("admin.config.labelKey")}
        value={type.labelKey}
      />
      <LabelTextControls idPrefix={idPrefix} path={path} labelKey={type.labelKey} />
      <CheckControl
        idPrefix={idPrefix}
        path={[...path, "allowPlateOnly"]}
        label={t("admin.config.type.allowPlateOnly")}
        value={type.allowPlateOnly}
      />
      <SectionsEditor
        sections={asObjects(type.sections)}
        path={[...path, "sections"]}
        idPrefix={idPrefix}
      />
      <FieldsEditor type={type} path={[...path, "fields"]} idPrefix={idPrefix} />
      <OtherKeys item={type} path={path} covered={TYPE_KEYS} idPrefix={idPrefix} />
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

function SectionsEditor({
  sections,
  path,
  idPrefix,
}: {
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
  return (
    <fieldset>
      <legend>{t("admin.config.sections")}</legend>
      {sections.map((section, i) => {
        const itemPath = [...path, i];
        const key = str(section.key);
        return (
          <fieldset key={`${owner(i)}:${gen}`} className="qm-admin__item">
            <legend>{t("admin.config.section.legend", { key })}</legend>
            <TextControl
              idPrefix={idPrefix}
              path={[...itemPath, "key"]}
              label={t("admin.config.section.key")}
              value={section.key}
              owner={owner(i)}
            />
            <TextControl
              idPrefix={idPrefix}
              path={[...itemPath, "labelKey"]}
              label={t("admin.config.labelKey")}
              value={section.labelKey}
            />
            <LabelTextControls idPrefix={idPrefix} path={itemPath} labelKey={section.labelKey} />
            <OtherKeys
              item={section}
              path={itemPath}
              covered={new Set(["key", "labelKey"])}
              idPrefix={idPrefix}
            />
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
          setPath(path, [...sections, { key: "", labelKey: "" }]);
          focus([owner(sections.length), "first"]);
        }}
      >
        {t("admin.config.section.add")}
      </button>
    </fieldset>
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
  const focus = useFocusRequest();
  const [gen, bump] = useGeneration();
  const fields = asObjects(type.fields);
  const sectionKeys = [
    ...new Set(
      asObjects(type.sections)
        .map((s) => str(s.key))
        .filter((k) => k !== ""),
    ),
  ];
  const owner = (i: number) => controlId(idPrefix, [...path, i]);
  const listOwner = controlId(idPrefix, path);
  return (
    <fieldset>
      <legend>{t("admin.config.fields")}</legend>
      {fields.map((field, i) => (
        <fieldset key={`${owner(i)}:${gen}`} className="qm-admin__item">
          <legend>{t("admin.config.field.legend", { key: str(field.key) })}</legend>
          <FieldControls
            field={field}
            path={[...path, i]}
            owner={owner(i)}
            sectionKeys={sectionKeys}
            idPrefix={idPrefix}
          />
          <ItemButtons
            owner={owner(i)}
            name={str(field.key)}
            index={i}
            count={fields.length}
            removeLabel={t("admin.config.field.remove")}
            onMove={(from, to) => {
              bump();
              setPath(path, moved(fields, from, to));
              focus([owner(to), from > to ? "up" : "down"], [owner(to), from > to ? "down" : "up"]);
            }}
            onRemove={(at) => {
              bump();
              const next = fields.filter((_, j) => j !== at);
              setPath(path, next);
              focus([owner(Math.min(at, next.length - 1)), "first"], [listOwner, "add"]);
            }}
          />
        </fieldset>
      ))}
      <button
        type="button"
        className="qm-button"
        data-owner={listOwner}
        data-role="add"
        onClick={() => {
          setPath(path, [...fields, newField(sectionKeys[0] ?? "base")]);
          focus([owner(fields.length), "first"]);
        }}
      >
        {t("admin.config.field.add")}
      </button>
    </fieldset>
  );
}

function FieldControls({
  field,
  path,
  owner,
  sectionKeys,
  idPrefix,
}: {
  field: Obj;
  path: readonly PathSegment[];
  owner: string;
  sectionKeys: readonly string[];
  idPrefix: string;
}) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const { doc } = useDraft();
  const picklistIds = asObjects((doc as JsonObject | null)?.picklists)
    .map((p) => str(p.id))
    .filter((id) => id !== "");
  const kind = kindOf(field.dataType);
  const defaultPath = [...path, "defaultValue"];
  const defaultLabel = t("admin.config.field.defaultValue");
  return (
    <>
      <TextControl
        idPrefix={idPrefix}
        path={[...path, "key"]}
        label={t("admin.config.field.key")}
        value={field.key}
        owner={owner}
      />
      <TextControl
        idPrefix={idPrefix}
        path={[...path, "labelKey"]}
        label={t("admin.config.labelKey")}
        value={field.labelKey}
      />
      <LabelTextControls idPrefix={idPrefix} path={path} labelKey={field.labelKey} />
      <SelectControl
        idPrefix={idPrefix}
        path={[...path, "dataType"]}
        label={t("admin.config.field.dataType")}
        value={field.dataType}
        options={DATA_TYPES}
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
      <CheckControl
        idPrefix={idPrefix}
        path={[...path, "required"]}
        label={t("admin.config.field.required")}
        value={field.required}
      />
      <CheckControl
        idPrefix={idPrefix}
        path={[...path, "visible"]}
        label={t("admin.config.field.visible")}
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
      {field.dataType === "picklist" && (
        <SelectControl
          idPrefix={idPrefix}
          path={[...path, "picklist"]}
          label={t("admin.config.field.picklist")}
          value={field.picklist}
          options={picklistIds}
          blank={t("admin.config.none")}
        />
      )}
      <SelectControl
        idPrefix={idPrefix}
        path={[...path, "transform"]}
        label={t("admin.config.field.transform")}
        value={field.transform ?? "none"}
        options={TRANSFORMS}
      />
      <TextControl
        idPrefix={idPrefix}
        path={[...path, "pattern"]}
        label={t("admin.config.field.pattern")}
        value={field.pattern}
        optional
      />
      <SelectControl
        idPrefix={idPrefix}
        path={[...path, "section"]}
        label={t("admin.config.field.section")}
        value={field.section}
        options={sectionKeys}
        blank={t("admin.config.none")}
      />
      <MoreSettings item={field} path={path} covered={FIELD_KEYS} idPrefix={idPrefix} />
    </>
  );
}
