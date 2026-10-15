import type { DraftValue } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { formToTerminal } from "./form-to-terminal.js";

/**
 * The command a request row shows in mono. A row this browser sent keeps its own; a row listed after
 * a reload has none (the server stores no command), so it is rebuilt from the primary part's planned
 * values once the detail fetch brings them (G7). "" until then. Display only; never logged.
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
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" || typeof value === "boolean") draft[key] = value;
    else if (typeof value === "number") draft[key] = String(value);
  }
  return formToTerminal(config, queryType, draft, now).text;
}
