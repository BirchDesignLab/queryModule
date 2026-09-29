import type { ValidationError } from "../contracts/validation-error";
import { evaluateForm } from "../rules/evaluate-form";
import type { EvaluateOptions } from "../rules/types";
import { tokenize } from "./tokenize";
import type { ParseResult, TerminalConfig } from "./types";

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

  const positionOf = new Map(
    cmd.positions.map((p, i) => [typeof p === "string" ? p : p.field, i + 1]),
  );
  // Draft merge: an omitted or trailing-empty position writes an empty user value.
  const userValues = { ...t.userValues };
  for (const key of positionOf.keys()) userValues[key] ??= "";

  const formState = evaluateForm(config, t.queryType, userValues, options);
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
  // Only a key the user typed (positioned or named) raises it; a preset-only key never does.
  const typed = new Set([...t.positionedKeys, ...t.namedKeys]);
  const hidden: ValidationError[] = formState.hiddenWithValue
    .filter((key) => typed.has(key))
    .map((key) => ({
      key: "terminal.valueForHiddenField",
      params: fieldParams(key),
    }));

  return {
    queryType: t.queryType,
    userValues,
    formState,
    errors: [...t.errors, ...formState.errors.map(enrich), ...hidden],
  };
}
