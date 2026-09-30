import { type DraftValue, toCoreDraft } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { formatCommand, selectCommand } from "@querymodule/core/terminal";

type Values = Readonly<Record<string, DraftValue>>;

/** Spec 4.4 Toggle, form to terminal: user values only; the fields the command cannot carry are counted. */
export function formToTerminal(
  config: ClientSiteConfig,
  queryType: string,
  values: Values,
  now: number,
): { text: string; unshown: number } {
  const draft = toCoreDraft(values);
  const cmd = selectCommand(config, queryType, draft, { now });
  if (cmd === undefined) return { text: "", unshown: 0 };
  const formatted = formatCommand(config, cmd.code, draft, { now });
  return { text: formatted.text, unshown: formatted.unshownCount };
}
