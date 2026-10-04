import type { DraftValue } from "@querymodule/client";
import type { FormState } from "@querymodule/core/rules";

/**
 * The values a checked request sends. Values kept in the draft for fields a rule now hides are
 * dropped (data minimisation; spec 10.3: neither persisted nor dispatched). They never decide the
 * mode (spec 4.3 step 6, SUBMIT-2), so dropping them cannot change the plate-only detection the
 * server repeats on the body it receives, and no fallback is needed.
 */
export function valuesToSend(
  values: Readonly<Record<string, DraftValue>>,
  state: FormState,
): Readonly<Record<string, DraftValue>> {
  if (state.hiddenWithValue.length === 0) return values;
  const hidden = new Set(state.hiddenWithValue);
  return Object.fromEntries(Object.entries(values).filter(([key]) => !hidden.has(key)));
}
