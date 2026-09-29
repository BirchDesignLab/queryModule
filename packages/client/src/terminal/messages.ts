import type { ValidationError } from "@querymodule/core/contracts";
import type { MessageParams, Translator } from "../i18n/translator.js";

/**
 * Spec 4.4 errors carry field keys, label keys, positions and lengths, not labels or the delimiter (#297 item 2).
 * The label comes from params.labelKey through t (fallback params.field); {delimiter} from config.terminal.delimiter.
 * terminal.unknownCommand.code and terminal.unknownField.name are passed through for display only; this module never logs.
 */
export function terminalErrorText(
  e: ValidationError,
  o: { t: Translator["t"]; delimiter: string },
): string {
  const params: Record<string, string | number | boolean> = { ...e.params };
  const { labelKey, field } = params;
  if (typeof labelKey === "string") params.label = o.t(labelKey);
  else if (typeof field === "string") params.label = field;
  params.delimiter = o.delimiter;
  return o.t(e.key, params satisfies MessageParams);
}
