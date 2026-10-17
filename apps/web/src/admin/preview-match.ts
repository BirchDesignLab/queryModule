import type { ClientSiteConfig } from "@querymodule/core/config";
import { typeValuesOf } from "@querymodule/core/planner";
import { evaluateForm } from "@querymodule/core/rules";

/**
 * What the server's plan hands the mock matcher for part 0 of a query: the planner's own
 * `typeValuesOf` (#644) as `typeValues`, and the form's values. The builder's two previews
 * (the card preview and Try a match) share this helper, so they cannot drift from the plan.
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
  return { typeValues: typeValuesOf(state), values: state.values };
}

/** A scenario's trigger values as typed text, so a picked scenario goes through the form engine as typing would. */
export function triggerInput(
  when: Readonly<Record<string, string | number | boolean>>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(when).map(([k, v]) => [k, String(v)]));
}
