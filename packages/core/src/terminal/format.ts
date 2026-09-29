import type { CommandDef, FieldDef } from "../config/index.js";
import type { ValidationError } from "../contracts/index.js";
import {
  type CanonicalValue,
  type CompiledQueryType,
  canonicalise,
  compileQueryType,
  computeUserValues,
  type EvaluateOptions,
  type RawValue,
  rawText,
} from "../rules/index.js";
import { fieldOf, isRest, namedFieldReader } from "./positions.js";
import type { Draft, FormatResult, TerminalConfig } from "./types.js";

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
  const named = namedFieldReader(config, cmd.queryType);
  const errors: ValidationError[] = [];
  const tokens = cmd.positions.map((p, i) => {
    const key = fieldOf(p);
    const raw = userValues[key];
    const field = qt?.fieldByKey.get(key)?.def;
    const text =
      field === undefined ? rawText(raw) : emit(field, raw, canonical?.userValues.get(key) ?? null);
    if (!isRest(p) && (text.includes(d) || named(text) !== undefined)) {
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

  // A preset key is shown only when the merge would not overwrite the draft value with it.
  const canon = canonFor(qt, options.now);
  const shown = new Set([
    ...cmd.positions.map(fieldOf),
    ...matchingPresetKeys(canon, userValues, canonical?.userValues ?? new Map(), cmd),
  ]);
  const unshownCount = Object.entries(userValues).filter(
    ([k, v]) => !shown.has(k) && rawText(v) !== "",
  ).length;
  return { text: [cmd.code, ...tokens].join(d), errors, unshownCount };
}

type Canon = (input: Draft) => ReadonlyMap<string, CanonicalValue | null>;

/** Canonical user values as the form path computes them; none for a missing query type. */
const canonFor =
  (qt: CompiledQueryType | undefined, now: number): Canon =>
  (input) =>
    qt === undefined ? new Map() : computeUserValues(qt, input, now).userValues;

/**
 * The command's preset keys whose draft value is non-empty and canonically equal to the preset.
 * Presets canonicalise as the terminal path reads them: String(literal) as a user value.
 */
function matchingPresetKeys(
  canon: Canon,
  userValues: Draft,
  draft: ReadonlyMap<string, CanonicalValue | null>,
  cmd: CommandDef,
): string[] {
  const presets = Object.entries(cmd.presets ?? {});
  const withPresets = canon({
    ...userValues,
    ...Object.fromEntries(presets.map(([k, v]) => [k, String(v)])),
  });
  return presets
    .map(([k]) => k)
    .filter((k) => {
      const value = draft.get(k) ?? null;
      return value !== null && value === (withPresets.get(k) ?? null);
    });
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
  const canon = canonFor(compileQueryType(config, queryType, options.now), options.now);
  const draft = canon(userValues);
  let best: CommandDef | undefined;
  let bestCount = -1;
  for (const cmd of config.commands) {
    if (cmd.queryType !== queryType) continue;
    const presetCount = Object.keys(cmd.presets ?? {}).length;
    const matches = matchingPresetKeys(canon, userValues, draft, cmd).length === presetCount;
    if (matches && presetCount > bestCount) {
      best = cmd;
      bestCount = presetCount;
    }
  }
  return best;
}
