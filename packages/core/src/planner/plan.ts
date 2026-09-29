import type { z } from "zod";
import type { Condition } from "../config/index";
import { MAX_SOURCES_PER_SUBMIT } from "../config/validate-rules";
import type { AuditValidationErrorSchema } from "../contracts/audit";
import type { ValidationError } from "../contracts/validation-error";
import { compileCondition, compileQueryType, findQueryType } from "../rules/compile";
import { evaluateCondition } from "../rules/conditions";
import { evaluateForm } from "../rules/evaluate-form";
import type {
  CanonicalValue,
  EvaluateOptions,
  FormInput,
  FormMode,
  FormState,
  RulesConfig,
} from "../rules/types";

/** A skip reason as the audit row stores it: params cut to field, labelKey and position (spec 4.7, 5.9). */
type AuditValidationError = z.infer<typeof AuditValidationErrorSchema>;

export interface PlanPart {
  /** 0 = primary; nested = alsoRun index + 1 (gaps allowed). */
  partId: number;
  parentPartId: 0 | null;
  origin: "primary" | "alsoRun";
  queryType: string;
  /** role:"type" fields with a value, canonical codes. */
  typeValues: Record<string, string>;
  /** Visible effective values only (FormState.values). */
  values: Record<string, CanonicalValue>;
  fieldMapApplied?: Record<string, string>;
  /** Dispatched for this part; [] when skipped. */
  sourceIds: string[];
  /** Plate-only narrowing for this part (internal addition to spec 4.6; submitted details carry it per part). */
  droppedSourceIds: string[];
  /**
   * This part's own FormState.mode (internal addition to spec 4.6; submitted details carry plateOnly
   * per part, and a nested plate-only part with nothing dropped is otherwise indistinguishable).
   */
  mode: FormMode;
  status: "planned" | "skipped";
  skipReasons?: AuditValidationError[];
}

export interface Plan {
  mode: FormMode;
  droppedSourceIds: string[];
  parts: PlanPart[];
}

export interface PlanError {
  errors: ValidationError[];
}

export function isPlanError(r: Plan | PlanError): r is PlanError {
  return "errors" in r;
}

function typeValuesOf(s: FormState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of s.fields)
    if (f.role === "type" && f.visible && typeof f.effectiveValue === "string")
      out[f.key] = f.effectiveValue;
  return out;
}

/**
 * Keeps only the audit-safe params; a submitted value never reaches an audit row (spec 4.7, 5.9).
 * Exported for its unit test; the planner barrel does not re-export it.
 */
export function auditReason(e: ValidationError): AuditValidationError {
  const p = e.params ?? {};
  const params: NonNullable<AuditValidationError["params"]> = {};
  if (typeof p.field === "string") params.field = p.field;
  if (typeof p.labelKey === "string") params.labelKey = p.labelKey;
  if (typeof p.position === "number" && Number.isInteger(p.position) && p.position >= 0)
    params.position = p.position;
  return Object.keys(params).length > 0 ? { key: e.key, params } : { key: e.key };
}

/** Spec 4.6 step 3: narrow to eligible plateOnly sources; empty is an error for the caller to map. */
function narrow(s: FormState, selected: readonly string[]): { keep: string[]; dropped: string[] } {
  if (s.mode !== "plateOnly") return { keep: [...selected], dropped: [] };
  const plateOnly = new Set(s.sources.filter((x) => x.plateOnly).map((x) => x.sourceId));
  return {
    keep: selected.filter((id) => plateOnly.has(id)),
    dropped: selected.filter((id) => !plateOnly.has(id)),
  };
}

/** Spec 4.2: a NestedQuery.when reads the primary's submitted values (hidden fields absent). */
function holds(
  config: RulesConfig,
  primary: FormState,
  when: Condition,
  options: EvaluateOptions,
): boolean {
  const fieldByKey = compileQueryType(config, primary.queryType, options.now)?.fieldByKey;
  const compiled = compileCondition(when, fieldByKey ?? new Map(), options.now);
  return evaluateCondition(compiled, (k) => primary.values[k] ?? null);
}

/** Spec 4.6. Pure and deterministic; `options.now` feeds evaluateForm (core never reads the clock). */
export function planRequest(
  config: RulesConfig,
  queryType: string,
  userValues: FormInput,
  selectedSourceIds: readonly string[],
  options: EvaluateOptions,
): Plan | PlanError {
  // Step 1: primary.
  const primary = evaluateForm(config, queryType, userValues, options);
  if (primary.errors.length > 0) return { errors: primary.errors };
  // Step 2: eligible sources. Dedupe first (first occurrence wins): the request schema bounds only the
  // length, and a repeated id would plan a duplicate (part, source) pair and count twice toward the cap.
  const selected = [...new Set(selectedSourceIds)];
  const eligible = new Set(primary.sources.map((s) => s.sourceId));
  const foreign = selected.find((id) => !eligible.has(id));
  if (foreign !== undefined)
    return { errors: [{ key: "plan.sourceNotAllowed", params: { sourceId: foreign } }] };
  // Step 3: plate-only.
  const n = narrow(primary, selected);
  if (primary.mode === "plateOnly" && n.keep.length === 0)
    return { errors: [{ key: "plan.noPlateOnlySource" }] };
  const parts: PlanPart[] = [
    {
      partId: 0,
      parentPartId: null,
      origin: "primary",
      queryType: primary.queryType,
      typeValues: typeValuesOf(primary),
      values: { ...primary.values },
      sourceIds: n.keep,
      droppedSourceIds: n.dropped,
      mode: primary.mode,
      status: "planned",
    },
  ];
  // Steps 4 and 5: nested parts, in config order; ids are alsoRun index + 1.
  const alsoRun = findQueryType(config, primary.queryType)?.alsoRun ?? [];
  alsoRun.forEach((nested, index) => {
    if (nested.when !== undefined && !holds(config, primary, nested.when, options)) return;
    const input: Record<string, CanonicalValue> = {};
    for (const [target, source] of Object.entries(nested.fieldMap)) {
      const v = primary.values[source];
      if (v !== undefined) input[target] = v;
    }
    const s = evaluateForm(config, nested.queryType, input, options);
    const base = {
      partId: index + 1,
      parentPartId: 0 as const,
      origin: "alsoRun" as const,
      queryType: s.queryType,
      typeValues: typeValuesOf(s),
      fieldMapApplied: { ...nested.fieldMap },
      mode: s.mode,
    };
    const skip = (skipReasons: AuditValidationError[]): PlanPart => ({
      ...base,
      values: {},
      sourceIds: [],
      droppedSourceIds: [],
      status: "skipped",
      skipReasons,
    });
    if (s.errors.length > 0) {
      parts.push(skip(s.errors.map(auditReason)));
      return;
    }
    const defaults = s.sources.filter((x) => x.selectedByDefault).map((x) => x.sourceId);
    const m = narrow(s, defaults);
    if (m.keep.length === 0) {
      const key =
        s.mode === "plateOnly" && defaults.length > 0
          ? "plan.noPlateOnlySource"
          : "plan.nestedNoSources";
      parts.push(skip([{ key }]));
      return;
    }
    parts.push({
      ...base,
      values: { ...s.values },
      sourceIds: m.keep,
      droppedSourceIds: m.dropped,
      status: "planned",
    });
  });
  // Spec 5.2 step 2: total dispatched (part, source) pairs capped.
  const total = parts.reduce((t, p) => t + p.sourceIds.length, 0);
  if (total > MAX_SOURCES_PER_SUBMIT)
    return { errors: [{ key: "plan.tooManySources", params: { max: MAX_SOURCES_PER_SUBMIT } }] };
  return { mode: primary.mode, droppedSourceIds: n.dropped, parts };
}
