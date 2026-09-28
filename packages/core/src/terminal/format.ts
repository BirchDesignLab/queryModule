import type { CommandDef, FieldDef } from "../config/schema";
import type { ValidationError } from "../contracts/validation-error";
import { canonicalise, rawText } from "../rules/canonicalise";
import { compileQueryType, findQueryType } from "../rules/compile";
import { computeUserValues } from "../rules/effective-values";
import type { CanonicalValue, EvaluateOptions, RawValue } from "../rules/types";
import type { Draft, FormatResult, TerminalConfig } from "./types";

type Position = CommandDef["positions"][number];

const fieldOf = (p: Position): string => (typeof p === "string" ? p : p.field);
const isRest = (p: Position): boolean => typeof p === "object" && p.rest === true;

const DATE_TOKENS = /YYYY|YY|MM|DD/g;

/** ISO YYYY-MM-DD to `format`: tokens YYYY, YY, MM, DD; everything else is a literal separator. */
export function formatDate(iso: string, format: string): string {
  const [year = "", month = "", day = ""] = iso.split("-");
  const parts: Record<string, string> = { YYYY: year, YY: year.slice(-2), MM: month, DD: day };
  return format.replace(DATE_TOKENS, (token) => parts[token] ?? token);
}

/** Canonical value to terminal syntax (spec 4.4 table); null (failed or empty) emits the raw text. */
function emit(field: FieldDef, raw: RawValue, canonical: CanonicalValue | null): string {
  if (canonical === null) return rawText(raw);
  switch (field.dataType) {
    case "date":
      return formatDate(String(canonical), field.outputFormat);
    case "boolean":
      return canonical === true ? "Y" : "N";
    default:
      return String(canonical);
  }
}

/** Serialise one value in terminal syntax (spec 4.4 table). */
export function formatValue(
  field: FieldDef,
  raw: string | number | boolean | null,
  options: EvaluateOptions & { codes?: readonly string[] },
): string {
  return emit(field, raw, canonicalise(field, raw, options).value);
}

/**
 * Spec 4.4 toggle: user values only, never effective defaults; interior empties kept, trailing dropped.
 * A non-rest value holding the delimiter, or reading as a named token (`key=...`), is
 * terminal.delimiterInValue: it would not tokenize back into its own position.
 */
export function formatCommand(
  config: TerminalConfig,
  commandCode: string,
  userValues: Draft,
  options: EvaluateOptions,
): FormatResult {
  const folded = commandCode.toLowerCase();
  const cmd = config.commands.find((c) => c.code.toLowerCase() === folded);
  if (cmd === undefined) {
    return {
      text: "",
      errors: [{ key: "terminal.unknownCommand", params: { code: commandCode } }],
      unshownCount: 0,
    };
  }
  const d = config.terminal.delimiter;
  const qt = compileQueryType(config, cmd.queryType, options.now);
  // Canonical values with each picklist's filtered codes, as the form path computes them.
  const canonical = qt === undefined ? undefined : computeUserValues(qt, userValues, options.now);
  // tokenize reads `name=value` as a named token when name is a field key of the query type.
  const keys = new Set(
    findQueryType(config, cmd.queryType)?.fields.map((x) => x.key.toLowerCase()),
  );
  const readsAsNamed = (text: string): boolean => {
    const eq = text.indexOf("=");
    return eq > 0 && keys.has(text.slice(0, eq).trim().toLowerCase());
  };
  const errors: ValidationError[] = [];
  const tokens = cmd.positions.map((p, i) => {
    const key = fieldOf(p);
    const raw = userValues[key];
    const field = qt?.fieldByKey.get(key)?.def;
    const text =
      field === undefined ? rawText(raw) : emit(field, raw, canonical?.userValues.get(key) ?? null);
    if (!isRest(p) && (text.includes(d) || readsAsNamed(text))) {
      errors.push({
        key: "terminal.delimiterInValue",
        params: {
          field: key,
          ...(field === undefined ? {} : { labelKey: field.labelKey }),
          position: i + 1,
        },
      });
    }
    return text;
  });
  while (tokens.length > 0 && tokens[tokens.length - 1] === "") tokens.pop();

  const shown = new Set([...cmd.positions.map(fieldOf), ...Object.keys(cmd.presets ?? {})]);
  const unshownCount = Object.entries(userValues).filter(
    ([k, v]) => !shown.has(k) && rawText(v) !== "",
  ).length;
  return { text: [cmd.code, ...tokens].join(d), errors, unshownCount };
}

/**
 * Spec 4.4 toggle, form to terminal: the command for this query type whose presets all equal the
 * draft's values (compared canonically); most presets wins; ties go to config order.
 */
export function selectCommand(
  config: TerminalConfig,
  queryType: string,
  userValues: Draft,
  options: EvaluateOptions,
): CommandDef | undefined {
  const qt = compileQueryType(config, queryType, options.now);
  const canon = (input: Draft) =>
    qt === undefined ? new Map() : computeUserValues(qt, input, options.now).userValues;
  const draft = canon(userValues);
  let best: CommandDef | undefined;
  let bestCount = -1;
  for (const cmd of config.commands) {
    if (cmd.queryType !== queryType) continue;
    const presets = Object.entries(cmd.presets ?? {});
    // Presets canonicalise as the terminal path reads them: String(literal) as a user value.
    const withPresets = canon({
      ...userValues,
      ...Object.fromEntries(presets.map(([k, v]) => [k, String(v)])),
    });
    const matches = presets.every(([k]) => {
      const value = draft.get(k) ?? null;
      return value !== null && value === (withPresets.get(k) ?? null);
    });
    if (matches && presets.length > bestCount) {
      best = cmd;
      bestCount = presets.length;
    }
  }
  return best;
}
