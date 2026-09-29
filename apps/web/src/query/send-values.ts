import type { DraftValue } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { evaluateForm, type FormState } from "@querymodule/core/rules";

/**
 * The values a checked request sends. Values kept in the draft for fields a rule now hides are
 * dropped (data minimisation; the server prunes them anyway, spec 5.2). Dropping one can change
 * the plate-only detection the server repeats on the body it receives (spec 4.3 step 6), which
 * would turn the sent `mode` into a 400; in that case the draft's values go as they were.
 */
export function valuesToSend(
  config: ClientSiteConfig,
  queryType: string,
  values: Readonly<Record<string, DraftValue>>,
  state: FormState,
  now: number,
): Readonly<Record<string, DraftValue>> {
  if (state.hiddenWithValue.length === 0) return values;
  const hidden = new Set(state.hiddenWithValue);
  const kept = Object.fromEntries(Object.entries(values).filter(([key]) => !hidden.has(key)));
  return evaluateForm(config, queryType, kept, { now }).mode === state.mode ? kept : values;
}
