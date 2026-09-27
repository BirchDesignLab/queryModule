import type { ValidationError } from "../contracts/index.js";
import { compileQueryType } from "./compile.js";
import { evaluateCondition, type ValueGetter } from "./conditions.js";
import { computeEffectiveValues, computeUserValues, optionsFor } from "./effective-values.js";
import type {
  CanonicalValue,
  EvaluateOptions,
  FieldState,
  FormInput,
  FormState,
  RulesConfig,
} from "./types.js";
import { computeVisibility, detectMode } from "./visibility.js";

function unknownQueryType(code: string): FormState {
  return {
    queryType: code,
    mode: "normal",
    sections: [],
    fields: [],
    sources: [],
    values: {},
    missingRequired: [],
    hiddenWithValue: [],
    errors: [{ key: "validation.unknownQueryType", params: { queryType: code } }],
    valid: false,
  };
}

/** Spec 4.3. Pure: same function on the client (form, terminal) and the server (every submit). */
export function evaluateForm(
  config: RulesConfig,
  queryTypeCode: string,
  input: FormInput,
  options: EvaluateOptions,
): FormState {
  const qt = compileQueryType(config, queryTypeCode, options.now);
  if (qt === undefined) return unknownQueryType(queryTypeCode);

  // Step 1: unknown keys.
  const errors: ValidationError[] = Object.keys(input)
    .filter((key) => !qt.fieldByKey.has(key))
    .map((key) => ({ key: "validation.unknownField", params: { field: key } }));

  // Steps 2 to 6.
  const { userValues, errorsByField } = computeUserValues(qt, input, options.now);
  const effective = computeEffectiveValues(qt, userValues);
  const visibility = computeVisibility(qt, effective, detectMode(qt, input));
  const sectionLabels = new Map(qt.sections.map((s) => [s.key, s.labelKey]));

  // Step 7: prune and check.
  const values: Record<string, CanonicalValue> = {};
  const missingRequired: string[] = [];
  const hiddenWithValue: string[] = [];
  const requiredErrors: ValidationError[] = [];
  const fields = qt.fields.map((field): FieldState => {
    const key = field.def.key;
    const userValue = userValues.get(key) ?? null;
    const effectiveValue = effective.get(key) ?? null;
    const visible = visibility.visible.get(key) ?? false;
    const required = visibility.required.get(key) ?? false;
    const fieldErrors = errorsByField.get(key) ?? [];
    errors.push(...fieldErrors);
    if (visible && effectiveValue !== null) values[key] = effectiveValue;
    if (!visible && userValue !== null) hiddenWithValue.push(key);
    if (required && effectiveValue === null && fieldErrors.length === 0) {
      missingRequired.push(key);
      requiredErrors.push({ key: "validation.required", params: { field: key } });
    }
    const parentKey = field.def.picklistFilter?.byField;
    const parentValue = parentKey === undefined ? null : (effective.get(parentKey) ?? null);
    return {
      key,
      labelKey: field.def.labelKey,
      dataType: field.def.dataType,
      ...(field.def.role === "type" ? { role: "type" as const } : {}),
      order: field.order,
      section: field.def.section,
      sectionLabelKey: sectionLabels.get(field.def.section) ?? field.def.section,
      visible,
      required,
      userValue,
      effectiveValue,
      isDefault: userValue === null && effectiveValue !== null,
      ...(field.def.dataType === "picklist"
        ? {
            options: optionsFor(field, parentValue).map((v) => ({
              code: v.code,
              labelKey: v.labelKey,
            })),
          }
        : {}),
    };
  });
  errors.push(...requiredErrors);

  // Step 8: sources against submitted values (hidden fields absent).
  const submitted: ValueGetter = (key) => values[key] ?? null;
  const sources = qt.sources
    .filter((s) => s.when === null || evaluateCondition(s.when, submitted))
    .map((s) => ({
      sourceId: s.sourceId,
      selectedByDefault: s.selectedByDefault,
      plateOnly: s.plateOnly,
    }));

  return {
    queryType: qt.code,
    mode: visibility.mode,
    sections: qt.sections.map((s) => ({
      key: s.key,
      labelKey: s.labelKey,
      visible: visibility.sectionVisible.get(s.key) ?? false,
    })),
    fields,
    sources,
    values,
    missingRequired,
    hiddenWithValue,
    errors,
    valid: errors.length === 0 && missingRequired.length === 0,
  };
}
