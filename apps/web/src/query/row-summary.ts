import { type DraftValue, toCoreDraft } from "@querymodule/client";
import { type ClientSiteConfig, configuredDefault } from "@querymodule/core/config";
import { formatCommand, tokenize } from "@querymodule/core/terminal";
import { formToTerminal } from "./form-to-terminal.js";

/**
 * The command a request row shows in mono. A row this browser sent keeps its own; a row listed after
 * a reload has none (the server stores no command), so it is rebuilt from the primary part's planned
 * values once the detail fetch brings them (G7). "" until then. Those values are the effective ones,
 * defaults included, so a value equal to the site default is left out: the command shows what the
 * user typed, not a State they never entered (polish 8). Display only; never logged.
 */
export function rowSummary(
  config: ClientSiteConfig,
  queryType: string,
  kept: string,
  values: Readonly<Record<string, unknown>> | undefined,
  now: number,
): string {
  if (kept !== "") return kept;
  if (values === undefined) return "";
  const draft: Record<string, DraftValue> = {};
  const type = config.queryTypes.find((q) => q.code === queryType);
  for (const [key, value] of Object.entries(values)) {
    const text =
      typeof value === "string" || typeof value === "boolean"
        ? value
        : typeof value === "number"
          ? String(value)
          : undefined;
    if (text === undefined) continue;
    const configured = type === undefined ? undefined : configuredDefault(config, type, key);
    if (
      typeof text === "string" &&
      configured !== undefined &&
      String(configured).toUpperCase() === text.toUpperCase()
    )
      continue;
    draft[key] = text;
  }
  return formToTerminal(config, queryType, draft, now, false).text;
}

/**
 * The command a request entry shows for what this browser just sent: the canonical form, the same
 * one a row rebuilt after a reload shows (#680 N1). The input keeps what was typed; the saved entry
 * does not.
 */
export function savedEntryCommand(
  config: ClientSiteConfig,
  queryType: string,
  values: Readonly<Record<string, DraftValue>>,
  now: number,
  /** The command line as typed (terminal mode): its command code is kept, so NAM stays NAM (G31). */
  typed?: string,
): string {
  const code = typed === undefined ? undefined : tokenize(config, typed).commandCode;
  if (code !== undefined) {
    const formatted = formatCommand(config, code, toCoreDraft(values), { now });
    if (formatted.text !== "") return formatted.text;
  }
  return formToTerminal(config, queryType, values, now, false).text;
}
