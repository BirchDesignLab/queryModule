import type { ValidationError } from "../contracts/index.js";
import { type EvaluateOptions, evaluateForm, type FormState } from "../rules/index.js";
import { fieldOf } from "./positions.js";
import { tokenize } from "./tokenize.js";
import type { ParseResult, TerminalConfig } from "./types.js";

/**
 * Spec 4.4. tokenize, then evaluateForm on the user values; every error from both.
 * validation.* errors naming a field gain labelKey and, for a command position, its
 * 1-based position. Pure: `now` is passed in.
 */
export function parseCommand(
  config: TerminalConfig,
  input: string,
  options: EvaluateOptions,
): ParseResult {
  const t = tokenize(config, input);
  const cmd = config.commands.find((c) => c.code === t.commandCode);
  if (t.queryType === undefined || cmd === undefined)
    return { userValues: t.userValues, errors: t.errors };

  // Draft merge: an omitted or trailing-empty position writes an empty user value.
  const userValues = { ...t.userValues };
  for (const p of cmd.positions) userValues[fieldOf(p)] ??= "";

  const formState = evaluateForm(config, t.queryType, userValues, options);
  return {
    queryType: t.queryType,
    userValues,
    formState,
    errors: [
      ...t.errors,
      ...enrichErrors(config, cmd.code, formState, [...t.positionedKeys, ...t.namedKeys]),
    ],
  };
}

/**
 * Internal (parseCommand and checkTerminalSubmit share it): formState's errors, where a
 * validation.* error naming a field gains labelKey and, for a command position, its 1-based
 * position; then terminal.valueForHiddenField for each typed key in hiddenWithValue. Only a key
 * the user typed (positioned or named) raises it; a preset-only key never does.
 */
export function enrichErrors(
  config: TerminalConfig,
  commandCode: string,
  formState: FormState,
  typedKeys: readonly string[],
): ValidationError[] {
  const cmd = config.commands.find((c) => c.code === commandCode);
  const positionOf = new Map((cmd?.positions ?? []).map((p, i) => [fieldOf(p), i + 1]));
  const labelOf = new Map(formState.fields.map((f) => [f.key, f.labelKey]));
  const fieldParams = (field: string) => {
    const labelKey = labelOf.get(field);
    const position = positionOf.get(field);
    return {
      field,
      ...(labelKey === undefined ? {} : { labelKey }),
      ...(position === undefined ? {} : { position }),
    };
  };
  const enrich = (e: ValidationError): ValidationError => {
    const field = e.params?.field;
    if (!e.key.startsWith("validation.") || typeof field !== "string") return e;
    return { key: e.key, params: { ...e.params, ...fieldParams(field) } };
  };
  const typed = new Set(typedKeys);
  const hidden: ValidationError[] = formState.hiddenWithValue
    .filter((key) => typed.has(key))
    .map((key) => ({ key: "terminal.valueForHiddenField", params: fieldParams(key) }));
  return [...formState.errors.map(enrich), ...hidden];
}
