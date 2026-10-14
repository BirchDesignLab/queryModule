import type { KeywordStyle, ResponseMapping, Severity } from "@querymodule/core/config";
import type { MapContext, MockFile } from "@querymodule/core/contracts";
import { type MapResponseConfig, mapResponse } from "@querymodule/core/response";

/**
 * The result cards (`responseMappings`) and keywords as the builder edits them (Task 9, #602;
 * FR-060; spec 4.1, 4.5; design note 2026-10-07-result-card-config). Pure and immutable: an edit
 * returns a new site, a no-op returns its input, and a card or keyword that is not there is a
 * no-op. The functions take whatever carries the card sections (the parsed SiteConfig, or the
 * draft's own document through `applyCardsEdit`), so they work on the draft without a rebuild.
 * Diagnostics are not computed here: they come from validateSiteConfig at the server's pointers
 * (`config.duplicateMapping`, contrast, `config.exceptWithoutKeyword`). Nothing here reads or
 * keeps payload content beyond key names (spec 6.7).
 */

/** What the card editor reads and edits: the cards, the keywords and the types the cards belong to. */
export type CardsSite = MapResponseConfig;

export interface CardEntry {
  /** Position in `responseMappings`: the card's identity for edits and the order that breaks ties. */
  index: number;
  mapping: ResponseMapping;
}

/**
 * Every query type of the site in config order with its cards in config order (a type without
 * cards has an empty list), then any type the cards name that the site does not have, so such a
 * card can still be reached and removed.
 */
export function cardsByType(site: CardsSite): Map<string, CardEntry[]> {
  const grouped = new Map<string, CardEntry[]>(site.queryTypes.map((q) => [q.code, []]));
  site.responseMappings.forEach((mapping, index) => {
    const list = grouped.get(mapping.queryType) ?? [];
    list.push({ index, mapping });
    grouped.set(mapping.queryType, list);
  });
  return grouped;
}

const STATUS_ROW: ResponseMapping["elements"][number] = {
  kind: "value",
  path: "status",
  labelKey: "mapping.status",
  view: "both",
  highlight: true,
};

/**
 * Appends a card for the query type, applying to every source and persona, with one row for
 * `status`. Its id is unique among the cards. Two cards with the same narrowing are the server's
 * `config.duplicateMapping`, not prevented here: the editor shows it where the user fixes it.
 */
export function addCard<S extends CardsSite>(
  site: S,
  queryType: string,
): { site: S; index: number } {
  const taken = new Set(site.responseMappings.map((m) => m.id));
  const base = `${queryType.toLowerCase()}-card`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  const card: ResponseMapping = { id, queryType, elements: [{ ...STATUS_ROW }] };
  return {
    site: { ...site, responseMappings: [...site.responseMappings, card] },
    index: site.responseMappings.length,
  };
}

const hasCard = (site: CardsSite, index: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < site.responseMappings.length;

export function updateCard<S extends CardsSite>(site: S, index: number, m: ResponseMapping): S {
  if (!hasCard(site, index) || site.responseMappings[index] === m) return site;
  return { ...site, responseMappings: site.responseMappings.map((c, i) => (i === index ? m : c)) };
}

/**
 * Moves a card to another position of the list (clamped to its ends). The position matters:
 * equal scores go to the earlier card (spec 4.5), so moving a card is how a tie is broken.
 */
export function moveCard<S extends CardsSite>(site: S, index: number, to: number): S {
  if (!hasCard(site, index) || !Number.isInteger(to)) return site;
  const target = Math.min(Math.max(to, 0), site.responseMappings.length - 1);
  if (target === index) return site;
  const next = [...site.responseMappings];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return site;
  next.splice(target, 0, moved);
  return { ...site, responseMappings: next };
}

export function removeCard<S extends CardsSite>(site: S, index: number): S {
  if (!hasCard(site, index)) return site;
  return { ...site, responseMappings: site.responseMappings.filter((_, i) => i !== index) };
}

export interface PayloadPath {
  path: string;
  kind: "leaf" | "array";
}

const PLAIN_KEY = /^[^.[\]"\\]+$/u;

/** The path of a child key in the language the mapper reads (spec 4.5); same rule as core's. */
const childPath = (parent: string, key: string): string => {
  if (PLAIN_KEY.test(key)) return parent === "" ? key : `${parent}.${key}`;
  return `${parent}[${JSON.stringify(key)}]`;
};

function collect(value: unknown, path: string, into: Map<string, PayloadPath["kind"]>): void {
  if (Array.isArray(value)) {
    if (path !== "") into.set(path, "array");
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) collect(child, childPath(path, key), into);
    return;
  }
  if (path !== "" && value !== null && value !== undefined) into.set(path, "leaf");
}

/**
 * The paths the draft's mock payloads carry for a query type (the default and every scenario's
 * respond, of one source or all): object members to their leaves, and each array once as an
 * array (table rows take their columns relative to one entry). Sorted, without repeats. Only key
 * names leave the payloads; a source or type the mock lacks gives none.
 */
export function payloadPaths(
  mock: MockFile | null,
  queryType: string,
  sourceId?: string,
): PayloadPath[] {
  const found = new Map<string, PayloadPath["kind"]>();
  for (const [id, source] of Object.entries(mock?.sources ?? {})) {
    if (sourceId !== undefined && id !== sourceId) continue;
    for (const response of source.responses) {
      if (response.queryType !== queryType) continue;
      collect(response.default, "", found);
      for (const scenario of response.scenarios) {
        if (scenario.respond !== undefined) collect(scenario.respond, "", found);
      }
    }
  }
  return [...found.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, kind]) => ({ path, kind }));
}

const LABEL_SEGMENT_MAX = 60;

/** A card id as one message-key segment (letters and digits only): "veh-summary" is "vehSummary". */
function keySegment(cardId: string): string {
  const words = cardId.split(/[^A-Za-z0-9]+/u).filter((w) => w !== "");
  const joined = words
    .map((w, i) => (i === 0 ? w : `${w.charAt(0).toUpperCase()}${w.slice(1)}`))
    .join("");
  return (joined === "" ? "card" : joined).slice(0, LABEL_SEGMENT_MAX);
}

/**
 * A label key for a new row under `mapping.<card>.`, a valid MessageKey that is not in `taken`
 * (the keys the site and its overlay already have). The card's id loses its dashes: a key
 * segment is letters and digits.
 */
export function newLabelKey(cardId: string, taken: ReadonlySet<string>): string {
  const prefix = `mapping.${keySegment(cardId)}.label`;
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/**
 * The card a part with this context shows: the index in `responseMappings`, or null for none
 * (the generic dump). It is mapResponse's own selection (rule +4, source +2, persona +1, ties to
 * config order), not a copy of it, run on an empty payload. `now` (epoch ms) resolves a
 * two-digit year in a rule as the form engine does; the caller passes the clock.
 */
export function winningCard(site: CardsSite, ctx: MapContext, now?: number): number | null {
  return mapResponse(site, ctx, {}, now).mappingIndex;
}

const hasKeyword = (site: CardsSite, index: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < site.keywords.length;

/** Appends a keyword (trimmed) with its severity; blank text changes nothing and gives index -1. */
export function addKeyword<S extends CardsSite>(
  site: S,
  keyword: string,
  severity: Severity,
): { site: S; index: number } {
  const text = keyword.trim();
  if (text === "") return { site, index: -1 };
  const style: KeywordStyle = { keyword: text, severity };
  return { site: { ...site, keywords: [...site.keywords, style] }, index: site.keywords.length };
}

export function updateKeyword<S extends CardsSite>(site: S, index: number, k: KeywordStyle): S {
  if (!hasKeyword(site, index) || site.keywords[index] === k) return site;
  return { ...site, keywords: site.keywords.map((c, i) => (i === index ? k : c)) };
}

export function removeKeyword<S extends CardsSite>(site: S, index: number): S {
  if (!hasKeyword(site, index)) return site;
  return { ...site, keywords: site.keywords.filter((_, i) => i !== index) };
}

/** The keyword with a new except list; an empty list leaves no `except` key (the schema's optional). */
function withExcept(style: KeywordStyle, except: string[]): KeywordStyle {
  const { except: _old, ...rest } = style;
  return except.length === 0 ? rest : { ...rest, except };
}

function changeExcept<S extends CardsSite>(
  site: S,
  index: number,
  change: (phrases: readonly string[]) => string[] | null,
): S {
  const style = site.keywords[index];
  if (style === undefined || !hasKeyword(site, index)) return site;
  const next = change(style.except ?? []);
  return next === null ? site : updateKeyword(site, index, withExcept(style, next));
}

/** Adds an except phrase (trimmed) to a keyword; blank text changes nothing. */
export function addExcept<S extends CardsSite>(site: S, index: number, phrase: string): S {
  const text = phrase.trim();
  return changeExcept(site, index, (phrases) => (text === "" ? null : [...phrases, text]));
}

export function updateExcept<S extends CardsSite>(
  site: S,
  index: number,
  phraseIndex: number,
  phrase: string,
): S {
  const text = phrase.trim();
  return changeExcept(site, index, (phrases) =>
    text === "" || phrases[phraseIndex] === undefined || phrases[phraseIndex] === text
      ? null
      : phrases.map((p, i) => (i === phraseIndex ? text : p)),
  );
}

export function removeExcept<S extends CardsSite>(site: S, index: number, phraseIndex: number): S {
  return changeExcept(site, index, (phrases) =>
    phrases[phraseIndex] === undefined ? null : phrases.filter((_, i) => i !== phraseIndex),
  );
}
