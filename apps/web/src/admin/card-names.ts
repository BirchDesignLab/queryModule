import { useCallback, useMemo } from "react";
import { useT } from "../app/i18n-context.js";
import { asObjects, type Obj, str, useLabelText } from "./controls.js";
import type { JsonObject } from "./draft.js";

const CARD_POINTER = /^\/responseMappings\/([0-9]+)(\/|$)/;

/** The card index a pointer is in or at, else null. */
export function cardIndexOf(pointer: string | null): number | null {
  const m = pointer === null ? null : CARD_POINTER.exec(pointer);
  return m === null ? null : Number(m[1]);
}

/**
 * A card named by its narrowing (design: "All results", "National system", "Mobile unit", "Only
 * when a rule matches"), for the tree, the editor heading and the preview.
 */
export function useCardName(doc: JsonObject | null): (mapping: unknown) => string {
  const t = useT();
  const labelText = useLabelText();
  const rawSources = doc?.sources;
  const rawPersonas = doc?.personas;
  // Memoized on the draft subtrees, so an edit elsewhere keeps the callback (T10-Q2).
  const sources = useMemo(() => asObjects(rawSources), [rawSources]);
  const personas = useMemo(() => asObjects(rawPersonas), [rawPersonas]);
  return useCallback(
    (mapping: unknown) => {
      const m = (typeof mapping === "object" && mapping !== null ? mapping : {}) as Obj;
      const parts: string[] = [];
      if (typeof m.sourceId === "string") {
        const s = sources.find((x) => str(x.id) === m.sourceId);
        parts.push(labelText(s?.labelKey) || m.sourceId);
      }
      if (typeof m.persona === "string") {
        const p = personas.find((x) => str(x.key) === m.persona);
        parts.push(labelText(p?.labelKey) || m.persona);
      }
      // "Only when a rule matches" alone; after a source or persona it joins lowercase.
      if (m.when !== undefined)
        parts.push(t(parts.length === 0 ? "admin.cards.name.rule" : "admin.cards.name.ruleAlso"));
      return parts.length === 0 ? t("admin.cards.name.all") : parts.join(", ");
    },
    [t, labelText, sources, personas],
  );
}

export function useTypeName(doc: JsonObject): (code: string) => string {
  const labelText = useLabelText();
  return (code) => {
    const type = asObjects(doc.queryTypes).find((q) => str(q.code) === code);
    return labelText(type?.labelKey) || code;
  };
}
