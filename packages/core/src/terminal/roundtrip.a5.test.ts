import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FieldDef } from "../config/index";
import { QueryTypeSchema } from "../config/index";
import { canonicalise } from "../rules/canonicalise";
import { compileQueryType } from "../rules/compile";
import { computeUserValues } from "../rules/effective-values";
import {
  type DraftCase,
  draftFor,
  enabledCodes,
  presetOverrides,
} from "./__fixtures__/arbitraries";
import { defaultSite, exampleOkSite } from "./__fixtures__/sites";
import { mergeDraft } from "./draft";
import { formatCommand, selectCommand } from "./format";
import { fieldOf } from "./positions";
import { tokenize } from "./tokenize";
import type { Draft, TerminalConfig } from "./types";

const now = Date.UTC(2026, 8, 28);
const runs = { numRuns: 500 };

/** Preset commands inline: the shipped sites have none, so the presets path runs only here. */
const presetSite: TerminalConfig = {
  ...defaultSite,
  commands: [
    {
      code: "PROF",
      queryType: "PRO",
      presets: { propertyType: "FIREARM" },
      positions: ["serial", { field: "description", rest: true }],
    },
    { code: "VPC", queryType: "VEH", presets: { plateType: "PC" }, positions: ["plate", "state"] },
    {
      code: "PERX",
      queryType: "PER",
      presets: { sex: "X", race: "U" },
      positions: ["last", "dob"],
    },
  ],
};

const sites: [string, TerminalConfig][] = [
  ["default", defaultSite],
  ["example-ok", exampleOkSite],
  ["presets", presetSite],
];
const cases = sites.flatMap(([name, config]) =>
  config.commands.map((command) => ({ name: `${name} ${command.code}`, config, command })),
);

/**
 * Canonical user values of every field of the query type (an empty or absent value is null) and
 * their errors by field: a value invalid on both sides is null on both, so errors are compared too.
 */
function canonDraft(config: TerminalConfig, queryType: string, draft: Draft) {
  const qt = compileQueryType(config, queryType, now);
  if (qt === undefined) throw new Error(`no query type ${queryType}`);
  const { userValues, errorsByField } = computeUserValues(qt, draft, now);
  return { values: Object.fromEntries(userValues), errors: Object.fromEntries(errorsByField) };
}

function fieldDef(config: TerminalConfig, queryType: string, key: string): FieldDef {
  const def = compileQueryType(config, queryType, now)?.fieldByKey.get(key)?.def;
  if (def === undefined) throw new Error(`no field ${key}`);
  return def;
}

/** Form to terminal (selectCommand, formatCommand), terminal to draft (tokenize, mergeDraft). */
function trip(config: TerminalConfig, c: DraftCase) {
  const selected = selectCommand(config, c.command.queryType, c.draft, { now });
  // #323 C-C-M2: no command selected would format "" and let a property pass vacuously.
  if (selected === undefined) throw new Error(`no command selected for ${c.command.code}`);
  const formatted = formatCommand(config, selected.code, c.draft, { now });
  const tokens = tokenize(config, formatted.text);
  const merged = mergeDraft(c.draft, tokens, config);
  return { selected, formatted, tokens, merged };
}

const isEmpty = (v: Draft[string] | undefined) =>
  v === undefined || v === null || String(v).trim() === "";

/**
 * Independent unshownCount oracle, from the draft and the command definition: a non-empty value
 * counts unless the command positions its key or presets it to the same canonical value (Task 18).
 */
function expectedUnshown(config: TerminalConfig, command: DraftCase["command"], draft: Draft) {
  const qt = command.queryType;
  const positioned = new Set(command.positions.map(fieldOf));
  const presets: Readonly<Record<string, unknown>> = command.presets ?? {};
  const canon = (key: string, v: Draft[string]) =>
    canonicalise(fieldDef(config, qt, key), v, {
      now,
      codes: enabledCodes(config, qt, key, now),
    }).value;
  return Object.entries(draft).filter(([key, v]) => {
    if (isEmpty(v) || positioned.has(key)) return false;
    if (!(key in presets)) return true;
    const value = canon(key, v);
    return value === null || value !== canon(key, String(presets[key]));
  }).length;
}

describe("round-trip harness", () => {
  it("trip fails when no command is selected, so no property passes vacuously (#323)", () => {
    const [veh] = defaultSite.commands;
    if (veh === undefined) throw new Error("no command");
    const c: DraftCase = {
      command: { ...veh, queryType: "NOPE" },
      draft: {},
      positioned: [],
      unpositioned: [],
    };
    expect(() => trip(defaultSite, c)).toThrow("no command selected");
  });
});

describe.each(cases)(
  "[A5] terminal round trip, $name (FR-056, spec 4.4)",
  ({ config, command }) => {
    const qt = command.queryType;
    const arb = draftFor(config, command, now);

    it("[A5] positioned user values survive format then tokenize", () => {
      fc.assert(
        fc.property(arb, (c) => {
          const { selected, formatted, tokens, merged } = trip(config, c);
          expect(selected?.code).toBe(command.code);
          expect(formatted.errors).toEqual([]);
          expect(tokens.errors).toEqual([]);
          const before = canonDraft(config, qt, c.draft);
          expect(canonDraft(config, qt, merged)).toEqual(before);
          for (const key of c.positioned) {
            expect(before.errors[key]).toBeUndefined();
            const { dataType } = fieldDef(config, qt, key);
            const exact = dataType === "string" || dataType === "picklist";
            if (exact && !isEmpty(c.draft[key])) expect(merged[key]).toBe(c.draft[key]);
            if (isEmpty(c.draft[key])) expect(merged[key]).toBeNull();
          }
        }),
        runs,
      );
    });

    it("[A5] unpositioned user values are kept", () => {
      fc.assert(
        fc.property(arb, (c) => {
          const { merged } = trip(config, c);
          for (const key of c.unpositioned) expect(merged[key]).toBe(c.draft[key]);
        }),
        runs,
      );
    });

    it("[A5] unshownCount counts the non-empty values neither positioned nor preset alike", () => {
      fc.assert(
        fc.property(arb, presetOverrides(command), (c, overrides) => {
          const draft = { ...c.draft, ...overrides };
          const { unshownCount } = formatCommand(config, command.code, draft, { now });
          expect(unshownCount).toBe(expectedUnshown(config, command, draft));
        }),
        runs,
      );
    });

    it("[A5] canonicalisation is idempotent on terminal-emitted text", () => {
      fc.assert(
        fc.property(arb, (c) => {
          const { tokens } = trip(config, c);
          for (const key of tokens.positionedKeys) {
            const text = tokens.userValues[key] ?? "";
            if (text === "") continue;
            const field = fieldDef(config, qt, key);
            const ctx = { now, codes: enabledCodes(config, qt, key, now) };
            const once = canonicalise(field, text, ctx);
            expect(once.errors).toEqual([]);
            expect(canonicalise(field, once.value, ctx)).toEqual(once);
          }
        }),
        runs,
      );
    });
  },
);

describe("[A5] unpositioned user values are kept: named-only fields on example-ok", () => {
  it("[A5] plateType and tagSticker survive a VEH round trip", () => {
    const command = exampleOkSite.commands.find((c) => c.code === "VEH");
    if (command === undefined) throw new Error("no VEH command");
    const arb = draftFor(exampleOkSite, command, now).filter(
      (c) => !isEmpty(c.draft.plateType) && !isEmpty(c.draft.tagSticker),
    );
    fc.assert(
      fc.property(arb, (c) => {
        const { merged } = trip(exampleOkSite, c);
        expect(merged.plateType).toBe(c.draft.plateType);
        expect(merged.tagSticker).toBe(c.draft.tagSticker);
      }),
      runs,
    );
  });
});

/** Spec 4.4 NAM table: a command over number, boolean and date fields. */
function namSite(delimiter: string): TerminalConfig {
  return {
    defaults: {},
    picklists: [],
    queryTypes: [
      QueryTypeSchema.parse({
        code: "NAM",
        labelKey: "queryType.NAM",
        sections: [{ key: "base", labelKey: "section.base" }],
        fields: [
          { key: "count", labelKey: "field.count", dataType: "number" },
          { key: "amount", labelKey: "field.amount", dataType: "number", numberKind: "decimal" },
          { key: "flag", labelKey: "field.flag", dataType: "boolean" },
          {
            key: "seen",
            labelKey: "field.seen",
            dataType: "date",
            inputFormats: ["MMDDYYYY"],
            outputFormat: "YYYY-MM-DD",
          },
        ],
        rules: [],
        sources: [{ sourceId: "stateSource", selectedByDefault: true }],
      }),
    ],
    commands: [
      {
        code: "NAM",
        queryType: "NAM",
        positions: delimiter === "." ? ["count", "flag"] : ["count", "amount", "flag", "seen"],
      },
    ],
    terminal: { delimiter },
  };
}

describe("[A5] NAM table: number, boolean and date fields round trip (spec 4.4)", () => {
  const slash = namSite("/");
  const dot = namSite(".");
  it.each([
    ["integer", dot, "count", -12, "NAM.-12"],
    ["integer on /", slash, "count", "-12", "NAM/-12"],
    ["decimal on /", slash, "amount", "3.5", "NAM//3.5"],
    ["boolean Y", dot, "flag", "Y", "NAM..Y"],
    ["boolean n", dot, "flag", "n", "NAM..N"],
    ["boolean 1", slash, "flag", "1", "NAM///Y"],
    ["boolean false", slash, "flag", "false", "NAM///N"],
    ["date YYYY-MM-DD on /", slash, "seen", "1901-01-01", "NAM////1901-01-01"],
  ] as const)("%s", (_name, config, key, value, text) => {
    const draft: Draft = { [key]: value };
    const formatted = formatCommand(config, "NAM", draft, { now });
    expect(formatted).toEqual({ text, errors: [], unshownCount: 0 });
    const tokens = tokenize(config, formatted.text);
    expect(tokens.errors).toEqual([]);
    const merged = mergeDraft(draft, tokens, config);
    expect(canonDraft(config, "NAM", merged)).toEqual(canonDraft(config, "NAM", draft));
    const field = fieldDef(config, "NAM", key);
    const once = canonicalise(field, merged[key] ?? null, { now });
    expect(canonicalise(field, once.value, { now })).toEqual(once);
  });
});
