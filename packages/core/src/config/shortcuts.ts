export const SHORTCUT_CONTEXTS = ["global", "panel", "results", "terminal"] as const;
export type ShortcutContext = (typeof SHORTCUT_CONTEXTS)[number];

export const SHORTCUT_ACTIONS = [
  "focusTerminal",
  "toggleMode",
  "quickType1",
  "quickType2",
  "quickType3",
  "quickType4",
  "quickType5",
  "quickType6",
  "quickType7",
  "quickType8",
  "quickType9",
  "submit",
  "selectPrev",
  "selectNext",
  "toggleDetail",
  "deleteFromView",
  "dismiss",
  "shortcutSheet",
  "goPanel",
  "goResults",
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export interface ShortcutBinding {
  keys: string;
  context: ShortcutContext;
}
export type ShortcutMap = Record<string, ShortcutBinding | ShortcutBinding[]>;

const RAW_DEFAULT_SHORTCUTS: Record<ShortcutAction, ShortcutBinding> = {
  focusTerminal: { keys: "Slash", context: "global" },
  toggleMode: { keys: "Ctrl+Backquote", context: "global" },
  quickType1: { keys: "Alt+Digit1", context: "global" },
  quickType2: { keys: "Alt+Digit2", context: "global" },
  quickType3: { keys: "Alt+Digit3", context: "global" },
  quickType4: { keys: "Alt+Digit4", context: "global" },
  quickType5: { keys: "Alt+Digit5", context: "global" },
  quickType6: { keys: "Alt+Digit6", context: "global" },
  quickType7: { keys: "Alt+Digit7", context: "global" },
  quickType8: { keys: "Alt+Digit8", context: "global" },
  quickType9: { keys: "Alt+Digit9", context: "global" },
  submit: { keys: "Ctrl+Enter", context: "panel" },
  selectPrev: { keys: "ArrowUp", context: "results" },
  selectNext: { keys: "ArrowDown", context: "results" },
  toggleDetail: { keys: "Enter", context: "results" },
  deleteFromView: { keys: "Delete", context: "results" },
  dismiss: { keys: "Escape", context: "global" },
  shortcutSheet: { keys: "Shift+Slash", context: "global" },
  goPanel: { keys: "KeyG KeyQ", context: "global" },
  goResults: { keys: "KeyG KeyR", context: "global" },
};

/** Default map, spec 6.4. Enter in a form field and Enter in the terminal are native, not bindings.
 *  Frozen (top level and per binding) so callers cannot mutate the shared defaults; resolveShortcuts
 *  always hands out fresh copies (I2). */
export const DEFAULT_SHORTCUTS: Readonly<Record<ShortcutAction, ShortcutBinding>> = Object.freeze(
  Object.fromEntries(
    Object.entries(RAW_DEFAULT_SHORTCUTS).map(([action, binding]) => [
      action,
      Object.freeze({ ...binding }),
    ]),
  ),
) as Readonly<Record<ShortcutAction, ShortcutBinding>>;

/**
 * Allowlisted W3C UI Events `KeyboardEvent.code` values a stroke's code part may be (spec 4.1, 6.4).
 * https://www.w3.org/TR/uievents-code/
 * Modifier-key codes (ShiftLeft, ControlLeft, AltLeft, MetaLeft, ...) are excluded: modifiers are
 * expressed only by the `Ctrl+`/`Alt+`/`Shift+` prefixes, never as the code itself.
 */
const KEYBOARD_CODES = [
  // Writing-system keys (literal codes; Key[A-Z] and Digit[0-9] are handled by pattern fragments below)
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
  "IntlBackslash",
  "IntlRo",
  "IntlYen",
  // Functional keys
  "Space",
  "Enter",
  "Tab",
  "Backspace",
  "ContextMenu",
  // Control pad
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  // Arrows
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  // Escape
  "Escape",
  // Numpad (Numpad0-9 handled by a pattern fragment below)
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
  "NumpadEnter",
  "NumpadEqual",
  "NumpadComma",
] as const;

/** Alternation of the allowlisted `KeyboardEvent.code` values: literal codes, Key[A-Z], Digit[0-9],
 *  Numpad[0-9] and F1-F24. */
const CODE_PATTERN = `(?:${KEYBOARD_CODES.join("|")}|Key[A-Z]|Digit[0-9]|Numpad[0-9]|F(?:1[0-9]|2[0-4]|[1-9]))`;

/** One stroke: [Ctrl+][Alt+][Shift+]<KeyboardEvent.code>, modifiers in that order, code from the
 *  W3C UI Events allowlist above (spec 4.1, 6.4). */
export const STROKE_PATTERN = new RegExp(`^(?:Ctrl\\+)?(?:Alt\\+)?(?:Shift\\+)?${CODE_PATTERN}$`);

export function isValidShortcutKeys(keys: string): boolean {
  if (keys.length === 0) return false;
  return keys.split(" ").every((stroke) => STROKE_PATTERN.test(stroke));
}

export function resolveShortcuts(overrides: ShortcutMap = {}): Record<string, ShortcutBinding[]> {
  const out: Record<string, ShortcutBinding[]> = {};
  for (const action of SHORTCUT_ACTIONS) out[action] = [{ ...DEFAULT_SHORTCUTS[action] }];
  for (const [action, binding] of Object.entries(overrides)) {
    out[action] = Array.isArray(binding) ? binding.map((b) => ({ ...b })) : [{ ...binding }];
  }
  return out;
}

/** True when the sequences are equal or one is a prefix of the other. */
export function strokesCollide(a: string, b: string): boolean {
  const sa = a.split(" ");
  const sb = b.split(" ");
  const n = Math.min(sa.length, sb.length);
  for (let i = 0; i < n; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

const US_UNSHIFTED: Readonly<Record<string, string>> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: " ",
};

const US_SHIFTED: Readonly<Record<string, string>> = {
  Backquote: "~",
  Digit1: "!",
  Digit2: "@",
  Digit3: "#",
  Digit4: "$",
  Digit5: "%",
  Digit6: "^",
  Digit7: "&",
  Digit8: "*",
  Digit9: "(",
  Digit0: ")",
  Minus: "_",
  Equal: "+",
  BracketLeft: "{",
  BracketRight: "}",
  Backslash: "|",
  Semicolon: ":",
  Quote: '"',
  Comma: "<",
  Period: ">",
  Slash: "?",
};

/** Numpad character keys, W1 xhigh M9 / Task 13 amendment (09-26-26): the digits plus the numpad
 *  operator and punctuation keys. NumpadEnter types no character and is not in this table. */
const NUMPAD_CHARS: Readonly<Record<string, string>> = {
  NumpadAdd: "+",
  NumpadSubtract: "-",
  NumpadMultiply: "*",
  NumpadDivide: "/",
  NumpadDecimal: ".",
  NumpadEqual: "=",
  NumpadComma: ",",
};

/** Character a single-key stroke (no Ctrl or Alt) types on a US layout; null otherwise (spec 6.4). */
export function usLayoutChar(keys: string): string | null {
  if (keys.includes(" ")) return null;
  if (keys.includes("Ctrl+") || keys.includes("Alt+")) return null;
  const shift = keys.startsWith("Shift+");
  const code = shift ? keys.slice("Shift+".length) : keys;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1]) return shift ? letter[1] : letter[1].toLowerCase();
  const digit = /^Digit(\d)$/.exec(code);
  if (digit?.[1] && !shift) return digit[1];
  const numpadDigit = /^Numpad(\d)$/.exec(code);
  if (numpadDigit?.[1] && !shift) return numpadDigit[1];
  if (!shift && Object.hasOwn(NUMPAD_CHARS, code)) return NUMPAD_CHARS[code] ?? null;
  const table = shift ? US_SHIFTED : US_UNSHIFTED;
  return Object.hasOwn(table, code) ? (table[code] ?? null) : null;
}
