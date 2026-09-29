import { fieldOf } from "./positions.js";
import type { Draft, TerminalConfig, TokenizeResult } from "./types.js";

/**
 * Spec 4.4 draft merge: the command's preset, positioned and named keys overwrite; every position
 * of the command is written, and an omitted or empty one writes null (an empty user value);
 * everything else is kept. A tokenize with no query type returns the same draft. Switching the
 * draft to another query type is the caller's job (one draft per type, spec 6.7).
 */
export function mergeDraft(draft: Draft, t: TokenizeResult, config: TerminalConfig): Draft {
  if (t.queryType === undefined) return draft;
  const cmd = config.commands.find((c) => c.code === t.commandCode);
  const positions = (cmd?.positions ?? []).map(fieldOf);
  const keys = new Set([...t.presetKeys, ...positions, ...t.positionedKeys, ...t.namedKeys]);
  const out: Record<string, string | number | boolean | null> = { ...draft };
  for (const key of keys) {
    const value = t.userValues[key];
    out[key] = value === undefined || value === "" ? null : value;
  }
  return out;
}
