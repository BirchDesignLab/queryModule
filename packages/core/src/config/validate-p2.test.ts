import { describe, expect, it } from "vitest";
import { type SiteConfigInput, SiteConfigSchema } from "./schema";
import { MINIMAL_LOCALES, minimalSiteConfigInput, TEST_TOKEN_NAMES } from "./test-fixtures";
import { type ContrastContext, validateSiteConfig } from "./validate";

type Fields = NonNullable<SiteConfigInput["queryTypes"][number]["fields"]>;

const LOCALES = {
  en: {
    ...(MINIMAL_LOCALES.en ?? {}),
    "field.year": "Year",
    "field.plateType": "Plate type",
    "field.note": "Note",
    "field.propertyType": "Property type",
    "picklist.plateType.PC": "Passenger",
    "picklist.plateType.TK": "Truck",
    "picklist.propertyType.GUN": "Gun",
    "picklist.propertyType.BOAT": "Boat",
    "queryType.PRO": "Property",
  },
};

/** VEH: plate, state, year, plateType, note; PRO: propertyType (BOAT disabled), serial. */
function base(): SiteConfigInput {
  const raw = minimalSiteConfigInput();
  raw.picklists = [
    ...(raw.picklists ?? []),
    {
      id: "plateType",
      values: [
        { code: "PC", labelKey: "picklist.plateType.PC" },
        { code: "TK", labelKey: "picklist.plateType.TK" },
      ],
    },
    {
      id: "propertyType",
      values: [
        { code: "GUN", labelKey: "picklist.propertyType.GUN" },
        { code: "BOAT", labelKey: "picklist.propertyType.BOAT", enabled: false },
      ],
    },
  ];
  const veh = raw.queryTypes[0];
  if (!veh) throw new Error("fixture has VEH");
  veh.fields.push(
    { key: "year", labelKey: "field.year", dataType: "year" },
    { key: "plateType", labelKey: "field.plateType", dataType: "picklist", picklist: "plateType" },
    { key: "note", labelKey: "field.note", dataType: "string", maxLength: 64 },
  );
  raw.queryTypes.push({
    code: "PRO",
    labelKey: "queryType.PRO",
    sections: [{ key: "base", labelKey: "section.base" }],
    fields: [
      {
        key: "propertyType",
        labelKey: "field.propertyType",
        dataType: "picklist",
        picklist: "propertyType",
      },
      { key: "serial", labelKey: "field.note", dataType: "string" },
    ],
    sources: [{ sourceId: "src1", selectedByDefault: true }],
  });
  raw.commands = [
    { code: "VEH", queryType: "VEH", positions: ["plate", "state", "year"] },
    { code: "PRO", queryType: "PRO", positions: ["serial"] },
  ];
  return raw;
}

function run(mutate: (raw: SiteConfigInput) => void, contrast?: ContrastContext) {
  const raw = base();
  mutate(raw);
  return validateSiteConfig(SiteConfigSchema.parse(raw), LOCALES, {
    tokenNames: TEST_TOKEN_NAMES,
    ...(contrast ? { contrast } : {}),
  });
}

const vehicle = (raw: SiteConfigInput) => {
  const q = raw.queryTypes[0];
  if (!q) throw new Error("fixture has VEH");
  return q;
};
const property = (raw: SiteConfigInput) => {
  const q = raw.queryTypes[1];
  if (!q) throw new Error("fixture has PRO");
  return q;
};
const field = (raw: SiteConfigInput, key: string): Fields[number] => {
  const f = vehicle(raw).fields.find((x) => x.key === key);
  if (!f) throw new Error(`no field ${key}`);
  return f;
};
const err = (path: string, key: string, params: Record<string, string | number | boolean>) => ({
  level: "error" as const,
  path,
  key,
  params,
});

describe("baseline", () => {
  it("the fixture is clean", () => {
    expect(run(() => {})).toEqual({ errors: [], warnings: [] });
  });
});

describe("config.invalidLiteral (spec 4.1)", () => {
  it("site default not in picklist, at the site default pointer", () => {
    expect(
      run((r) => {
        r.defaults = { state: "ZZ" };
      }).errors,
    ).toEqual([
      err("/defaults/state", "config.invalidLiteral", {
        field: "state",
        key: "validation.notInPicklist",
      }),
    ]);
  });
  it("field defaultValue that is not a year", () => {
    const { errors } = run((r) => {
      field(r, "year").defaultValue = "abc";
    });
    expect(errors).toContainEqual(
      err("/queryTypes/0/fields/2/defaultValue", "config.invalidLiteral", {
        field: "year",
        key: "validation.invalidYear",
      }),
    );
  });
  it("query type default", () => {
    const { errors } = run((r) => {
      vehicle(r).defaults = { year: "abc" };
    });
    expect(errors).toEqual([
      err("/queryTypes/0/defaults/year", "config.invalidLiteral", {
        field: "year",
        key: "validation.invalidYear",
      }),
    ]);
  });
  it("setDefault value over maxLength", () => {
    const { errors } = run((r) => {
      vehicle(r).rules = [
        {
          field: "note",
          when: { field: "plate", op: "notEmpty" },
          effect: "setDefault",
          value: "x".repeat(65),
        },
      ];
    });
    expect(errors).toEqual([
      err("/queryTypes/0/rules/0/value", "config.invalidLiteral", {
        field: "note",
        key: "validation.tooLong",
      }),
    ]);
  });
  it("preset naming a disabled code", () => {
    const { errors } = run((r) => {
      const c = r.commands?.[1];
      if (c) c.presets = { propertyType: "BOAT" };
    });
    expect(errors).toEqual([
      err("/commands/1/presets/propertyType", "config.invalidLiteral", {
        field: "propertyType",
        key: "validation.notInPicklist",
      }),
    ]);
  });
  it("condition value that is not a year", () => {
    const { errors } = run((r) => {
      vehicle(r).rules = [
        { field: "note", when: { field: "year", op: "gt", value: "soon" }, effect: "hide" },
      ];
    });
    expect(errors).toEqual([
      err("/queryTypes/0/rules/0/when/value", "config.invalidLiteral", {
        field: "year",
        key: "validation.invalidYear",
      }),
    ]);
  });
  it("in-list element, section when, source when and alsoRun when", () => {
    const { errors } = run((r) => {
      const q = vehicle(r);
      q.rules = [
        {
          field: "note",
          when: { field: "year", op: "in", value: ["2001", "soon"] },
          effect: "hide",
        },
      ];
      q.sections = [
        { key: "base", labelKey: "section.base" },
        { key: "more", labelKey: "section.base", when: { field: "year", op: "eq", value: "soon" } },
      ];
      const s = q.sources[0];
      if (s) s.when = { field: "year", op: "eq", value: "soon" };
      q.alsoRun = [
        {
          queryType: "PRO",
          fieldMap: { serial: "plate" },
          when: { field: "year", op: "eq", value: "soon" },
        },
      ];
    });
    expect(errors.map((e) => e.path).sort()).toEqual([
      "/queryTypes/0/alsoRun/0/when/value",
      "/queryTypes/0/rules/0/when/value/1",
      "/queryTypes/0/sections/1/when/value",
      "/queryTypes/0/sources/0/when/value",
    ]);
    expect(errors.every((e) => e.key === "config.invalidLiteral")).toBe(true);
  });
  it("a disabled code in a condition is not an error", () => {
    const { errors } = run((r) => {
      property(r).rules = [
        {
          field: "serial",
          when: { field: "propertyType", op: "eq", value: "BOAT" },
          effect: "hide",
        },
      ];
    });
    expect(errors).toEqual([]);
  });
  it("a default reference is not a literal", () => {
    const { errors } = run((r) => {
      vehicle(r).rules = [
        {
          field: "note",
          when: { field: "state", op: "neq", value: { $default: "state" } },
          effect: "hide",
        },
      ];
    });
    expect(errors).toEqual([]);
  });
  it("an unknown field is skipped (the reference check reports it)", () => {
    const { errors } = run((r) => {
      vehicle(r).defaults = { nope: "x" };
    });
    expect(errors.map((e) => e.key)).toEqual(["config.unknownField"]);
  });
});

describe("config.unreachableRuleTarget (spec 4.1)", () => {
  const hidden = (effect: "require" | "setDefault", withShow: boolean) => (r: SiteConfigInput) => {
    field(r, "plateType").visible = false;
    vehicle(r).rules = [
      {
        field: "plateType",
        when: { field: "plate", op: "notEmpty" },
        effect,
        ...(effect === "setDefault" ? { value: "PC" } : {}),
      },
      ...(withShow
        ? [
            {
              field: "plateType",
              when: { field: "plate", op: "notEmpty" as const },
              effect: "show" as const,
            },
          ]
        : []),
    ];
  };
  it("require on a hidden field with no show rule", () => {
    expect(run(hidden("require", false)).errors).toContainEqual(
      err("/queryTypes/0/rules/0/field", "config.unreachableRuleTarget", {
        field: "plateType",
        effect: "require",
      }),
    );
  });
  it("setDefault on a hidden field with no show rule", () => {
    expect(run(hidden("setDefault", false)).errors).toContainEqual(
      err("/queryTypes/0/rules/0/field", "config.unreachableRuleTarget", {
        field: "plateType",
        effect: "setDefault",
      }),
    );
  });
  it("a show rule makes it reachable", () => {
    expect(run(hidden("require", true)).errors).toEqual([]);
  });
});

describe("contrast (spec 4.1, UX-011)", () => {
  const stub = (over: Partial<ContrastContext> = {}): ContrastContext => ({
    value: (token) => (token.endsWith(".fg") ? "#000000" : "#ffffff"),
    ratio: (a, b) => (a === b ? 1 : 21),
    failures: () => [],
    ...over,
  });
  it("severity style with equal fg and bg", () => {
    const { errors } = run(() => {}, stub({ value: () => "#123456" }));
    expect(errors).toContainEqual(
      err("/keywordSeverityStyles/critical", "config.severityContrast", {
        severity: "critical",
        mode: "day",
        ratio: 1,
      }),
    );
    expect(errors.filter((e) => e.key === "config.severityContrast")).toHaveLength(9);
  });
  it("ratio is rounded to 2 places", () => {
    const e = run(() => {}, stub({ ratio: () => 4.4949 })).errors.find(
      (x) => x.key === "config.severityContrast",
    );
    expect(e?.params.ratio).toBe(4.49);
  });
  it("a ratio of exactly 4.5 passes", () => {
    expect(run(() => {}, stub({ ratio: () => 4.5 })).errors).toEqual([]);
  });
  it("unknown token values are skipped", () => {
    const { errors } = run(() => {}, stub({ value: () => undefined, ratio: () => 1 }));
    expect(errors).toEqual([]);
  });
  it("overrides reach the value lookup: all, then the mode", () => {
    const seen: Record<string, string>[] = [];
    run(
      (r) => {
        r.theme = { tokens: { all: { a: "1", b: "1" }, day: { b: "2" } } };
      },
      stub({
        value: (_t, mode, o) => {
          if (mode === "day") seen.push({ ...o });
          return "#000000";
        },
      }),
    );
    expect(seen[0]).toEqual({ a: "1", b: "2" });
  });
  it("theme pair failure reported per mode", () => {
    const c = stub({
      failures: (mode) =>
        mode === "day" ? [{ fg: "color.text", bg: "color.bg", min: 4.5, ratio: 3.2 }] : [],
    });
    expect(run(() => {}, c).errors).toEqual([
      err("/theme/tokens", "config.themeContrast", {
        fg: "color.text",
        bg: "color.bg",
        mode: "day",
        min: 4.5,
        ratio: 3.2,
      }),
    ]);
  });
  it("no contrast context: no contrast diagnostics", () => {
    expect(run(() => {}).errors).toEqual([]);
  });
});

describe("warnings (spec 4.1)", () => {
  it("field made required by a rule with no position in a command", () => {
    const { warnings } = run((r) => {
      vehicle(r).rules = [
        { field: "note", when: { field: "plate", op: "notEmpty" }, effect: "require" },
      ];
    });
    expect(warnings).toEqual([
      {
        level: "warning",
        path: "/queryTypes/0/rules/0/field",
        key: "config.conditionallyRequiredWithoutPosition",
        params: { field: "note", command: "VEH" },
      },
    ]);
  });
  it("no warning when the command positions the field", () => {
    const { warnings } = run((r) => {
      vehicle(r).rules = [
        { field: "year", when: { field: "plate", op: "notEmpty" }, effect: "require" },
      ];
    });
    expect(warnings).toEqual([]);
  });
  it("a disabled code in a condition, matched case-insensitively", () => {
    const { warnings } = run((r) => {
      property(r).rules = [
        {
          field: "serial",
          when: { field: "propertyType", op: "eq", value: "boat" },
          effect: "hide",
        },
      ];
    });
    expect(warnings).toEqual([
      {
        level: "warning",
        path: "/queryTypes/1/rules/0/when/value",
        key: "config.disabledCodeInCondition",
        params: { field: "propertyType", code: "BOAT" },
      },
    ]);
  });
  it("a disabled code inside an in-list", () => {
    const { warnings } = run((r) => {
      property(r).rules = [
        {
          field: "serial",
          when: { field: "propertyType", op: "in", value: ["GUN", "BOAT"] },
          effect: "hide",
        },
      ];
    });
    expect(warnings.map((w) => w.path)).toEqual(["/queryTypes/1/rules/0/when/value/1"]);
  });
});

describe("roles (closed enum)", () => {
  it("an unknown delegatorRoles entry fails the strict parse", () => {
    const raw = base();
    raw.delegation = {
      purposes: [{ key: "p", labelKey: "delegation.training", delegatorRoles: ["chief"] }],
    } as unknown as SiteConfigInput["delegation"];
    expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
  });
});
