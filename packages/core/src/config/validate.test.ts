import { describe, expect, it } from "vitest";
import { type SiteConfigInput, SiteConfigSchema } from "./schema";
import { MINIMAL_LOCALES, minimalSiteConfigInput, TEST_TOKEN_NAMES } from "./test-fixtures";
import { validateSiteConfig } from "./validate";

export function run(mutate: (raw: SiteConfigInput) => void, locales = MINIMAL_LOCALES) {
  const raw = minimalSiteConfigInput();
  mutate(raw);
  return validateSiteConfig(SiteConfigSchema.parse(raw), locales, { tokenNames: TEST_TOKEN_NAMES });
}

type Case = { name: string; mutate: (raw: SiteConfigInput) => void; path: string; key: string };

const veh = (raw: SiteConfigInput) => {
  const q = raw.queryTypes[0];
  if (!q) throw new Error("fixture has VEH");
  return q;
};
const wnt = (raw: SiteConfigInput) =>
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

  it("a command preset naming a known field produces no error", () => {
    const { errors } = run((r) => {
      const c = r.commands?.[0];
      if (c) c.presets = { plate: "TX" };
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
