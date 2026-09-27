import { isRawEmpty } from "./canonicalise.js";
import type { CompiledQueryType } from "./compile.js";
import { evaluateCondition, type ValueGetter } from "./conditions.js";
import type { CanonicalValue, FormInput, FormMode } from "./types.js";

export interface VisibilityResult {
  mode: FormMode;
  sectionVisible: Map<string, boolean>;
  visible: Map<string, boolean>;
  required: Map<string, boolean>;
}

/**
 * Spec 4.3 step 6: allowPlateOnly, a non-empty plate input, every other input empty.
 * Emptiness is judged on raw input after trim; defaults are ignored; an invalid entry is non-empty.
 */
export function detectMode(qt: CompiledQueryType, input: FormInput): FormMode {
  if (!qt.allowPlateOnly || !qt.fieldByKey.has("plate") || isRawEmpty(input.plate)) return "normal";
  return Object.entries(input).every(([key, value]) => key === "plate" || isRawEmpty(value))
    ? "plateOnly"
    : "normal";
}

/** Spec 4.3 steps 4 to 6, reading effective values before pruning. */
export function computeVisibility(
  qt: CompiledQueryType,
  effective: ReadonlyMap<string, CanonicalValue | null>,
  mode: FormMode,
): VisibilityResult {
  const get: ValueGetter = (key) => effective.get(key) ?? null;
  const sectionVisible = new Map<string, boolean>();
  for (const section of qt.sections) {
    const shown =
      mode === "plateOnly"
        ? section.key === "base"
        : section.when === null || evaluateCondition(section.when, get);
    sectionVisible.set(section.key, shown);
  }
  const visible = new Map<string, boolean>();
  const required = new Map<string, boolean>();
  for (const field of qt.fields) {
    let shown = field.def.visible;
    let needed = field.def.required;
    for (const rule of qt.rules) {
      if (rule.field !== field.def.key) continue;
      if (rule.effect === "show" || rule.effect === "hide") {
        if (evaluateCondition(rule.when, get)) shown = rule.effect === "show";
      } else if (rule.effect === "require" && !needed) {
        needed = evaluateCondition(rule.when, get);
      }
    }
    const isVisible = shown && (sectionVisible.get(field.def.section) ?? false);
    visible.set(field.def.key, isVisible);
    required.set(field.def.key, mode === "normal" && needed && isVisible);
  }
  return { mode, sectionVisible, visible, required };
}
