import {
  EDITING_COMBOS,
  type ShortcutBinding,
  type ShortcutContext,
  STROKE_PATTERN,
} from "@querymodule/core/config";

/** Pure keyboard shortcut engine (spec 6.4). No DOM, no timers: the caller passes `now`. */

export interface StrokeInput {
  /** KeyboardEvent.getModifierState; AltGr (AltGraph) arrives as Ctrl+Alt on Windows layouts. */
  getModifierState?(key: string): boolean;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** "[Ctrl+][Alt+][Shift+]<code>" in STROKE_PATTERN order; null for Meta combos and unknown codes (never bound). */
export function strokeOf(e: StrokeInput): string | null {
  if (e.metaKey) return null;
  // An AltGr keystroke types a character; it is not a Ctrl+Alt combo (spec 6.4).
  if (e.getModifierState?.("AltGraph") === true) return null;
  const stroke = `${e.ctrlKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${e.code}`;
  return STROKE_PATTERN.test(stroke) ? stroke : null;
}

export interface KeyContext {
  inTextInput: boolean;
  /** Every region the focus is inside, innermost first; regions rank by position (nested tie
   *  order, spec 6.4). Global bindings always apply and always rank last: the engine alone
   *  enforces that, so callers need not list "global" (#319). */
  contexts: readonly ShortcutContext[];
}

export type EngineResult =
  | { kind: "action"; action: string }
  | { kind: "pending" }
  | { kind: "none" };

export interface ShortcutEngine {
  handle(stroke: string | null, ctx: KeyContext, now: number): EngineResult;
  reset(): void;
}

/** A chord's second stroke must come less than this long after the first: at exactly 1000 ms
 *  the pending prefix has expired (`>=`), and that stroke starts afresh. */
export const CHORD_TIMEOUT_MS = 1000;

/** Text-editing combos never fire, even if bound. The engine guards this at runtime; core config validation also rejects them (config.shortcutEditingCombo). One source, in core. */
export { EDITING_COMBOS };

interface Entry {
  strokes: readonly string[];
  action: string;
  context: ShortcutContext;
}

/** Shared result; frozen so a caller cannot change what every later call returns. */
const NONE: EngineResult = Object.freeze({ kind: "none" as const });

/** A single key: no Ctrl and no Alt (Shift allowed). */
function isSingleKey(stroke: string): boolean {
  return !stroke.startsWith("Ctrl+") && !stroke.startsWith("Alt+");
}

export function createShortcutEngine(
  bindings: Readonly<Record<string, readonly ShortcutBinding[]>>,
): ShortcutEngine {
  const entries: Entry[] = [];
  for (const [action, list] of Object.entries(bindings)) {
    for (const b of list) {
      entries.push({ strokes: b.keys.split(" "), action, context: b.context });
    }
  }
  let pending: { strokes: readonly string[]; at: number } | null = null;

  const applies = (entry: Entry, ctx: KeyContext): boolean =>
    entry.context === "global" || ctx.contexts.includes(entry.context);

  /** Lower wins. Nested contexts: innermost region first, then outer regions, then global. */
  const rank = (entry: Entry, ctx: KeyContext): number =>
    entry.context === "global" ? Number.MAX_SAFE_INTEGER : ctx.contexts.indexOf(entry.context);

  /**
   * The best full match and whether a chord continues from seq. Innermost-first applies to prefixes
   * too (#319): a full match fires only when no strictly more inner context holds a chord that seq
   * starts, so KeyG in panel never hides "KeyG KeyX" in results while focus is in results. Same
   * rank: the full match wins (config validation rejects a prefix and a full match in one context).
   */
  const matchFrom = (
    seq: readonly string[],
    ctx: KeyContext,
  ): { full: Entry | null; prefix: boolean } => {
    let full: Entry | null = null;
    let prefixRank = Number.POSITIVE_INFINITY;
    for (const entry of entries) {
      if (!applies(entry, ctx) || entry.strokes.length < seq.length) continue;
      if (!seq.every((s, i) => s === entry.strokes[i])) continue;
      if (entry.strokes.length === seq.length) {
        if (full === null || rank(entry, ctx) < rank(full, ctx)) full = entry;
      } else prefixRank = Math.min(prefixRank, rank(entry, ctx));
    }
    if (full !== null && prefixRank < rank(full, ctx)) full = null;
    return { full, prefix: prefixRank !== Number.POSITIVE_INFINITY };
  };

  return {
    reset() {
      pending = null;
    },
    handle(stroke, ctx, now) {
      if (stroke === null) return NONE;
      if (pending && now - pending.at >= CHORD_TIMEOUT_MS) pending = null;
      if (EDITING_COMBOS.has(stroke) || (ctx.inTextInput && isSingleKey(stroke))) {
        pending = null;
        return NONE;
      }
      const attempts: { seq: readonly string[]; at: number }[] = [];
      if (pending) attempts.push({ seq: [...pending.strokes, stroke], at: pending.at });
      attempts.push({ seq: [stroke], at: now });
      pending = null;
      for (const { seq, at } of attempts) {
        const { full, prefix } = matchFrom(seq, ctx);
        if (full) return { kind: "action", action: full.action };
        if (prefix) {
          pending = { strokes: seq, at };
          return { kind: "pending" };
        }
      }
      return NONE;
    },
  };
}
