import type { ClientSiteConfig } from "@querymodule/core/config";
import { evaluateForm } from "@querymodule/core/rules";

/**
 * What the server's plan hands the mock matcher for part 0 of a query (packages/core planner
 * `typeValuesOf`, copied here because the planner is critical tier): the values of the visible
 * type-role fields as `typeValues`, and the form's values. The builder's two previews
 * (the card preview and Try a match) share this one copy, so they cannot drift from each other.
 * `input` holds what was typed, or the trigger values of a picked scenario; blank entries count as
 * not typed. Pure: the caller passes the clock.
 */
export function formMatchOf(
  config: ClientSiteConfig,
  code: string,
  input: Readonly<Record<string, string>>,
  now: number,
): { typeValues: Record<string, string>; values: Record<string, unknown> } {
  const typed: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) if (v !== "") typed[k] = v;
  const state = evaluateForm(config, code, typed, { now });
  const typeValues: Record<string, string> = {};
  for (const f of state.fields)
    if (f.role === "type" && f.visible && typeof f.effectiveValue === "string")
      typeValues[f.key] = f.effectiveValue;
  return { typeValues, values: state.values };
}

/** A scenario's trigger values as typed text, so a picked scenario goes through the form engine as typing would. */
export function triggerInput(
  when: Readonly<Record<string, string | number | boolean>>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(when).map(([k, v]) => [k, String(v)]));
}
