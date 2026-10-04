import type { ClientSiteConfig } from "@querymodule/core/config";

type T = (key: string, params?: Record<string, string | number | boolean>) => string;

/** How many of a command's positions the example shows: enough to teach the shape, short enough to read. */
const EXAMPLE_POSITIONS = 2;

/**
 * The hint's example command, built from the site config alone (FR-051, FR-052, BR-001): the first
 * command, its code and its first positions named by the field labels, joined by the site's
 * delimiter. Null for a site with no commands.
 */
export function terminalExample(config: ClientSiteConfig, t: T): string | null {
  const command = config.commands[0];
  if (command === undefined) return null;
  const fields = config.queryTypes.find((q) => q.code === command.queryType)?.fields ?? [];
  const names = command.positions.slice(0, EXAMPLE_POSITIONS).map((position) => {
    const key = typeof position === "string" ? position : position.field;
    const labelKey = fields.find((f) => f.key === key)?.labelKey;
    return (labelKey === undefined ? key : t(labelKey)).toLowerCase();
  });
  return [command.code, ...names].join(config.terminal.delimiter);
}
