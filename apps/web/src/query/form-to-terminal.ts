import { type DraftValue, toCoreDraft } from "@querymodule/client";
import type { ClientSiteConfig, CommandDef } from "@querymodule/core/config";
import { formatCommand, selectCommand } from "@querymodule/core/terminal";

type Values = Readonly<Record<string, DraftValue>>;

/** Spec 4.4 Toggle, form to terminal: user values only; the fields the command cannot carry are counted. */
export function formToTerminal(
  config: ClientSiteConfig,
  queryType: string,
  values: Values,
  now: number,
  /** False writes the canonical year: the saved request entry, not the input (#680 N1). */
  keepTyped = true,
): { text: string; unshown: number } {
  const draft = toCoreDraft(values);
  const cmd = selectCommand(config, queryType, draft, { now });
  if (cmd === undefined) return { text: "", unshown: 0 };
  const formatted = formatCommand(config, cmd.code, draft, { now });
  return {
    text: keepTyped ? keepTypedYears(config, cmd, values, formatted.text) : formatted.text,
    unshown: formatted.unshownCount,
  };
}

/**
 * The core formatter writes a year in its four-digit canonical form, so "26" reads back as "2026"
 * in the saved request entry. The input (the form and the command echo) keeps what was typed (R11,
 * narrowed to the input by the 10-18-26 ruling on #680 N1). A year field whose draft
 * is exactly two digits is written as typed: the terminal reads "26" the same way. Only the token
 * at that field's position changes; a non-rest token never holds the delimiter.
 */
function keepTypedYears(
  config: ClientSiteConfig,
  cmd: CommandDef,
  values: Values,
  text: string,
): string {
  const type = config.queryTypes.find((q) => q.code === cmd.queryType);
  const delimiter = config.terminal.delimiter;
  const parts = text.split(delimiter);
  cmd.positions.forEach((position, index) => {
    const key = typeof position === "string" ? position : position.field;
    const raw = values[key];
    if (type?.fields.find((f) => f.key === key)?.dataType !== "year") return;
    if (typeof raw !== "string" || !/^\d{2}$/.test(raw.trim())) return;
    const token = parts[index + 1];
    // Only a token the formatter widened (the last two digits are the typed ones).
    if (token !== undefined && token.length === 4 && token.endsWith(raw.trim()))
      parts[index + 1] = raw.trim();
  });
  return parts.join(delimiter);
}
