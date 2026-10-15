import type { DraftValue, RequestEntry, SubmittedQuery } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { compileQueryType, optionsFor } from "@querymodule/core/rules";

/** What the current config no longer has of a failed request: a whole type, a field, a choice or a source. */
export interface DroppedItem {
  kind: "type" | "field" | "choice" | "source";
  /** The type code, field key or source id. Never a value the user typed. */
  key: string;
}

export interface EditAsNewPlan {
  /** The type to open, or null when the config no longer has it (nothing is loaded then). */
  queryType: string | null;
  values: Readonly<Record<string, DraftValue>>;
  sourceIds: readonly string[];
  dropped: readonly DroppedItem[];
}

type Translate = (
  key: string,
  params?: Readonly<Record<string, string | number | boolean>>,
) => string;

/**
 * What a row can be edited from (G32: every row offers the action). A row this browser sent kept its
 * own values. A row listed after a reload has none, so it is rebuilt from the primary part's planned
 * values, the server's visible effective values, and the sources the request went to or the planner
 * dropped. Undefined while those have not arrived, for a purged part and for a row still sending.
 * Memory only; never logged.
 */
export function submittedOf(entry: RequestEntry): SubmittedQuery | undefined {
  if (entry.submitted !== undefined) return entry.submitted;
  if (entry.status !== "acknowledged") return undefined;
  const primary = entry.parts.find((part) => part.parentPartId === null);
  if (primary?.values === undefined) return undefined;
  const values: Record<string, DraftValue> = {};
  for (const [key, value] of Object.entries(primary.values)) {
    if (typeof value === "string" || typeof value === "boolean") values[key] = value;
    else if (typeof value === "number") values[key] = String(value);
  }
  return {
    queryType: entry.queryType,
    values,
    sourceIds: [...primary.sources.map((s) => s.sourceId), ...primary.droppedSourceIds],
    mode: "normal",
  };
}

/**
 * What an "Edit as new query" loads: the row's kept values under the config the panel has now
 * (#477). A value is dropped when its field is gone, or when it is a picklist choice the config no
 * longer offers (after its filter parent, as the form would offer it). Empty values are nothing to
 * drop. Pure: the row's own values are never changed, and nothing is written anywhere.
 */
export function planEditAsNew(config: ClientSiteConfig, submitted: SubmittedQuery): EditAsNewPlan {
  const dropped: DroppedItem[] = [];
  const compiled = compileQueryType(config, submitted.queryType, Date.now());
  if (compiled === undefined) {
    return {
      queryType: null,
      values: {},
      sourceIds: [],
      dropped: [{ kind: "type", key: submitted.queryType }],
    };
  }
  const kept: Record<string, DraftValue> = {};
  const isEmpty = (value: DraftValue | undefined): boolean =>
    value === undefined || value === null || value === "";
  // Fields the config lost, in the order the row kept them.
  for (const [key, value] of Object.entries(submitted.values)) {
    if (!compiled.fieldByKey.has(key) && !isEmpty(value)) dropped.push({ kind: "field", key });
  }
  // The rest in the form's own order, so a filtered picklist sees its parent's kept value.
  for (const key of compiled.canonOrder) {
    const field = compiled.fieldByKey.get(key);
    const value = submitted.values[key];
    if (field === undefined || value === undefined) continue;
    if (isEmpty(value)) {
      kept[key] = value;
      continue;
    }
    if (field.def.dataType === "picklist" && typeof value === "string") {
      const parentKey = field.def.picklistFilter?.byField;
      const parent = parentKey === undefined ? undefined : compiled.fieldByKey.get(parentKey);
      const parentText = parent === undefined ? undefined : kept[parent.def.key];
      const parentValue =
        parent === undefined
          ? null
          : typeof parentText === "string" && parentText !== ""
            ? (parent.enabledValues.find((v) => v.code.toUpperCase() === parentText.toUpperCase())
                ?.code ?? null)
            : parent.configuredDefault;
      const offered = optionsFor(field, parentValue).some(
        (v) => v.code.toUpperCase() === value.toUpperCase(),
      );
      if (!offered) {
        dropped.push({ kind: "choice", key });
        continue;
      }
    }
    kept[key] = value;
  }
  const listed = new Set(config.sources.map((s) => s.id));
  for (const id of submitted.sourceIds)
    if (!listed.has(id)) dropped.push({ kind: "source", key: id });
  return {
    queryType: compiled.code,
    values: kept,
    sourceIds: submitted.sourceIds.filter((id) => listed.has(id)),
    dropped,
  };
}

/**
 * The sentence naming what was dropped, or null when nothing was. Names only: a field's label, a
 * type's label, never a value. `fieldName` and `typeName` turn a key into words; a field the
 * config no longer has falls back to its conventional label, else the key.
 */
export function editAsNewNote(
  dropped: readonly DroppedItem[],
  t: Translate,
  fieldName: (key: string) => string,
  typeName: (code: string) => string,
): string | null {
  if (dropped.length === 0) return null;
  // Several sources the config lost read as one item: the ids are not words a dispatcher knows.
  const named = dropped.filter(
    (item, index) =>
      item.kind !== "source" || dropped.findIndex((d) => d.kind === "source") === index,
  );
  const items = named.map((item) => {
    switch (item.kind) {
      case "field":
        return t("editAsNew.item.field", { label: fieldName(item.key) });
      case "choice":
        return t("editAsNew.item.choice", { label: fieldName(item.key) });
      case "type":
        return t("editAsNew.item.type", { type: typeName(item.key) });
      default:
        return t("editAsNew.item.source");
    }
  });
  return t("editAsNew.dropped", { items: items.join(", ") });
}
