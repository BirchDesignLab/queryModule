import { describe, expect, it } from "vitest";
import { SiteConfigSchema } from "./schema";
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
});
