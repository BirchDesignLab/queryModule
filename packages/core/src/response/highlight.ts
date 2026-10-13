import type { KeywordStyle, Severity } from "../config/schema";
import type { Highlight, Segment } from "../contracts/assess";

/**
 * Keyword highlighter (spec 4.5; FR-060, UX-010, UX-011). Pure: NFC-normalises text and keywords,
 * matches case-insensitively with Unicode letter/number boundaries (never `\b`), longest keyword
 * first, and lets an `except` phrase suppress a match inside one of its occurrences.
 */

type Span = { start: number; end: number };
export type KeywordHit = Span & { keyword: string; severity: Severity };

const escapeRegExp = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");

const BEFORE = String.raw`(?<![\p{L}\p{N}])`;
const AFTER = String.raw`(?![\p{L}\p{N}])`;

function occurrences(text: string, phrase: string): Span[] {
  const re = new RegExp(`${BEFORE}${escapeRegExp(phrase)}${AFTER}`, "giu");
  const out: Span[] = [];
  for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** Non-overlapping hits over already NFC-normalised text, in position order. */
export function findHits(text: string, keywords: readonly KeywordStyle[]): KeywordHit[] {
  const ordered = keywords
    .map((k) => ({ ...k, keyword: k.keyword.normalize("NFC") }))
    .filter((k) => k.keyword.length > 0)
    .sort((a, b) => b.keyword.length - a.keyword.length);
  const accepted: KeywordHit[] = [];
  for (const k of ordered) {
    const excepts = (k.except ?? [])
      .map((e) => e.normalize("NFC"))
      .filter((e) => e.length > 0)
      .flatMap((e) => occurrences(text, e));
    for (const span of occurrences(text, k.keyword)) {
      if (excepts.some((e) => e.start <= span.start && span.end <= e.end)) continue;
      if (accepted.some((a) => span.start < a.end && a.start < span.end)) continue;
      accepted.push({ ...span, keyword: k.keyword, severity: k.severity });
    }
  }
  return accepted.sort((a, b) => a.start - b.start);
}

export const highlight: Highlight = (text, keywords) => {
  const t = text.normalize("NFC");
  const segments: Segment[] = [];
  let pos = 0;
  for (const h of findHits(t, keywords)) {
    if (h.start > pos) segments.push({ text: t.slice(pos, h.start) });
    segments.push({ text: t.slice(h.start, h.end), severity: h.severity, keyword: h.keyword });
    pos = h.end;
  }
  if (pos < t.length) segments.push({ text: t.slice(pos) });
  return segments;
};
