import { describe, expect, it } from "vitest";
import { PicklistSchema, QueryTypeSchema, SiteConfigSchema } from "./schema";
import { DEFAULT_INPUT_FORMATS } from "./schema-fields";
import { minimalSiteConfigInput } from "./test-fixtures";

describe("BR-001 SiteConfig v1 (spec 4.1)", () => {
  it("parses the minimal config and applies site-level defaults", () => {
    const c = SiteConfigSchema.parse(minimalSiteConfigInput());
    expect(c.locales).toEqual(["en"]);
    expect(c.features).toEqual({});
    expect(c.terminal).toEqual({ delimiter: "." });
    expect(c.auth).toEqual({
      mfaRequired: false,
      session: { absoluteMinutes: 720, idleMinutes: 30 },
    });
    expect(c.delegation).toEqual({
      maxDurationMinutes: 480,
      purposes: [
        { key: "training", labelKey: "delegation.training", delegatorRoles: ["trainingOfficer"] },
      ],
    });
    expect(c.sources[0]).toMatchObject({ timeoutMs: 10000, maxConcurrent: 4 });
    expect(c.keywordSeverityStyles.critical.audibleCue).toBe(false);
  });

  it("rejects unknown keys at the root and inside entities (strict server parse)", () => {
    expect(SiteConfigSchema.safeParse({ ...minimalSiteConfigInput(), colour: "red" }).success).toBe(
      false,
    );
    const raw = minimalSiteConfigInput();
    raw.sources = [
      {
        id: "s",
        labelKey: "l",
        scope: "state",
        kind: "mock",
        requiresCredentials: false,
        url: "x",
      } as never,
    ];
    expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
  });

  it("a source without kind fails to load (spec 5.4)", () => {
    const raw = minimalSiteConfigInput();
    raw.sources = [{ id: "s", labelKey: "l", scope: "state", requiresCredentials: false } as never];
    expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects schemaVersion other than 1", () => {
    expect(
      SiteConfigSchema.safeParse({ ...minimalSiteConfigInput(), schemaVersion: 2 }).success,
    ).toBe(false);
  });

  it("FR-060 accepts value and table mapping elements and every Format type", () => {
    const raw = minimalSiteConfigInput();
    raw.responseMappings = [
      {
        id: "m1",
        queryType: "VEH",
        elements: [
          {
            kind: "value",
            path: "status",
            labelKey: "field.plate",
            view: "both",
            format: { type: "upper" },
          },
          {
            kind: "value",
            path: "phone",
            labelKey: "field.plate",
            view: "detail",
            format: { type: "phone" },
          },
          {
            kind: "value",
            path: "d",
            labelKey: "field.plate",
            view: "detail",
            format: { type: "date", pattern: "MM-DD-YY" },
          },
          {
            kind: "value",
            path: "t",
            labelKey: "field.plate",
            view: "detail",
            format: { type: "template", template: "{a} {b}" },
          },
          {
            kind: "table",
            path: "warrants",
            labelKey: "field.plate",
            view: "detail",
            columns: [{ path: "offense", labelKey: "field.plate", format: { type: "text" } }],
          },
        ],
      },
    ];
    expect(SiteConfigSchema.safeParse(raw).success).toBe(true);
  });

  it("an unknown Format type is a validation error", () => {
    const raw = minimalSiteConfigInput();
    raw.responseMappings = [
      {
        id: "m1",
        queryType: "VEH",
        elements: [
          {
            kind: "value",
            path: "a",
            labelKey: "l",
            view: "both",
            format: { type: "currency" } as never,
          },
        ],
      },
    ];
    expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects malformed shortcut keys and accepts arrays of bindings", () => {
    const bad = {
      ...minimalSiteConfigInput(),
      shortcuts: { submit: { keys: "ctrl+enter", context: "panel" } },
    };
    expect(SiteConfigSchema.safeParse(bad).success).toBe(false);
    const ok = {
      ...minimalSiteConfigInput(),
      shortcuts: {
        submit: [
          { keys: "Ctrl+Enter", context: "panel" },
          { keys: "Alt+KeyS", context: "panel" },
        ],
      },
    };
    expect(SiteConfigSchema.safeParse(ok).success).toBe(true);
  });

  it("parses auth.mfaRequired by roles, embedded roleClaims and theme overrides", () => {
    const c = SiteConfigSchema.parse({
      ...minimalSiteConfigInput(),
      auth: {
        mfaRequired: { roles: ["admin"] },
        embedded: { roleClaims: { claim: "groups", map: { "cad-admin": "admin" } } },
      },
      theme: {
        defaultMode: "night",
        auto: "os",
        tokens: { redShift: { "color.text.body": "#ffb000" } },
      },
    });
    expect(c.theme?.defaultMode).toBe("night");
    expect(
      SiteConfigSchema.safeParse({
        ...minimalSiteConfigInput(),
        auth: { mfaRequired: { roles: ["root"] } },
      }).success,
    ).toBe(false);
  });

  // ADR-0005, W1 xhigh ruling 2, ledger Ruling P-7: BoundedIdSchema on Source.kind and site.id;
  // FieldKeySchema on every field reference in commands and positional fields.
  describe("ADR-0005 primitive bounds on site.id, Source.kind and command field refs", () => {
    it("rejects a site.id of 65 chars", () => {
      const raw = minimalSiteConfigInput();
      raw.site = { id: "a".repeat(65), labelKey: "site.t" };
      expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
    });

    it("rejects a site.id containing '/'", () => {
      const raw = minimalSiteConfigInput();
      raw.site = { id: "a/b", labelKey: "site.t" };
      expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
    });

    it("rejects a Source.kind of 65 chars", () => {
      const raw = minimalSiteConfigInput();
      raw.sources = [
        {
          id: "src1",
          labelKey: "source.src1",
          scope: "state",
          kind: "a".repeat(65),
          requiresCredentials: false,
        },
      ];
      expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
    });

    it("rejects a Source.kind containing '/'", () => {
      const raw = minimalSiteConfigInput();
      raw.sources = [
        {
          id: "src1",
          labelKey: "source.src1",
          scope: "state",
          kind: "mock/v2",
          requiresCredentials: false,
        },
      ];
      expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
    });

    it("rejects a command positional field reference that fails FieldKeySchema", () => {
      const dotted = minimalSiteConfigInput();
      dotted.commands = [{ code: "VEH", queryType: "VEH", positions: ["plate.no", "state"] }];
      expect(SiteConfigSchema.safeParse(dotted).success).toBe(false);

      const leadingDigit = minimalSiteConfigInput();
      leadingDigit.commands = [{ code: "VEH", queryType: "VEH", positions: ["1plate", "state"] }];
      expect(SiteConfigSchema.safeParse(leadingDigit).success).toBe(false);
    });

    it("accepts a valid command positional field reference", () => {
      const raw = minimalSiteConfigInput();
      raw.commands = [{ code: "VEH", queryType: "VEH", positions: ["plate", "state"] }];
      expect(SiteConfigSchema.safeParse(raw).success).toBe(true);
    });

    it("rejects the rest-object positional form's field when it fails FieldKeySchema", () => {
      const raw = minimalSiteConfigInput();
      raw.commands = [
        { code: "VEH", queryType: "VEH", positions: [{ field: "1plate", rest: true }] as never },
      ];
      expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
    });
  });

  // Task W2F: BR-001, BR-004, FR-051 - ADR-0005 bounds Task 8 left as Key.
  describe("Task W2F ADR-0005 bounds: Source.id, CommandDef.queryType, SiteConfig.extends", () => {
    it("accepts a 64-character Source.id and rejects 65 characters", () => {
      const ok = minimalSiteConfigInput();
      ok.sources = [{ ...ok.sources[0], id: "a".repeat(64) }];
      ok.queryTypes[0].sources = [{ sourceId: "a".repeat(64), selectedByDefault: true }];
      expect(SiteConfigSchema.safeParse(ok).success).toBe(true);

      const bad = minimalSiteConfigInput();
      bad.sources = [{ ...bad.sources[0], id: "a".repeat(65) }];
      expect(SiteConfigSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects a Source.id containing '/'", () => {
      const raw = minimalSiteConfigInput();
      raw.sources = [{ ...raw.sources[0], id: "a/b" }];
      expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
    });

    it("accepts a 64-character CommandDef.queryType and rejects 65 characters", () => {
      const ok = minimalSiteConfigInput();
      ok.commands = [{ code: "VEH", queryType: "a".repeat(64), positions: ["plate", "state"] }];
      expect(SiteConfigSchema.safeParse(ok).success).toBe(true);

      const bad = minimalSiteConfigInput();
      bad.commands = [{ code: "VEH", queryType: "a".repeat(65), positions: ["plate", "state"] }];
      expect(SiteConfigSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects a CommandDef.queryType containing '/'", () => {
      const raw = minimalSiteConfigInput();
      raw.commands = [{ code: "VEH", queryType: "a/b", positions: ["plate", "state"] }];
      expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
    });

    it("accepts a 64-character SiteConfig.extends and rejects 65 characters", () => {
      const ok = { ...minimalSiteConfigInput(), extends: "a".repeat(64) };
      expect(SiteConfigSchema.safeParse(ok).success).toBe(true);

      const bad = { ...minimalSiteConfigInput(), extends: "a".repeat(65) };
      expect(SiteConfigSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects a SiteConfig.extends containing '/'", () => {
      const raw = { ...minimalSiteConfigInput(), extends: "a/b" };
      expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
    });
  });

  describe("Task W2F CommandDef.presets keys are field keys", () => {
    it("rejects a preset key containing '.'", () => {
      const raw = minimalSiteConfigInput();
      raw.commands = [
        {
          code: "VEH",
          queryType: "VEH",
          positions: ["plate", "state"],
          presets: { "plate.no": "x" },
        },
      ];
      expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
    });

    it("accepts a preset key that is a plain field key", () => {
      const raw = minimalSiteConfigInput();
      raw.commands = [
        { code: "VEH", queryType: "VEH", positions: ["plate", "state"], presets: { type: "x" } },
      ];
      expect(SiteConfigSchema.safeParse(raw).success).toBe(true);
    });
  });

  describe("Task W2F CommandDef.code (spec 4.1, 4.4): printable ASCII '!'-'~' minus space and '='", () => {
    it("accepts VEH, 10-28 and P/1", () => {
      for (const code of ["VEH", "10-28", "P/1"]) {
        const raw = minimalSiteConfigInput();
        raw.commands = [{ code, queryType: "VEH", positions: ["plate", "state"] }];
        expect(SiteConfigSchema.safeParse(raw).success).toBe(true);
      }
    });

    it("rejects empty, a space, an '=', a non-ASCII character and a 33-character code", () => {
      for (const code of ["", "A B", "A=B", "É", "a".repeat(33)]) {
        const raw = minimalSiteConfigInput();
        raw.commands = [{ code, queryType: "VEH", positions: ["plate", "state"] }];
        expect(SiteConfigSchema.safeParse(raw).success).toBe(false);
      }
    });

    it("accepts a 32-character code", () => {
      const raw = minimalSiteConfigInput();
      raw.commands = [{ code: "a".repeat(32), queryType: "VEH", positions: ["plate", "state"] }];
      expect(SiteConfigSchema.safeParse(raw).success).toBe(true);
    });
  });

  // quality:S1: DEFAULT_DELEGATION_PURPOSE must not be shared by reference across parses.
  describe("quality:S1 delegation.purposes default is not a shared reference", () => {
    it("two parses omitting purposes return non-identical purpose objects and delegatorRoles arrays", () => {
      const a = SiteConfigSchema.parse(minimalSiteConfigInput());
      const b = SiteConfigSchema.parse(minimalSiteConfigInput());
      expect(a.delegation.purposes).not.toBe(b.delegation.purposes);
      expect(a.delegation.purposes[0]).not.toBe(b.delegation.purposes[0]);
      expect(a.delegation.purposes[0].delegatorRoles).not.toBe(
        b.delegation.purposes[0].delegatorRoles,
      );
      // mutating one parse's result must never leak into another parse's result
      a.delegation.purposes[0].delegatorRoles.push("admin" as never);
      expect(b.delegation.purposes[0].delegatorRoles).toEqual(["trainingOfficer"]);
    });
  });
});

describe("#141 QueryTypeSchema and PicklistSchema fill the spec 4.1 defaults", () => {
  it("QueryTypeSchema.parse fills query type, field and source defaults", () => {
    const qt = QueryTypeSchema.parse({
      code: "VEH",
      labelKey: "queryType.VEH",
      sections: [{ key: "base", labelKey: "section.base" }],
      fields: [{ key: "plate", labelKey: "field.plate", dataType: "string" }],
      sources: [{ sourceId: "src1", selectedByDefault: true }],
    });
    expect(qt.allowPlateOnly).toBe(false);
    expect(qt.rules).toEqual([]);
    expect(qt.sources[0]?.plateOnly).toBe(false);
    expect(qt.fields[0]).toMatchObject({
      visible: true,
      required: false,
      section: "base",
      maxLength: 64,
      charset: "printableAscii",
      transform: "none",
      numberKind: "integer",
      century: "2000",
      inputFormats: [...DEFAULT_INPUT_FORMATS],
      outputFormat: "MMDDYYYY",
    });
  });

  it("QueryTypeSchema is the strict server schema", () => {
    const raw = {
      code: "VEH",
      labelKey: "queryType.VEH",
      sections: [{ key: "base", labelKey: "section.base" }],
      fields: [{ key: "plate", labelKey: "field.plate", dataType: "string" }],
      sources: [{ sourceId: "src1", selectedByDefault: true }],
      colour: "red",
    };
    expect(QueryTypeSchema.safeParse(raw).success).toBe(false);
  });

  it("PicklistSchema.parse fills enabled on each value", () => {
    const p = PicklistSchema.parse({
      id: "state",
      values: [{ code: "TX", labelKey: "picklist.state.TX" }],
    });
    expect(p.values[0]?.enabled).toBe(true);
  });
});
