import type { CommandDef, FieldDef } from "../config/index.js";
import { findQueryType, type RulesConfig } from "../rules/index.js";

/** Shared reading of command positions and named tokens (spec 4.4). Not exported from index. */

export type Position = CommandDef["positions"][number];
export type RestPosition = Extract<Position, { rest: true }>;

export const fieldOf = (p: Position): string => (typeof p === "string" ? p : p.field);

export const isRest = (p: Position | undefined): p is RestPosition =>
  typeof p === "object" && p.rest === true;

/**
 * Spec 4.4: a token reads as named when the text before its first `=` (non-empty, trimmed)
 * matches a field key of the command's query type, case-insensitively. The reader returns that
 * field, or undefined when the token is positional.
 */
export function namedFieldReader(
  config: RulesConfig,
  queryType: string,
): (text: string) => FieldDef | undefined {
  const fields = findQueryType(config, queryType)?.fields ?? [];
  const byLower = new Map(fields.map((f) => [f.key.toLowerCase(), f]));
  return (text) => {
    const eq = text.indexOf("=");
    return eq > 0 ? byLower.get(text.slice(0, eq).trim().toLowerCase()) : undefined;
  };
}
