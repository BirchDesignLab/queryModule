import type { DraftValue } from "@querymodule/client";
import { type ClientSiteConfig, configuredDefault } from "@querymodule/core/config";
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
  return formToTerminal(config, queryType, draft, now).text;
}
