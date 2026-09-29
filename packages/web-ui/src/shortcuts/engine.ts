import {
  type ShortcutBinding,
  type ShortcutContext,
  STROKE_PATTERN,
} from "@querymodule/core/config";

/** Pure keyboard shortcut engine (spec 6.4). No DOM, no timers: the caller passes `now`. */

export interface StrokeInput {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** "[Ctrl+][Alt+][Shift+]<code>" in STROKE_PATTERN order; null for Meta combos and unknown codes (never bound). */
export function strokeOf(e: StrokeInput): string | null {
  if (e.metaKey) return null;
  const stroke = `${e.ctrlKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${e.code}`;
  return STROKE_PATTERN.test(stroke) ? stroke : null;
}

export interface KeyContext {
  inTextInput: boolean;
  /** "global" plus every region the focus is inside. */
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

export const CHORD_TIMEOUT_MS = 1000;

/** Text-editing combos never fire, even if a site bound them (config validation also rejects them). */
export const EDITING_COMBOS: ReadonlySet<string> = new Set([
  "Ctrl+KeyA",
  "Ctrl+KeyC",
  "Ctrl+KeyV",
  "Ctrl+KeyX",
  "Ctrl+KeyZ",
  "Ctrl+KeyY",
]);

interface Entry {
  strokes: readonly string[];
  action: string;
  context: ShortcutContext;
}

const NONE: EngineResult = { kind: "none" };

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

  const matchFrom = (
    seq: readonly string[],
    ctx: KeyContext,
  ): { full: Entry | null; prefix: boolean } => {
    let full: Entry | null = null;
    let prefix = false;
    for (const entry of entries) {
      if (!applies(entry, ctx) || entry.strokes.length < seq.length) continue;
      if (!seq.every((s, i) => s === entry.strokes[i])) continue;
      if (entry.strokes.length === seq.length) full ??= entry;
      else prefix = true;
    }
    return { full, prefix };
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
