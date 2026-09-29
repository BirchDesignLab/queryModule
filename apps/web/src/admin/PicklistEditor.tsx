import { useT } from "../app/i18n-context.js";
import {
  asObjects,
  CheckControl,
  controlId,
  ItemButtons,
  LabelTextControls,
  moved,
  type Obj,
  str,
  TextControl,
  useDraftSetters,
  useFocusRequest,
  useGeneration,
} from "./controls.js";
import type { PathSegment } from "./draft.js";

/** Task 31 part 2 (#355): picklists, their values, value labels and enabled flags (FR-060). */

const newValue = (): Obj => ({ code: "", labelKey: "", enabled: true });

export function PicklistsEditor({ value, idPrefix }: { value: unknown; idPrefix: string }) {
  const t = useT();
  const { setPath } = useDraftSetters();
  const focus = useFocusRequest();
  const [gen, bump] = useGeneration();
  const lists = asObjects(value);
  const path = ["picklists"] as const;
  const owner = (i: number) => controlId(idPrefix, [...path, i]);
  const listOwner = controlId(idPrefix, path);
  return (
    <div>
      {lists.map((list, i) => {
        const id = str(list.id);
        return (
          <fieldset key={`${owner(i)}:${gen}`} className="qm-admin__item">
            <legend>{t("admin.config.picklist.legend", { id })}</legend>
            <TextControl
              idPrefix={idPrefix}
              path={[...path, i, "id"]}
              label={t("admin.config.picklist.id")}
              value={list.id}
              owner={owner(i)}
            />
            <ValuesEditor
              values={asObjects(list.values)}
              path={[...path, i, "values"]}
              idPrefix={idPrefix}
            />
            <ItemButtons
              owner={owner(i)}
              name={id}
              index={0}
              count={1}
              movable={false}
              removeLabel={t("admin.config.picklist.remove")}
              onRemove={() => {
                bump();
                const next = lists.filter((_, j) => j !== i);
                setPath(path, next);
                focus([owner(Math.min(i, next.length - 1)), "first"], [listOwner, "add"]);
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
          setPath(path, [...lists, { id: "", values: [newValue()] }]);
          focus([owner(lists.length), "first"]);
        }}
      >
        {t("admin.config.picklist.add")}
      </button>
    </div>
  );
}

function ValuesEditor({
  values,
  path,
  idPrefix,
}: {
  values: Obj[];
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
      <legend>{t("admin.config.picklist.values")}</legend>
      {values.map((value, i) => {
        const itemPath = [...path, i];
        const code = str(value.code);
        return (
          <fieldset key={`${owner(i)}:${gen}`} className="qm-admin__item">
            <legend>{t("admin.config.picklist.value", { code })}</legend>
            <TextControl
              idPrefix={idPrefix}
              path={[...itemPath, "code"]}
              label={t("admin.config.code")}
              value={value.code}
              owner={owner(i)}
            />
            <TextControl
              idPrefix={idPrefix}
              path={[...itemPath, "labelKey"]}
              label={t("admin.config.labelKey")}
              value={value.labelKey}
            />
            <LabelTextControls idPrefix={idPrefix} path={itemPath} labelKey={value.labelKey} />
            <CheckControl
              idPrefix={idPrefix}
              path={[...itemPath, "enabled"]}
              label={t("admin.config.picklist.enabled")}
              value={value.enabled ?? true}
            />
            <TextControl
              idPrefix={idPrefix}
              path={[...itemPath, "parent"]}
              label={t("admin.config.picklist.parent")}
              value={value.parent}
              optional
            />
            <ItemButtons
              owner={owner(i)}
              name={code}
              index={i}
              count={values.length}
              removeLabel={t("admin.config.picklist.removeValue")}
              onMove={(from, to) => {
                bump();
                setPath(path, moved(values, from, to));
                focus(
                  [owner(to), from > to ? "up" : "down"],
                  [owner(to), from > to ? "down" : "up"],
                );
              }}
              onRemove={(at) => {
                bump();
                const next = values.filter((_, j) => j !== at);
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
          setPath(path, [...values, newValue()]);
          focus([owner(values.length), "first"]);
        }}
      >
        {t("admin.config.picklist.addValue")}
      </button>
    </fieldset>
  );
}
