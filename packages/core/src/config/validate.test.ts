import { describe, expect, it } from "vitest";
import { type SiteConfigInput, SiteConfigSchema } from "./schema";
import { MINIMAL_LOCALES, minimalSiteConfigInput, TEST_TOKEN_NAMES } from "./test-fixtures";
import { validateSiteConfig } from "./validate";

export function run(mutate: (raw: SiteConfigInput) => void, locales = MINIMAL_LOCALES) {
  const raw = minimalSiteConfigInput();
  mutate(raw);
  return validateSiteConfig(SiteConfigSchema.parse(raw), locales, { tokenNames: TEST_TOKEN_NAMES });
}

export type Case = {
  name: string;
  mutate: (raw: SiteConfigInput) => void;
  path: string;
  key: string;
};

export const veh = (raw: SiteConfigInput) => {
  const q = raw.queryTypes[0];
  if (!q) throw new Error("fixture has VEH");
  return q;
};
export const wnt = (raw: SiteConfigInput) =>
  raw.queryTypes.push({
    code: "WNT",
    labelKey: "queryType.VEH",
    sections: [{ key: "base", labelKey: "section.base" }],
    fields: [{ key: "last", labelKey: "field.plate", dataType: "string" }],
    sources: [{ sourceId: "src1", selectedByDefault: true }],
  });

export const PART1_CASES: Case[] = [
  {
    name: "duplicate picklist id",
    mutate: (r) =>
      r.picklists?.push({ id: "state", values: [{ code: "X", labelKey: "field.plate" }] }),
    path: "/picklists/1/id",
    key: "config.duplicateKey",
  },
  {
    name: "command codes compared case-folded",
    mutate: (r) => r.commands?.push({ code: "veh", queryType: "VEH", positions: ["plate"] }),
    path: "/commands/1/code",
    key: "config.duplicateKey",
  },
  {
    name: "duplicate field key",
    mutate: (r) =>
      veh(r).fields.push({ key: "plate", labelKey: "field.plate", dataType: "string" }),
    path: "/queryTypes/0/fields/2/key",
    key: "config.duplicateKey",
  },
  {
    name: "unknown feature key",
    mutate: (r) => {
      r.features = { bogus: true };
    },
    path: "/features/bogus",
    key: "config.unknownFeature",
  },
  {
    name: "rule targets unknown field",
    mutate: (r) => {
      veh(r).rules = [
        { field: "sate", when: { field: "state", op: "eq", value: "TX" }, effect: "show" },
      ];
    },
    path: "/queryTypes/0/rules/0/field",
    key: "config.unknownField",
  },
  {
    name: "condition reads unknown field",
    mutate: (r) => {
      veh(r).rules = [
        { field: "plate", when: { field: "sate", op: "eq", value: "OK" }, effect: "require" },
      ];
    },
    path: "/queryTypes/0/rules/0/when/field",
    key: "config.unknownField",
  },
  {
    name: "nested condition path",
    mutate: (r) => {
      veh(r).rules = [
        {
          field: "plate",
          when: {
            all: [
              { field: "state", op: "eq", value: "TX" },
              { field: "sate", op: "empty" },
            ],
          },
          effect: "require",
        },
      ];
    },
    path: "/queryTypes/0/rules/0/when/all/1/field",
    key: "config.unknownField",
  },
  {
    name: "$default names a field with no configured default",
    mutate: (r) => {
      veh(r).rules = [
        {
          field: "state",
          when: { field: "plate", op: "neq", value: { $default: "plate" } },
          effect: "show",
        },
      ];
    },
    path: "/queryTypes/0/rules/0/when/value/$default",
    key: "config.noConfiguredDefault",
  },
  {
    name: "ordering operator on a string field",
    mutate: (r) => {
      veh(r).rules = [
        { field: "state", when: { field: "plate", op: "gt", value: "A" }, effect: "show" },
      ];
    },
    path: "/queryTypes/0/rules/0/when/op",
    key: "config.orderingOnNonOrdered",
  },
  {
    name: "unknown picklist",
    mutate: (r) => {
      const f = veh(r).fields[1];
      if (f) f.picklist = "states";
    },
    path: "/queryTypes/0/fields/1/picklist",
    key: "config.unknownPicklist",
  },
  {
    name: "unknown section",
    mutate: (r) => {
      const f = veh(r).fields[0];
      if (f) f.section = "expanded";
    },
    path: "/queryTypes/0/fields/0/section",
    key: "config.unknownSection",
  },
  {
    name: "query type source unknown",
    mutate: (r) => {
      veh(r).sources = [{ sourceId: "nope", selectedByDefault: true }];
    },
    path: "/queryTypes/0/sources/0/sourceId",
    key: "config.unknownSource",
  },
  {
    name: "command names unknown query type",
    mutate: (r) => {
      const c = r.commands?.[0];
      if (c) c.queryType = "XYZ";
    },
    path: "/commands/0/queryType",
    key: "config.unknownQueryType",
  },
  {
    name: "command position names unknown field",
    mutate: (r) => {
      const c = r.commands?.[0];
      if (c) c.positions = ["plate", "sate"];
    },
    path: "/commands/0/positions/1",
    key: "config.unknownField",
  },
  {
    name: "command position object form names unknown field",
    mutate: (r) => {
      const c = r.commands?.[0];
      if (c) c.positions = ["plate", { field: "sate", rest: true }];
    },
    path: "/commands/0/positions/1",
    key: "config.unknownField",
  },
  {
    name: "command preset names unknown field",
    mutate: (r) => {
      const c = r.commands?.[0];
      if (c) c.presets = { sate: "TX" };
    },
    path: "/commands/0/presets/sate",
    key: "config.unknownField",
  },
  {
    name: "quickAccess names unknown query type",
    mutate: (r) => {
      r.quickAccess = ["VEH", "PER"];
    },
    path: "/quickAccess/1",
    key: "config.unknownQueryType",
  },
  {
    name: "mapping names unknown persona",
    mutate: (r) => {
      r.responseMappings = [
        {
          id: "m1",
          queryType: "VEH",
          persona: "pilot",
          elements: [{ kind: "value", path: "status", labelKey: "field.plate", view: "both" }],
        },
      ];
    },
    path: "/responseMappings/0/persona",
    key: "config.unknownPersona",
  },
  {
    name: "alsoRun names unknown query type",
    mutate: (r) => {
      veh(r).alsoRun = [{ queryType: "WNT", fieldMap: {} }];
    },
    path: "/queryTypes/0/alsoRun/0/queryType",
    key: "config.unknownQueryType",
  },
  {
    name: "fieldMap target not in nested type",
    mutate: (r) => {
      wnt(r);
      veh(r).alsoRun = [{ queryType: "WNT", fieldMap: { nope: "plate" } }];
    },
    path: "/queryTypes/0/alsoRun/0/fieldMap/nope",
    key: "config.unknownField",
  },
  {
    name: "fieldMap source not in parent",
    mutate: (r) => {
      wnt(r);
      veh(r).alsoRun = [{ queryType: "WNT", fieldMap: { last: "sate" } }];
    },
    path: "/queryTypes/0/alsoRun/0/fieldMap/last",
    key: "config.unknownField",
  },
  {
    name: "unknown severity token",
    mutate: (r) => {
      r.keywordSeverityStyles.critical.color = "color.nope";
    },
    path: "/keywordSeverityStyles/critical/color",
    key: "config.unknownToken",
  },
  {
    name: "unknown shortcut action",
    mutate: (r) => {
      r.shortcuts = { launchRockets: { keys: "KeyL", context: "global" } };
    },
    path: "/shortcuts/launchRockets",
    key: "config.unknownAction",
  },
  {
    name: "labelKey missing from a locale",
    mutate: (r) => {
      const s = r.sources[0];
      if (s) s.labelKey = "source.missing";
    },
    path: "/sources/0/labelKey",
    key: "config.missingLabel",
  },
  {
    name: "locale listed without a bundle",
    mutate: (r) => {
      r.locales = ["en", "fr"];
    },
    path: "/locales/1",
    key: "config.missingLocale",
  },
  {
    name: "condition with any reads unknown field",
    mutate: (r) => {
      veh(r).rules = [
        { field: "plate", when: { any: [{ field: "sate", op: "empty" }] }, effect: "require" },
      ];
    },
    path: "/queryTypes/0/rules/0/when/any/0/field",
    key: "config.unknownField",
  },
  {
    name: "condition with not reads unknown field",
    mutate: (r) => {
      veh(r).rules = [
        { field: "plate", when: { not: { field: "sate", op: "empty" } }, effect: "require" },
      ];
    },
    path: "/queryTypes/0/rules/0/when/not/field",
    key: "config.unknownField",
  },
  {
    name: "picklistFilter byField names unknown field",
    mutate: (r) => {
      const f = veh(r).fields[1];
      if (f) f.picklistFilter = { byField: "sate" };
    },
    path: "/queryTypes/0/fields/1/picklistFilter/byField",
    key: "config.unknownField",
  },
  {
    name: "unknown theme token override",
    mutate: (r) => {
      r.theme = { tokens: { day: { "color.nope": "x" } } };
    },
    path: "/theme/tokens/day/color.nope",
    key: "config.unknownToken",
  },
  {
    name: "$default names a field that does not exist",
    mutate: (r) => {
      veh(r).rules = [
        {
          field: "state",
          when: { field: "plate", op: "neq", value: { $default: "sate" } },
          effect: "show",
        },
      ];
    },
    path: "/queryTypes/0/rules/0/when/value/$default",
    key: "config.unknownField",
  },
  {
    name: "mapping references unknown source",
    mutate: (r) => {
      r.responseMappings = [
        {
          id: "m1",
          queryType: "VEH",
          sourceId: "nope",
          elements: [{ kind: "value", path: "status", labelKey: "field.plate", view: "both" }],
        },
      ];
    },
    path: "/responseMappings/0/sourceId",
    key: "config.unknownSource",
  },
];

describe("BR-001 validateSiteConfig referential pass (spec 4.1 Validation)", () => {
  it("the minimal config has no errors and no warnings", () => {
    expect(run(() => {})).toEqual({ errors: [], warnings: [] });
  });

  for (const c of PART1_CASES) {
    it(`error: ${c.name} at ${c.path}`, () => {
      expect(run(c.mutate).errors).toContainEqual(
        expect.objectContaining({ level: "error", path: c.path, key: c.key }),
      );
    });
  }

  it("missing label names the label and the locale", () => {
    const { errors } = run((r) => {
      const s = r.sources[0];
      if (s) s.labelKey = "source.missing";
    });
    expect(errors).toContainEqual({
      level: "error",
      path: "/sources/0/labelKey",
      key: "config.missingLabel",
      params: { labelKey: "source.missing", locale: "en" },
    });
  });

  it("skips token checks when no token names are supplied", () => {
    const raw = minimalSiteConfigInput();
    raw.keywordSeverityStyles.critical.color = "color.nope";
    expect(validateSiteConfig(SiteConfigSchema.parse(raw), MINIMAL_LOCALES).errors).toEqual([]);
  });

  it("rejects a source kind not in the supplied adapter registry", () => {
    const raw = minimalSiteConfigInput();
    const { errors } = validateSiteConfig(SiteConfigSchema.parse(raw), MINIMAL_LOCALES, {
      adapterKinds: ["real"],
    });
    expect(errors).toContainEqual({
      level: "error",
      path: "/sources/0/kind",
      key: "config.unknownAdapterKind",
      params: { kind: "mock" },
    });
  });

  it("passes when the source kind is in the supplied adapter registry", () => {
    const raw = minimalSiteConfigInput();
    const { errors } = validateSiteConfig(SiteConfigSchema.parse(raw), MINIMAL_LOCALES, {
      adapterKinds: ["mock"],
    });
    expect(errors).toEqual([]);
  });

  it("a table response mapping column's missing label names the label and the locale", () => {
    const { errors } = run((r) => {
      r.responseMappings = [
        {
          id: "m1",
          queryType: "VEH",
          elements: [
            {
              kind: "table",
              path: "rows",
              labelKey: "field.plate",
              view: "both",
              columns: [{ path: "x", labelKey: "table.missing" }],
            },
          ],
        },
      ];
    });
    expect(errors).toContainEqual({
      level: "error",
      path: "/responseMappings/0/elements/0/columns/0/labelKey",
      key: "config.missingLabel",
      params: { labelKey: "table.missing", locale: "en" },
    });
  });

  it("$default resolving to a configured site default produces no error", () => {
    const { errors } = run((r) => {
      veh(r).rules = [
        {
          field: "plate",
          when: { field: "plate", op: "neq", value: { $default: "state" } },
          effect: "show",
        },
      ];
    });
    expect(errors).toEqual([]);
  });

  it("a known feature key produces no error", () => {
    const { errors } = run((r) => {
      r.features = { credentials: true };
    });
    expect(errors).toEqual([]);
  });

  it("a section's when condition is checked", () => {
    const { errors } = run((r) => {
      veh(r).sections = [
        { key: "base", labelKey: "section.base", when: { field: "sate", op: "empty" } },
      ];
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: "/queryTypes/0/sections/0/when/field",
        key: "config.unknownField",
      }),
    );
  });

  it("a query type source's when condition is checked", () => {
    const { errors } = run((r) => {
      veh(r).sources = [
        { sourceId: "src1", selectedByDefault: true, when: { field: "sate", op: "empty" } },
      ];
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: "/queryTypes/0/sources/0/when/field",
        key: "config.unknownField",
      }),
    );
  });

  it("a valid alsoRun fieldMap target produces no error", () => {
    const { errors } = run((r) => {
      wnt(r);
      veh(r).alsoRun = [{ queryType: "WNT", fieldMap: { last: "plate" } }];
    });
    expect(errors).toEqual([]);
  });

  it("an alsoRun when condition is checked", () => {
    const { errors } = run((r) => {
      wnt(r);
      veh(r).alsoRun = [{ queryType: "WNT", fieldMap: {}, when: { field: "sate", op: "empty" } }];
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: "/queryTypes/0/alsoRun/0/when/field",
        key: "config.unknownField",
      }),
    );
  });

  it("a command preset naming a known, non-positioned field produces no error", () => {
    const { errors } = run((r) => {
      const c = r.commands?.[0];
      if (c) {
        c.positions = ["plate"];
        c.presets = { state: "TX" };
      }
    });
    expect(errors).toEqual([]);
  });

  it("a response mapping naming an unknown query type is rejected", () => {
    const { errors } = run((r) => {
      r.responseMappings = [
        {
          id: "m1",
          queryType: "XYZ",
          elements: [{ kind: "value", path: "status", labelKey: "field.plate", view: "both" }],
        },
      ];
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: "/responseMappings/0/queryType",
        key: "config.unknownQueryType",
      }),
    );
  });

  it("a response mapping's when condition is checked", () => {
    const { errors } = run((r) => {
      r.responseMappings = [
        {
          id: "m1",
          queryType: "VEH",
          when: { field: "sate", op: "empty" },
          elements: [{ kind: "value", path: "status", labelKey: "field.plate", view: "both" }],
        },
      ];
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: "/responseMappings/0/when/field",
        key: "config.unknownField",
      }),
    );
  });

  it("a theme token override that matches a known token produces no error", () => {
    const { errors } = run((r) => {
      r.theme = { tokens: { day: { "color.severity.critical.fg": "x" } } };
    });
    expect(errors).toEqual([]);
  });

  it("a known shortcut action override produces no error", () => {
    const { errors } = run((r) => {
      r.shortcuts = { submit: { keys: "Ctrl+Enter", context: "panel" } };
    });
    expect(errors).toEqual([]);
  });

  it("skips adapter kind checks when adapterKinds is not supplied", () => {
    const raw = minimalSiteConfigInput();
    const s = raw.sources[0];
    if (s) s.kind = "totally-unknown-adapter";
    expect(validateSiteConfig(SiteConfigSchema.parse(raw), MINIMAL_LOCALES).errors).toEqual([]);
  });
});

const PART2_CASES: Case[] = [
  {
    name: "no base section",
    mutate: (r) => {
      veh(r).sections = [{ key: "main", labelKey: "section.base" }];
    },
    path: "/queryTypes/0/sections",
    key: "config.missingBaseSection",
  },
  {
    name: "picklist field without picklist",
    mutate: (r) =>
      veh(r).fields.push({ key: "colour", labelKey: "field.plate", dataType: "picklist" }),
    path: "/queryTypes/0/fields/2/picklist",
    key: "config.picklistRequired",
  },
  {
    name: "picklist on a non-picklist field",
    mutate: (r) => {
      const f = veh(r).fields[0];
      if (f) f.picklist = "state";
    },
    path: "/queryTypes/0/fields/0/picklist",
    key: "config.picklistNotAllowed",
  },
  {
    name: "role type on a non-picklist field",
    mutate: (r) => {
      const f = veh(r).fields[0];
      if (f) f.role = "type";
    },
    path: "/queryTypes/0/fields/0/role",
    key: "config.typeRoleOnNonPicklist",
  },
  {
    name: "picklistFilter on a non-picklist field",
    mutate: (r) => {
      const f = veh(r).fields[0];
      if (f) f.picklistFilter = { byField: "state" };
    },
    path: "/queryTypes/0/fields/0/picklistFilter",
    key: "config.picklistFilterOnNonPicklist",
  },
  {
    name: "byField is not a picklist field",
    mutate: (r) => {
      const f = veh(r).fields[1];
      if (f) f.picklistFilter = { byField: "plate" };
    },
    path: "/queryTypes/0/fields/1/picklistFilter/byField",
    key: "config.byFieldNotPicklist",
  },
  {
    name: "parent code absent from the byField picklist",
    mutate: (r) => {
      r.picklists?.push({
        id: "city",
        values: [{ code: "AUS", labelKey: "field.plate", parent: "ZZ" }],
      });
      veh(r).fields.push({
        key: "city",
        labelKey: "field.plate",
        dataType: "picklist",
        picklist: "city",
        picklistFilter: { byField: "state" },
      });
    },
    path: "/picklists/1/values/0/parent",
    key: "config.unknownParent",
  },
  {
    name: "picklistFilter cycle",
    mutate: (r) => {
      const f = veh(r).fields[1];
      if (f) f.picklistFilter = { byField: "state" };
    },
    path: "/queryTypes/0/fields/1/picklistFilter",
    key: "config.picklistFilterCycle",
  },
  {
    name: "minLength above maxLength",
    mutate: (r) => {
      const f = veh(r).fields[0];
      if (f) {
        f.minLength = 10;
        f.maxLength = 5;
      }
    },
    path: "/queryTypes/0/fields/0/minLength",
    key: "config.minAboveMax",
  },
  {
    name: "maxLength above 4096",
    mutate: (r) => {
      const f = veh(r).fields[0];
      if (f) f.maxLength = 5000;
    },
    path: "/queryTypes/0/fields/0/maxLength",
    key: "config.maxLengthTooLarge",
  },
  {
    name: "pattern does not compile",
    mutate: (r) => {
      const f = veh(r).fields[0];
      if (f) f.pattern = "[A-";
    },
    path: "/queryTypes/0/fields/0/pattern",
    key: "config.invalidPattern",
  },
  {
    name: "setDefault without value",
    mutate: (r) => {
      veh(r).rules = [
        { field: "state", when: { field: "plate", op: "notEmpty" }, effect: "setDefault" },
      ];
    },
    path: "/queryTypes/0/rules/0/value",
    key: "config.ruleValueMismatch",
  },
  {
    name: "allowPlateOnly without a plateOnly source",
    mutate: (r) => {
      veh(r).allowPlateOnly = true;
    },
    path: "/queryTypes/0/allowPlateOnly",
    key: "config.plateOnlyUnsupported",
  },
  {
    name: "more than 4 alsoRun entries",
    mutate: (r) => {
      wnt(r);
      veh(r).alsoRun = [1, 2, 3, 4, 5].map(() => ({ queryType: "WNT", fieldMap: {} }));
    },
    path: "/queryTypes/0/alsoRun",
    key: "config.tooManyAlsoRun",
  },
  {
    name: "nested query type declares alsoRun",
    mutate: (r) => {
      wnt(r);
      const w = r.queryTypes[1];
      if (w) w.alsoRun = [{ queryType: "VEH", fieldMap: {} }];
      veh(r).alsoRun = [{ queryType: "WNT", fieldMap: {} }];
    },
    path: "/queryTypes/0/alsoRun/0/queryType",
    key: "config.nestedAlsoRun",
  },
  {
    name: "rest position not last",
    mutate: (r) => {
      const c = r.commands?.[0];
      if (c) c.positions = [{ field: "plate", rest: true }, "state"];
    },
    path: "/commands/0/positions/0",
    key: "config.restNotLast",
  },
  {
    name: "rest position on a non-string field",
    mutate: (r) => {
      const c = r.commands?.[0];
      if (c) c.positions = ["plate", { field: "state", rest: true }];
    },
    path: "/commands/0/positions/1",
    key: "config.restNotString",
  },
  {
    name: "field both preset and positioned",
    mutate: (r) => {
      const c = r.commands?.[0];
      if (c) c.presets = { state: "TX" };
    },
    path: "/commands/0/presets/state",
    key: "config.presetAndPositioned",
  },
  {
    name: "required field with no position, preset or default",
    mutate: (r) => {
      const c = r.commands?.[0];
      if (c) c.positions = ["state"];
    },
    path: "/commands/0/positions",
    key: "config.requiredWithoutPosition",
  },
  {
    name: "delimiter is =",
    mutate: (r) => {
      r.terminal = { delimiter: "=" };
    },
    path: "/terminal/delimiter",
    key: "config.invalidDelimiter",
  },
  {
    name: "delimiter is alphanumeric",
    mutate: (r) => {
      r.terminal = { delimiter: "x" };
    },
    path: "/terminal/delimiter",
    key: "config.invalidDelimiter",
  },
  {
    name: "delimiter inside a date input format",
    mutate: (r) => {
      r.terminal = { delimiter: "-" };
      veh(r).fields.push({ key: "dob", labelKey: "field.plate", dataType: "date" });
    },
    path: "/queryTypes/0/fields/2/inputFormats",
    key: "config.delimiterInDateFormat",
  },
  {
    name: "decimal field in a position with the . delimiter",
    mutate: (r) => {
      veh(r).fields.push({
        key: "weight",
        labelKey: "field.plate",
        dataType: "number",
        numberKind: "decimal",
      });
      const c = r.commands?.[0];
      if (c) c.positions = ["plate", "state", "weight"];
    },
    path: "/commands/0/positions/2",
    key: "config.decimalWithDotDelimiter",
  },
  {
    name: "delimiter typed by a single-key shortcut",
    mutate: (r) => {
      r.terminal = { delimiter: "/" };
    },
    path: "/terminal/delimiter",
    key: "config.delimiterShortcutCollision",
  },
  {
    name: "shortcut bound to a text-editing combo",
    mutate: (r) => {
      r.shortcuts = { submit: { keys: "Ctrl+Shift+KeyZ", context: "panel" } };
    },
    path: "/shortcuts/submit",
    key: "config.shortcutEditingCombo",
  },
  {
    name: "shortcut chord with a text-editing combo stroke",
    mutate: (r) => {
      r.shortcuts = { goPanel: { keys: "KeyG Ctrl+KeyA", context: "global" } };
    },
    path: "/shortcuts/goPanel",
    key: "config.shortcutEditingCombo",
  },
  {
    name: "shortcut prefix collision",
    mutate: (r) => {
      r.shortcuts = { goPanel: { keys: "KeyG", context: "global" } };
    },
    path: "/shortcuts/goPanel",
    key: "config.shortcutCollision",
  },
  {
    name: "two mappings with equal keys",
    mutate: (r) => {
      const el = {
        kind: "value" as const,
        path: "status",
        labelKey: "field.plate",
        view: "both" as const,
      };
      r.responseMappings = [
        { id: "m1", queryType: "VEH", elements: [el] },
        { id: "m2", queryType: "VEH", elements: [el] },
      ];
    },
    path: "/responseMappings/1",
    key: "config.duplicateMapping",
  },
  {
    name: "except phrase without its keyword",
    mutate: (r) => {
      const k = r.keywords?.[0];
      if (k) k.except = ["RECOVERED"];
    },
    path: "/keywords/0/except/0",
    key: "config.exceptWithoutKeyword",
  },
  {
    name: "purpose duration above the site cap",
    mutate: (r) => {
      r.delegation = {
        maxDurationMinutes: 60,
        purposes: [
          {
            key: "training",
            labelKey: "delegation.training",
            delegatorRoles: ["trainingOfficer"],
            maxDurationMinutes: 120,
          },
        ],
      };
    },
    path: "/delegation/purposes/0/maxDurationMinutes",
    key: "config.purposeDurationTooLong",
  },
  {
    name: "retention days not positive",
    mutate: (r) => {
      r.retention = { payloadDays: 0, valuesDays: null };
    },
    path: "/retention/payloadDays",
    key: "config.retentionNotPositive",
  },
];

describe("FR-051 FR-052 validateSiteConfig field, command and terminal rules (spec 4.1)", () => {
  for (const c of PART2_CASES) {
    it(`error: ${c.name} at ${c.path}`, () => {
      expect(run(c.mutate).errors).toContainEqual(
        expect.objectContaining({ level: "error", path: c.path, key: c.key }),
      );
    });
  }

  it("a multi-field picklistFilter cycle is reported once, at its first field", () => {
    const { errors } = run((r) => {
      const fields = veh(r).fields;
      const state = fields[1];
      if (state) state.picklistFilter = { byField: "region" };
      fields.push(
        {
          key: "region",
          labelKey: "field.state",
          dataType: "picklist",
          picklist: "state",
          picklistFilter: { byField: "county" },
        },
        {
          key: "county",
          labelKey: "field.state",
          dataType: "picklist",
          picklist: "state",
          picklistFilter: { byField: "state" },
        },
        {
          key: "town",
          labelKey: "field.state",
          dataType: "picklist",
          picklist: "state",
          picklistFilter: { byField: "state" },
        },
      );
    });
    expect(errors.filter((e) => e.key === "config.picklistFilterCycle")).toEqual([
      expect.objectContaining({ path: "/queryTypes/0/fields/1/picklistFilter" }),
    ]);
  });

  it("the example-ok pattern passes: / delimiter with focusTerminal rebound to Ctrl+Slash", () => {
    const { errors } = run((r) => {
      r.terminal = { delimiter: "/" };
      r.shortcuts = { focusTerminal: { keys: "Ctrl+Slash", context: "global" } };
    });
    expect(errors).toEqual([]);
  });

  it("purpose duration equal to the site cap passes", () => {
    const { errors } = run((r) => {
      r.delegation = {
        maxDurationMinutes: 60,
        purposes: [
          {
            key: "training",
            labelKey: "delegation.training",
            delegatorRoles: ["trainingOfficer"],
            maxDurationMinutes: 60,
          },
        ],
      };
    });
    expect(errors).toEqual([]);
  });

  it("a configured default exempts a required field from needing a position", () => {
    const { errors } = run((r) => {
      const plate = veh(r).fields[0];
      if (plate) plate.defaultValue = "ZZ-0000";
      const c = r.commands?.[0];
      if (c) c.positions = ["state"];
    });
    expect(errors).toEqual([]);
  });

  it("warning: site default used by no field", () => {
    expect(
      run((r) => {
        r.defaults = { state: "TX", colour: "RED" };
      }).warnings,
    ).toContainEqual({
      level: "warning",
      path: "/defaults/colour",
      key: "config.unusedSiteDefault",
      params: { field: "colour" },
    });
  });

  it("warning: worst-case (part, source) count above 8", () => {
    const { warnings } = run((r) => {
      for (let i = 2; i <= 9; i++) {
        r.sources.push({
          id: `src${i}`,
          labelKey: "source.src1",
          scope: "state",
          kind: "mock",
          requiresCredentials: false,
        });
        veh(r).sources.push({ sourceId: `src${i}`, selectedByDefault: false });
      }
    });
    expect(warnings).toContainEqual({
      level: "warning",
      path: "/queryTypes/0",
      key: "config.tooManySourcesPossible",
      params: { max: 8 },
    });
  });
});

describe("Task 13 controller ruling 1: CommandDef.code vs config.terminal.delimiter", () => {
  it("error: default . delimiter rejects a command code containing it", () => {
    const { errors } = run((r) => {
      r.commands?.push({ code: "V.EH", queryType: "VEH", positions: ["plate", "state"] });
    });
    expect(errors).toContainEqual({
      level: "error",
      path: "/commands/1/code",
      key: "config.commandCodeContainsDelimiter",
      params: { delimiter: "." },
    });
  });

  it("a radio-style code with an internal hyphen passes under the default . delimiter", () => {
    const { errors } = run((r) => {
      r.commands?.push({ code: "10-28", queryType: "VEH", positions: ["plate", "state"] });
    });
    expect(errors).toEqual([]);
  });

  it("error: with delimiter -, 10-28 is rejected", () => {
    const { errors } = run((r) => {
      r.terminal = { delimiter: "-" };
      r.commands?.push({ code: "10-28", queryType: "VEH", positions: ["plate", "state"] });
    });
    expect(errors).toContainEqual({
      level: "error",
      path: "/commands/1/code",
      key: "config.commandCodeContainsDelimiter",
      params: { delimiter: "-" },
    });
  });
});

describe('Task 13 amendment (ADR-0005): role:"type" field picklists validate with TypePicklistCodeSchema', () => {
  it("error: a role:type field's picklist has a code TypePicklistCodeSchema rejects", () => {
    const { errors } = run((r) => {
      r.picklists?.push({
        id: "queryKind",
        values: [{ code: "BLK/WHI", labelKey: "field.plate" }],
      });
      veh(r).fields.push({
        key: "kind",
        labelKey: "field.plate",
        dataType: "picklist",
        picklist: "queryKind",
        role: "type",
      });
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        level: "error",
        path: "/picklists/1/values/0/code",
        key: "config.invalidTypePicklistCode",
      }),
    );
  });

  it("a picklist referenced by a non-type field keeps wider codes such as BLK/WHI", () => {
    const { errors } = run((r) => {
      r.picklists?.push({ id: "color", values: [{ code: "BLK/WHI", labelKey: "field.plate" }] });
      veh(r).fields.push({
        key: "colour",
        labelKey: "field.plate",
        dataType: "picklist",
        picklist: "color",
      });
    });
    expect(errors).toEqual([]);
  });

  it("a role:type field's picklist with only TypePicklistCodeSchema-valid codes produces no error", () => {
    const { errors } = run((r) => {
      r.picklists?.push({ id: "queryKind", values: [{ code: "VEH2", labelKey: "field.plate" }] });
      veh(r).fields.push({
        key: "kind",
        labelKey: "field.plate",
        dataType: "picklist",
        picklist: "queryKind",
        role: "type",
      });
    });
    expect(errors).toEqual([]);
  });
});

describe("Task 13 branch coverage", () => {
  it("error: shortcutCollision names the overridden later action when the earlier one is still default", () => {
    const { errors } = run((r) => {
      r.shortcuts = { goResults: { keys: "KeyG", context: "global" } };
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        level: "error",
        path: "/shortcuts/goResults",
        key: "config.shortcutCollision",
      }),
    );
  });

  it("a keyword with no except phrases produces no error", () => {
    const { errors } = run((r) => {
      r.keywords?.push({ keyword: "WANTED", severity: "warning" });
    });
    expect(errors).toEqual([]);
  });

  it("error: delimiter inside a date field's outputFormat, with inputFormats clean", () => {
    const { errors } = run((r) => {
      r.terminal = { delimiter: "-" };
      veh(r).fields.push({
        key: "dob",
        labelKey: "field.plate",
        dataType: "date",
        inputFormats: ["MMDDYYYY"],
        outputFormat: "MM-DD-YYYY",
      });
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        level: "error",
        path: "/queryTypes/0/fields/2/outputFormat",
        key: "config.delimiterInDateFormat",
      }),
    );
  });

  it("error: delimiterShortcutCollision names the overridden action's own path", () => {
    const { errors } = run((r) => {
      r.terminal = { delimiter: "," };
      r.shortcuts = { dismiss: { keys: "Comma", context: "global" } };
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        level: "error",
        path: "/shortcuts/dismiss",
        key: "config.delimiterShortcutCollision",
        params: { action: "dismiss" },
      }),
    );
  });
});

describe("FR-060 duplicate mappings (#73)", () => {
  const mapping = (id: string, when?: unknown) => ({
    id,
    queryType: "VEH",
    sourceId: "src1",
    persona: "dispatch",
    ...(when === undefined ? {} : { when }),
    elements: [
      { kind: "value" as const, path: "status", labelKey: "field.plate", view: "both" as const },
    ],
  });
  const dupes = (a?: unknown, b?: unknown) =>
    run((r) => {
      r.responseMappings = [mapping("m1", a), mapping("m2", b)] as never;
    }).errors.filter((e) => e.key === "config.duplicateMapping");

  it("different canonical when conditions are not duplicates", () => {
    expect(
      dupes({ field: "state", op: "eq", value: "OK" }, { field: "state", op: "eq", value: "TX" }),
    ).toEqual([]);
  });
  it("when conditions differing only in literal spelling are duplicates", () => {
    expect(
      dupes({ field: "state", op: "eq", value: "ok" }, { field: "state", op: "eq", value: "OK" }),
    ).toEqual([expect.objectContaining({ path: "/responseMappings/1" })]);
  });
  it("two mappings with no when are still duplicates", () => {
    expect(dupes()).toEqual([expect.objectContaining({ path: "/responseMappings/1" })]);
  });
});

describe("UX-002 site default auto theme (D-B1, #175)", () => {
  it("accepts defaultMode auto with auto os or time", () => {
    for (const auto of ["os", "time"] as const) {
      const { errors } = run((r) => {
        r.theme = { defaultMode: "auto", auto };
      });
      expect(errors).toEqual([]);
    }
  });
  it("rejects defaultMode auto with auto off", () => {
    const { errors } = run((r) => {
      r.theme = { defaultMode: "auto", auto: "off" };
    });
    expect(errors).toContainEqual(
      expect.objectContaining({ path: "/theme/defaultMode", key: "config.autoDefaultNeedsAuto" }),
    );
  });
  it("rejects defaultMode auto when auto is left at its default (off)", () => {
    const { errors } = run((r) => {
      r.theme = { defaultMode: "auto" };
    });
    expect(errors).toContainEqual(expect.objectContaining({ key: "config.autoDefaultNeedsAuto" }));
  });
});
