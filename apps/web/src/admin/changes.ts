import type { Translator } from "@querymodule/client";
import { type ConfigChange, type DiffSegment, VALUE_IDENTITY } from "@querymodule/core/config";
import type { JsonObject } from "./draft.js";
import { defaultPointer, HIDDEN_KEYS, LABELS_ITEM } from "./selection.js";

/**
 * The Changes view's model (item 4): the core diff of the live config and the draft, as
 * plain-language groups. Pure: strings come in through `ChangeDeps`. Plain names lead and keys go
 * in `keyText`, which the view puts in hidden text (developer ruling). Nothing here writes.
 */

/** What one side of an entry shows: text, or a rule the view writes as a sentence. */
export type ChangeValue = { text: string } | { rule: JsonObject; type: JsonObject };

export interface ChangeEntry {
  id: string;
  kind: "added" | "removed" | "changed" | "moved";
  /** The plain name of what changed ("Required", "Rule"). */
  what: string;
  /** Keys, for screen readers only. */
  keyText: string;
  before?: ChangeValue;
  after?: ChangeValue;
  /** The item to open in the builder. */
  target: string;
}

export interface ChangeSection {
  id: string;
  /** Null for entries about the group itself (a query type added). */
  title: string | null;
  keyText: string;
  entries: ChangeEntry[];
}

export interface ChangeGroup {
  id: string;
  title: string;
  keyText: string;
  sections: ChangeSection[];
}

export interface ChangeDeps {
  t: Translator["t"];
  /** A label key's text in the language shown ("" when it has none). */
  labelText(labelKey: unknown): string;
  /** The plain name of a top-level item ("Terminal commands"). */
  itemName(key: string): string;
}

type Obj = JsonObject;
const objsOf = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const segText = (s: DiffSegment): string => (typeof s === "object" ? s.is : String(s));

/** Property names that already have plain words in the editors. */
const PROP_KEYS: Readonly<Record<string, string>> = {
  key: "admin.config.field.key",
  dataType: "admin.config.field.inputType",
  required: "admin.config.field.required",
  visible: "admin.config.field.shown",
  defaultValue: "admin.config.field.defaultValue",
  picklist: "admin.config.field.choices",
  transform: "admin.config.field.transform",
  pattern: "admin.config.field.pattern",
  section: "admin.config.field.section",
  allowPlateOnly: "admin.config.type.allowPlateOnly",
  enabled: "admin.config.picklist.enabled",
  parent: "admin.config.picklist.parent",
  queryType: "admin.config.command.queryType",
  presets: "admin.config.command.presets",
  positions: "admin.config.command.positions",
  labelKey: "admin.diff.prop.labelKey",
};

/** A config key as words: "maxLength" reads "Max length". */
function words(key: string): string {
  const text = key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MAX_SHOWN = 120;

/** The node a path names in a document (a keyed item by identity, a number by index). */
function walk(doc: unknown, path: readonly DiffSegment[]): unknown {
  let node = doc;
  for (const seg of path) {
    if (typeof seg === "object") {
      node = Array.isArray(node)
        ? node.find((i) => (seg.by === VALUE_IDENTITY ? i : isObj(i) && i[seg.by]) === seg.is)
        : undefined;
    } else if (typeof node === "object" && node !== null && Object.hasOwn(node, seg)) {
      node = (node as Record<string | number, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return node;
}

/** The node a JSON pointer names. */
function pointerNode(doc: unknown, segments: readonly string[]): unknown {
  return walk(
    doc,
    segments.map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~")),
  );
}

/**
 * The item the builder opens for a pointer: a query type, one of its fields or sections, or a
 * top-level setting. Rules, sources and the like are parts of their query type.
 */
export function targetOf(pointer: string, doc: Obj): string | null {
  const parts = pointer.split("/").slice(1);
  const top = parts[0];
  if (top === undefined) return null;
  // A setting the draft no longer has (deleted in the raw view), or one the builder hides, has no
  // item to open: the builder's own default is the nearest place.
  if (top !== "queryTypes")
    return top in doc && !HIDDEN_KEYS.has(top) ? `/${top}` : defaultPointer(doc);
  const index = parts[1];
  if (index === undefined || !/^[0-9]+$/.test(index)) return defaultPointer(doc);
  const type = `/queryTypes/${index}`;
  const inner = parts[2] === "fields" || parts[2] === "sections" ? parts[3] : undefined;
  return inner !== undefined && /^[0-9]+$/.test(inner) ? `${type}/${parts[2]}/${inner}` : type;
}

export function buildChangeGroups(
  changes: readonly ConfigChange[],
  live: Obj,
  draft: Obj,
  deps: ChangeDeps,
): ChangeGroup[] {
  const { t } = deps;
  const groups = new Map<string, ChangeGroup>();
  const group = (id: string, title: string, keyText: string) => {
    let g = groups.get(id);
    if (g === undefined) {
      g = { id, title, keyText, sections: [] };
      groups.set(id, g);
    }
    return g;
  };
  const section = (g: ChangeGroup, id: string, title: string | null, keyText = "") => {
    let s = g.sections.find((x) => x.id === id);
    if (s === undefined) {
      s = { id, title, keyText, entries: [] };
      g.sections.push(s);
    }
    return s;
  };
  const shown = (value: unknown, asLabel = false): ChangeValue => {
    if (value === undefined || value === null) return { text: t("admin.diff.none") };
    if (asLabel && typeof value === "string") {
      const text = deps.labelText(value);
      return { text: text === "" ? value : text };
    }
    if (typeof value === "boolean")
      return { text: t(value ? "admin.config.yes" : "admin.config.no") };
    if (typeof value === "string") return { text: value === "" ? t("admin.diff.empty") : value };
    if (typeof value === "number") return { text: String(value) };
    const json = JSON.stringify(value);
    return { text: json.length > MAX_SHOWN ? `${json.slice(0, MAX_SHOWN - 1)}…` : json };
  };
  const propName = (s: DiffSegment): string => {
    if (typeof s === "number") return t("admin.diff.itemN", { n: s + 1 });
    if (typeof s === "object") return s.is;
    return Object.hasOwn(PROP_KEYS, s) ? t(PROP_KEYS[s] as string) : words(s);
  };
  const plain = (path: readonly DiffSegment[]) => path.map(propName).join(" › ");
  const rulesSeen = new Set<string>();

  for (const change of changes) {
    const p = change.path;
    const top = p[0];
    if (typeof top !== "string") continue;
    const segments = change.pointer.split("/").slice(1);
    // The nodes on the path, before and after. A removed item has no draft node, and its
    // pointer is its holder's, so a draft node exists only for the part of the path it covers.
    const before = (n: number) => walk(live, p.slice(0, n));
    const after = (n: number) =>
      n <= segments.length ? pointerNode(draft, segments.slice(0, n)) : undefined;
    const kind = change.kind;
    const id = `${kind}:${JSON.stringify(p)}`;
    const target =
      targetOf(change.pointer, draft) ??
      (top === "queryTypes" || !(top in draft) || HIDDEN_KEYS.has(top)
        ? defaultPointer(draft)
        : `/${top}`);
    const values: { before?: ChangeValue; after?: ChangeValue } =
      kind === "moved"
        ? {}
        : {
            ...(kind === "removed" || kind === "changed" ? { before: shown(change.before) } : {}),
            ...(kind === "added" || kind === "changed" ? { after: shown(change.after) } : {}),
          };
    const entry = (what: string, keyText: string, withValues = true): ChangeEntry => ({
      id,
      kind,
      what,
      keyText,
      ...(withValues ? values : {}),
      target,
    });

    if (top === "queryTypes" && p.length >= 2) {
      const liveType = (before(2) ?? {}) as Obj;
      const draftType = (after(2) ?? {}) as Obj;
      const type = isObj(after(2)) ? draftType : liveType;
      const ref = p[1] as DiffSegment;
      const code = typeof ref === "object" ? ref.is : str(type.code);
      const name = deps.labelText(type.labelKey);
      // A type is known by its code, or by its place when the list cannot be matched by code
      // (duplicate or blank codes); a type added whole is numbered in the draft, not the live list.
      const typeKey =
        typeof ref === "object"
          ? ref.is
          : `#${kind === "added" && p.length === 2 ? "d" : "l"}${ref}`;
      const g = group(
        `type:${typeKey}`,
        name !== ""
          ? name
          : code !== ""
            ? code
            : t("admin.diff.unnamed", { what: t("admin.diff.item.queryType") }),
        code,
      );
      const area = p[2];
      if (p.length === 2) {
        section(g, "type", null).entries.push(entry(t("admin.diff.item.queryType"), code, false));
      } else if (area === "rules" && p.length === 3) {
        // The list itself: reordered, or added or removed whole (a raw edit).
        section(g, "rules", t("admin.diff.section.rules")).entries.push(
          entry(
            kind === "moved" ? t("admin.diff.order") : plain(p.slice(2)),
            "rules",
            kind !== "moved",
          ),
        );
      } else if (area === "rules") {
        // One entry per rule, however many of its parts changed: the rule reads as a sentence.
        const index = segments[3];
        // A rule is known by its place in the live list; only a rule added whole has none.
        const whole = p.length === 4;
        const key = `rule:${typeKey}:${whole && kind === "added" ? `draft${index}` : segText(p[3] as DiffSegment)}`;
        if (rulesSeen.has(key)) continue;
        rulesSeen.add(key);
        const liveRule = before(4);
        const draftRule = whole && kind === "removed" ? undefined : after(4);
        const rule: ChangeEntry = {
          id: key,
          kind: whole ? kind : "changed",
          what: t("admin.diff.item.rule"),
          keyText: `rule ${Number(segText(p[3] as DiffSegment)) + 1}`,
          ...(isObj(liveRule) && !(whole && kind === "added")
            ? { before: { rule: liveRule, type: liveType } }
            : {}),
          ...(isObj(draftRule) ? { after: { rule: draftRule, type: draftType } } : {}),
          target,
        };
        section(g, "rules", t("admin.diff.section.rules")).entries.push(rule);
      } else if (area === "fields" || area === "sections") {
        const isField = area === "fields";
        if (p.length === 3) {
          section(g, area, t(`admin.diff.section.${area}`)).entries.push(
            entry(
              kind === "moved" ? t("admin.diff.order") : plain(p.slice(2)),
              area,
              kind !== "moved",
            ),
          );
        } else {
          const item = (isObj(after(4)) ? after(4) : before(4)) as Obj | undefined;
          const ref4 = p[3] as DiffSegment;
          const key = typeof ref4 === "object" ? ref4.is : str(item?.key);
          const label = deps.labelText(item?.labelKey);
          const inner = p.slice(4);
          const sect = section(
            g,
            `${area}:${typeof ref4 === "object" ? ref4.is : `#${kind === "added" && p.length === 4 ? "d" : "l"}${ref4}`}`,
            t(isField ? "admin.diff.fieldOf" : "admin.diff.sectionOf", {
              name: label !== "" ? label : key !== "" ? key : t("admin.diff.unnamedShort"),
            }),
            key,
          );
          const labelKeyChange = inner.length === 1 && inner[0] === "labelKey";
          sect.entries.push({
            ...entry(
              inner.length === 0
                ? t(isField ? "admin.diff.item.field" : "admin.diff.item.section")
                : plain(inner),
              [key, ...inner.map(segText)].join(" "),
              inner.length > 0,
            ),
            ...(labelKeyChange
              ? {
                  ...(kind === "removed" || kind === "changed"
                    ? { before: shown(change.before, true) }
                    : {}),
                  ...(kind === "added" || kind === "changed"
                    ? { after: shown(change.after, true) }
                    : {}),
                }
              : {}),
          });
        }
      } else {
        const list = area === "sources" || area === "alsoRun" ? area : "settings";
        const detail = p.slice(2);
        section(g, list, t(`admin.diff.section.${list}`)).entries.push(
          entry(plain(detail), detail.map(segText).join(" "), kind !== "moved"),
        );
      }
      continue;
    }

    if ((top === "picklists" || top === "commands") && p.length >= 2) {
      const ref = p[1] as DiffSegment;
      // A new list or command has no id or code yet: it is known by its place, and named so.
      const id1 = typeof ref === "object" ? ref.is : "";
      const isList = top === "picklists";
      const g = group(
        `${top}:${id1 === "" ? `new:${segText(ref)}` : id1}`,
        t(isList ? "admin.diff.list" : "admin.diff.command", {
          name: id1 !== "" ? id1 : t("admin.diff.unnamedShort"),
        }),
        id1,
      );
      const detail = p.slice(2);
      const valueRef = isList && detail[0] === "values" ? detail[1] : undefined;
      if (valueRef === undefined) {
        section(g, "own", null).entries.push(
          entry(
            detail.length === 0
              ? t(isList ? "admin.diff.item.list" : "admin.diff.item.command")
              : plain(detail),
            [id1, ...detail.map(segText)].join(" "),
            detail.length > 0,
          ),
        );
      } else {
        const value = (isObj(after(4)) ? after(4) : before(4)) as Obj | undefined;
        const text = deps.labelText(value?.labelKey);
        const code = typeof valueRef === "object" ? valueRef.is : "";
        const inner = detail.slice(2);
        section(
          g,
          `value:${code === "" ? `new:${segText(valueRef)}` : code}`,
          t("admin.diff.value", {
            name: text !== "" ? text : code !== "" ? code : t("admin.diff.unnamedShort"),
          }),
          code,
        ).entries.push(
          entry(
            inner.length === 0 ? t("admin.diff.item.value") : plain(inner),
            [id1, code, ...inner.map(segText)].join(" "),
            inner.length > 0,
          ),
        );
      }
      continue;
    }

    const g = group(`site:${top}`, deps.itemName(top), top);
    const rest = p.slice(1);
    // A list that only changed its order has nothing else to name.
    const reordered =
      kind === "moved" || (rest.length === 0 && kind !== "added" && kind !== "removed");
    const what =
      top === "quickAccess" && !reordered
        ? t("admin.diff.item.button")
        : reordered || rest.length === 0
          ? t(reordered ? "admin.diff.order" : "admin.diff.item.setting")
          : plain(rest);
    // Quick access holds query type codes: they read as the types' names.
    const typeName = (code: unknown): ChangeValue => {
      const type = objsOf(draft.queryTypes)
        .concat(objsOf(live.queryTypes))
        .find((x) => x.code === code);
      const name = type === undefined ? "" : deps.labelText(type.labelKey);
      return { text: name !== "" ? name : String(code) };
    };
    const quick: { before?: ChangeValue; after?: ChangeValue } =
      top === "quickAccess" && kind !== "moved"
        ? {
            ...(kind === "removed" || kind === "changed"
              ? { before: typeName(change.before) }
              : {}),
            ...(kind === "added" || kind === "changed" ? { after: typeName(change.after) } : {}),
          }
        : {};
    // A reordered list of plain strings (quick access): the order is the point, so show the whole
    // list before and after, each code by the type's name.
    const listText = (list: unknown): ChangeValue | undefined =>
      Array.isArray(list) && list.every((x) => typeof x === "string")
        ? { text: list.map((x) => (top === "quickAccess" ? typeName(x).text : x)).join(", ") }
        : undefined;
    const order =
      change.kind === "moved" && change.by === VALUE_IDENTITY
        ? { before: listText(before(p.length)), after: listText(after(segments.length)) }
        : {};
    section(g, "own", null).entries.push({
      ...entry(what, p.map(segText).join(" "), !reordered),
      ...quick,
      ...Object.fromEntries(Object.entries(order).filter(([, v]) => v !== undefined)),
    });
  }

  return [...groups.values()];
}

/** One locale's draft label texts against the shipped text (known only in the language shown). */
export interface LabelChange {
  locale: string;
  key: string;
  text: string;
  /** The shipped text this replaces: "" when there is none, null when it is not known here. */
  shipped: string | null;
}

/** The draft's label overlay as one group: the wording it changes or adds, per language. */
export function labelGroup(
  labels: readonly LabelChange[],
  language: (locale: string) => string,
  t: Translator["t"],
): ChangeGroup | null {
  // Every overlay entry is a draft change, even one the same as the shipped text.
  const kept = labels;
  if (kept.length === 0) return null;
  return {
    id: "labels",
    title: t("admin.config.site.labels"),
    keyText: "labels",
    sections: [
      {
        id: "own",
        title: null,
        keyText: "",
        entries: kept.map((l) => {
          return {
            id: `label:${l.locale}:${l.key}`,
            kind:
              l.shipped !== null && l.shipped !== "" && l.shipped !== l.text ? "changed" : "added",
            what: t("admin.diff.labelText", { language: language(l.locale) }),
            keyText: l.key,
            ...(l.shipped !== null && l.shipped !== "" && l.shipped !== l.text
              ? { before: { text: l.shipped } }
              : {}),
            after: { text: l.text === "" ? t("admin.diff.empty") : l.text },
            target: LABELS_ITEM,
          } satisfies ChangeEntry;
        }),
      },
    ],
  };
}

/** A label key the draft uses that has no text in a language. */
export interface MissingLabel {
  labelKey: string;
  locale: string;
  pointer: string;
}

export interface MissingGroup {
  /** The item that holds the label, in plain words. */
  owner: string;
  labelKey: string;
  languages: string[];
  target: string;
}

/**
 * Label keys the config uses with no text, one row per key: which item holds it and in which
 * languages the text is missing. These already count as errors; this lists them in one place.
 */
export function missingLabels(
  missing: readonly MissingLabel[],
  draft: Obj,
  language: (locale: string) => string,
  owner: (pointer: string) => string,
): MissingGroup[] {
  const byKey = new Map<string, MissingGroup>();
  for (const m of missing) {
    const found = byKey.get(m.labelKey);
    if (found !== undefined) {
      if (!found.languages.includes(language(m.locale))) found.languages.push(language(m.locale));
      continue;
    }
    byKey.set(m.labelKey, {
      owner: owner(m.pointer),
      labelKey: m.labelKey,
      languages: [language(m.locale)],
      target: targetOf(m.pointer, draft) ?? defaultPointer(draft),
    });
  }
  return [...byKey.values()];
}

/** The item that holds a label key, in words: a field's label, a type's, else the setting's name. */
export function ownerName(
  draft: Obj,
  pointer: string,
  deps: Pick<ChangeDeps, "labelText" | "itemName">,
): string {
  const parts = pointer.split("/").slice(1);
  const top = parts[0] ?? "";
  if (top === "queryTypes") {
    const upTo = (n: number) => pointerNode(draft, parts.slice(0, n)) as Obj | undefined;
    const item = parts[2] === "fields" || parts[2] === "sections" ? upTo(4) : upTo(2);
    const name = deps.labelText(item?.labelKey);
    return name !== "" ? name : str(item?.key) || str(item?.code) || deps.itemName(top);
  }
  return deps.itemName(top);
}
