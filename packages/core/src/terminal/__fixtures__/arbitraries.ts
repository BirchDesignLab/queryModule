import fc from "fast-check";
import type { CommandDef, FieldDef } from "../../config/index.js";
import { canonicalise, ISO_DATE_FORMAT } from "../../rules/canonicalise.js";
import { compileQueryType, findQueryType } from "../../rules/compile.js";
import { formatDate } from "../format.js";
import { fieldOf, isRest, namedFieldReader, type Position } from "../positions.js";
import type { Draft, TerminalConfig } from "../types.js";

/** Test-only fast-check arbitraries for the terminal round trip (spec 4.4, 10.1). */

type DraftValue = Draft[string];

const PRINTABLE_ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) =>
  String.fromCharCode(0x20 + i),
);
/** Synthetic non-ASCII letters for `charset: "printable"` fields. */
const PRINTABLE_EXTRA = ["é", "ñ", "ß", "Å", "Ω", " "];

/** Picklist codes the value may match, as the form path computes them at `now`. */
export function enabledCodes(
  config: TerminalConfig,
  queryType: string,
  key: string,
  now: number,
): string[] {
  const field = compileQueryType(config, queryType, now)?.fieldByKey.get(key);
  return field === undefined ? [] : field.enabledValues.map((v) => v.code);
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * One valid, non-empty user value for `field` in a command position: strings from the field's
 * pattern (or charset alphabet) without the delimiter unless `rest`, then canonicalised; picklist
 * values from enabled codes; dates 1901-01-01 to 2099-12-31, typed in one of the field's
 * inputFormats or ISO; years 1901 to 2099.
 */
function canonicalValue(
  config: TerminalConfig,
  queryType: string,
  field: FieldDef,
  rest: boolean,
  now: number,
): fc.Arbitrary<DraftValue> {
  const d = config.terminal.delimiter;
  switch (field.dataType) {
    case "string": {
      const alphabet = [
        ...PRINTABLE_ASCII,
        ...(field.charset === "printable" ? PRINTABLE_EXTRA : []),
      ].filter((c) => rest || !d.includes(c));
      const raw =
        field.pattern !== undefined && !rest
          ? fc.stringMatching(new RegExp(`^(?:${field.pattern})$`))
          : fc.string({
              unit: rest
                ? fc.oneof(fc.constantFrom(...alphabet), fc.constantFrom(d, "=", " "))
                : fc.constantFrom(...alphabet),
              minLength: 1,
              maxLength: field.maxLength,
            });
      return raw
        .map((s) => canonicalise(field, s, { now }).value)
        .filter((v): v is string => typeof v === "string" && (rest || !v.includes(d)));
    }
    case "picklist":
      return fc.constantFrom(...enabledCodes(config, queryType, field.key, now));
    case "date": {
      const formats = [...new Set([...field.inputFormats, ISO_DATE_FORMAT])];
      const date = fc.date({
        min: new Date("1901-01-01T00:00:00Z"),
        max: new Date("2099-12-31T00:00:00Z"),
        noInvalidDate: true,
      });
      return fc
        .tuple(date, fc.constantFrom(...formats))
        .map(([d, format]) => formatDate(iso(d), format));
    }
    case "year":
      return fc.integer({ min: 1901, max: 2099 }).chain((y) => fc.constantFrom(y, String(y)));
    case "boolean":
      return fc.boolean();
    case "number":
      return fc.integer({ min: -1_000_000, max: 1_000_000 });
  }
}

/** The empty user values a draft may hold; `undefined` means the key is absent. */
const emptyValue: fc.Arbitrary<DraftValue | undefined> = fc.constantFrom(null, "", " ", undefined);

/** Unpositioned values are kept by the merge whatever they hold, invalid text included. */
function unpositionedValue(
  config: TerminalConfig,
  queryType: string,
  field: FieldDef,
  now: number,
): fc.Arbitrary<DraftValue | undefined> {
  const valid =
    field.dataType === "picklist"
      ? fc.constantFrom(...enabledCodes(config, queryType, field.key, now))
      : fc.string({ minLength: 1, maxLength: 8 });
  return fc.oneof(valid, fc.string({ maxLength: 8 }), emptyValue);
}

export interface DraftCase {
  command: CommandDef;
  draft: Draft;
  /** Field keys the command positions, in order. */
  positioned: string[];
  /** Field keys of the query type the command neither positions nor presets. */
  unpositioned: string[];
}

/**
 * A draft for `command`'s query type: each position holds a canonical value or an empty one
 * (interior and trailing empties both occur); every other field of the query type may hold any
 * value. Positioned values that would read as a named token are left out (formatCommand reports
 * them as terminal.delimiterInValue; spec 4.4 precondition, Task 6).
 */
export function draftFor(
  config: TerminalConfig,
  command: CommandDef,
  now: number,
): fc.Arbitrary<DraftCase> {
  const qt = findQueryType(config, command.queryType);
  if (qt === undefined) throw new Error(`no query type ${command.queryType}`);
  const byKey = new Map(qt.fields.map((f) => [f.key, f]));
  // A `name=value` value whose name is a field key would read as a named token (spec 4.4).
  const named = namedFieldReader(config, command.queryType);
  const positioned = command.positions.map(fieldOf);
  const preset = new Set(Object.keys(command.presets ?? {}));
  const unpositioned = qt.fields
    .map((f) => f.key)
    .filter((k) => !positioned.includes(k) && !preset.has(k));
  const slot = (p: Position): fc.Arbitrary<DraftValue | undefined> => {
    const field = byKey.get(fieldOf(p));
    if (field === undefined) throw new Error(`no field ${fieldOf(p)}`);
    const value = canonicalValue(config, command.queryType, field, isRest(p), now).filter(
      (v) => isRest(p) || named(String(v)) === undefined,
    );
    return fc.oneof({ arbitrary: value, weight: 3 }, { arbitrary: emptyValue, weight: 1 });
  };
  const other = (key: string): fc.Arbitrary<DraftValue | undefined> => {
    const field = byKey.get(key);
    if (field === undefined) throw new Error(`no field ${key}`);
    return unpositionedValue(config, command.queryType, field, now);
  };
  return fc
    .tuple(fc.tuple(...command.positions.map(slot)), fc.tuple(...unpositioned.map(other)))
    .map(([pos, rest]) => {
      const draft: Record<string, DraftValue> = {};
      // Presets in the draft so selectCommand picks this command.
      for (const [k, v] of Object.entries(command.presets ?? {})) draft[k] = String(v);
      const put = (key: string, v: DraftValue | undefined) => {
        if (v !== undefined) draft[key] = v;
      };
      for (const [i, k] of positioned.entries()) put(k, pos[i]);
      for (const [i, k] of unpositioned.entries()) put(k, rest[i]);
      return { command, draft, positioned, unpositioned };
    });
}

/**
 * Values that may replace a command's preset keys in a draft: the preset in another case or
 * padded (canonically equal), other text, or an empty value; a key left out keeps the preset.
 */
export function presetOverrides(command: CommandDef): fc.Arbitrary<Record<string, DraftValue>> {
  const entries = Object.entries(command.presets ?? {}).map(([key, preset]) => {
    const text = String(preset);
    const value: fc.Arbitrary<DraftValue> = fc.oneof(
      fc.constantFrom(text.toLowerCase(), ` ${text} `),
      fc.string({ maxLength: 8 }),
      fc.constantFrom(null, "", " "),
    );
    return fc.option(value, { nil: undefined }).map((v) => ({ key, v }));
  });
  return fc.tuple(...entries).map((pairs) => {
    const out: Record<string, DraftValue> = {};
    for (const { key, v } of pairs) if (v !== undefined) out[key] = v;
    return out;
  });
}
