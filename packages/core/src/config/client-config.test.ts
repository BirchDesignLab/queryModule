import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import { type ClientSiteConfig, ClientSiteConfigSchema, toClientSiteConfig } from "./client-config";
import type { FeatureKey } from "./features";
import { SiteConfigSchema } from "./schema";
import { minimalSiteConfigInput } from "./test-fixtures";

// Task W2F (spec 4.1 Client view, critic M1 on Task 9): walks every zod object key path reachable from
// ClientSiteConfigSchema (through arrays, optionals, defaults, records, unions and
// discriminated unions) so a server-only key added to a shared shape later fails this test
// instead of silently reaching GET /api/v1/config. Kept small and in this file on purpose.
function collectKeyPaths(
  schema: z.ZodType,
  prefix: string,
  out: Set<string>,
  ancestors: Set<z.ZodType>,
): void {
  const def = (schema as unknown as { def: { type: string } }).def;
  switch (def.type) {
    case "object": {
      const shape = (schema as unknown as z.ZodObject).shape;
      for (const key of Object.keys(shape)) {
        const path = prefix ? `${prefix}.${key}` : key;
        out.add(path);
        collectKeyPaths(shape[key] as z.ZodType, path, out, ancestors);
      }
      return;
    }
    case "array":
      collectKeyPaths((def as unknown as { element: z.ZodType }).element, prefix, out, ancestors);
      return;
    case "record":
      collectKeyPaths(
        (def as unknown as { valueType: z.ZodType }).valueType,
        prefix,
        out,
        ancestors,
      );
      return;
    case "union":
      for (const opt of (def as unknown as { options: z.ZodType[] }).options) {
        collectKeyPaths(opt, prefix, out, ancestors);
      }
      return;
    case "optional":
    case "nullable":
    case "default":
    case "catch":
    case "readonly":
    case "nonoptional":
      collectKeyPaths(
        (def as unknown as { innerType: z.ZodType }).innerType,
        prefix,
        out,
        ancestors,
      );
      return;
    case "lazy": {
      if (ancestors.has(schema)) return; // recursive Condition: stop, keys already collected once
      ancestors.add(schema);
      collectKeyPaths(
        (def as unknown as { getter: () => z.ZodType }).getter(),
        prefix,
        out,
        ancestors,
      );
      ancestors.delete(schema);
      return;
    }
    case "string":
    case "number":
    case "boolean":
    case "enum":
    case "literal":
    case "unknown":
    case "any":
      return; // leaf types: no keys
    default:
      throw new Error(`Task W2F key-path walker: cannot walk zod type "${def.type}"`);
  }
}

const HASH = "a".repeat(64);

function serverConfig() {
  const raw = minimalSiteConfigInput();
  raw.extends = "default";
  raw.retention = { payloadDays: 30, valuesDays: null };
  raw.sources = [
    {
      id: "src1",
      labelKey: "source.src1",
      scope: "state",
      kind: "mock",
      requiresCredentials: true,
      maxConcurrent: 2,
      server: { url: "https://example.test" },
    },
  ];
  raw.features = { credentials: true };
  return SiteConfigSchema.parse(raw);
}

describe("BR-001 ClientSiteConfig is an allowlist (spec 4.1 Client view)", () => {
  it("never carries extends, auth, retention, Source.kind, Source.server or Source.maxConcurrent", () => {
    const client = toClientSiteConfig(serverConfig(), HASH);
    const text = JSON.stringify(client);
    expect(client).not.toHaveProperty("extends");
    expect(client).not.toHaveProperty("auth");
    expect(client).not.toHaveProperty("retention");
    expect(client.sources).toEqual([
      {
        id: "src1",
        labelKey: "source.src1",
        scope: "state",
        timeoutMs: 10000,
        requiresCredentials: true,
      },
    ]);
    expect(text).not.toContain("example.test");
    expect(client.configHash).toBe(HASH);
  });

  it("lists every feature with an explicit boolean", () => {
    expect(toClientSiteConfig(serverConfig(), HASH).features).toEqual({
      credentials: true,
      delegation: false,
      resultHide: false,
      adminAudit: false,
      adminConfig: false,
      adminUsers: false,
    });
  });

  it("types features by the closed catalogue and strips unknown feature keys", () => {
    expectTypeOf<ClientSiteConfig["features"]>().toEqualTypeOf<Record<FeatureKey, boolean>>();
    const client = toClientSiteConfig(serverConfig(), HASH);
    const parsed = ClientSiteConfigSchema.parse({
      ...client,
      features: { ...client.features, futureFeature: true },
    });
    expect(parsed.features).toEqual(client.features);
    const { adminAudit: _dropped, ...missing } = client.features;
    expect(ClientSiteConfigSchema.safeParse({ ...client, features: missing }).success).toBe(false);
  });

  it("keeps delegation purposes without delegatorRoles", () => {
    expect(toClientSiteConfig(serverConfig(), HASH).delegation).toEqual({
      purposes: [{ key: "training", labelKey: "delegation.training" }],
      maxDurationMinutes: 480,
    });
  });

  it("keeps a purpose's maxDurationMinutes, shortcuts and theme, and drops auth subtrees (spec 4.1 Client view)", () => {
    const raw = minimalSiteConfigInput();
    raw.auth = {
      mfaRequired: { roles: ["admin"] },
      embedded: { roleClaims: { claim: "sentinelClaim", map: { "sentinel-group": "admin" } } },
    };
    raw.delegation = {
      purposes: [
        {
          key: "ride",
          labelKey: "delegation.ride",
          delegatorRoles: ["trainingOfficer"],
          maxDurationMinutes: 60,
        },
      ],
      maxDurationMinutes: 480,
    };
    raw.shortcuts = { submit: { keys: "Ctrl+Enter", context: "panel" } };
    raw.theme = { defaultMode: "night", auto: "os", tokens: {} };
    const client = toClientSiteConfig(SiteConfigSchema.parse(raw), HASH);
    const text = JSON.stringify(client);
    expect(client.delegation.purposes).toEqual([
      { key: "ride", labelKey: "delegation.ride", maxDurationMinutes: 60 },
    ]);
    expect(client.shortcuts).toEqual({ submit: { keys: "Ctrl+Enter", context: "panel" } });
    expect(client.theme?.defaultMode).toBe("night");
    expect(text).not.toContain("sentinel");
    expect(text).not.toContain("mfaRequired");
    expect(text).not.toContain("trainingOfficer");
  });

  it("omits shortcuts and theme when the server config has none", () => {
    const client = toClientSiteConfig(serverConfig(), HASH);
    expect(client).not.toHaveProperty("shortcuts");
    expect(client).not.toHaveProperty("theme");
  });

  it("parses forward-tolerantly: unknown keys stripped, unknown optional enums caught", () => {
    const client = toClientSiteConfig(serverConfig(), HASH) as Record<string, unknown>;
    const future = {
      ...client,
      futureBlock: { a: 1 },
      queryTypes: (client.queryTypes as Array<Record<string, unknown>>).map((q) => ({
        ...q,
        futureFlag: true,
        fields: (q.fields as Array<Record<string, unknown>>).map((fd) => ({
          ...fd,
          role: "futureRole",
          hint: "x",
        })),
      })),
    };
    const parsed = ClientSiteConfigSchema.parse(future);
    expect(parsed).not.toHaveProperty("futureBlock");
    expect(parsed.queryTypes[0]).not.toHaveProperty("futureFlag");
    expect(parsed.queryTypes[0]?.fields[0]?.role).toBeUndefined();
  });

  // Task W2F (spec 4.1 Client view, critic M1 on Task 9): every key path reachable from
  // ClientSiteConfigSchema, reviewed for whether it is safe to send to a client. A new key here
  // must go through that same review before this list is updated.
  const EXPECTED_CLIENT_KEY_PATHS = [
    "commands",
    "commands.code",
    "commands.positions",
    "commands.positions.field",
    "commands.positions.rest",
    "commands.presets",
    "commands.queryType",
    "configHash",
    "defaults",
    "delegation",
    "delegation.maxDurationMinutes",
    "delegation.purposes",
    "delegation.purposes.key",
    "delegation.purposes.labelKey",
    "delegation.purposes.maxDurationMinutes",
    "features",
    "features.adminAudit",
    "features.adminConfig",
    "features.adminUsers",
    "features.credentials",
    "features.delegation",
    "features.resultHide",
    "keywordSeverityStyles",
    "keywordSeverityStyles.critical",
    "keywordSeverityStyles.critical.audibleCue",
    "keywordSeverityStyles.critical.background",
    "keywordSeverityStyles.critical.bold",
    "keywordSeverityStyles.critical.color",
    "keywordSeverityStyles.critical.icon",
    "keywordSeverityStyles.critical.marker",
    "keywordSeverityStyles.info",
    "keywordSeverityStyles.info.audibleCue",
    "keywordSeverityStyles.info.background",
    "keywordSeverityStyles.info.bold",
    "keywordSeverityStyles.info.color",
    "keywordSeverityStyles.info.icon",
    "keywordSeverityStyles.info.marker",
    "keywordSeverityStyles.warning",
    "keywordSeverityStyles.warning.audibleCue",
    "keywordSeverityStyles.warning.background",
    "keywordSeverityStyles.warning.bold",
    "keywordSeverityStyles.warning.color",
    "keywordSeverityStyles.warning.icon",
    "keywordSeverityStyles.warning.marker",
    "keywords",
    "keywords.except",
    "keywords.keyword",
    "keywords.severity",
    "locales",
    "personas",
    "personas.key",
    "personas.labelKey",
    "personas.layout",
    "picklists",
    "picklists.id",
    "picklists.values",
    "picklists.values.code",
    "picklists.values.enabled",
    "picklists.values.labelKey",
    "picklists.values.parent",
    "queryTypes",
    "queryTypes.allowPlateOnly",
    "queryTypes.alsoRun",
    "queryTypes.alsoRun.fieldMap",
    "queryTypes.alsoRun.queryType",
    "queryTypes.alsoRun.when",
    "queryTypes.alsoRun.when.all",
    "queryTypes.alsoRun.when.any",
    "queryTypes.alsoRun.when.field",
    "queryTypes.alsoRun.when.not",
    "queryTypes.alsoRun.when.op",
    "queryTypes.alsoRun.when.value",
    "queryTypes.alsoRun.when.value.$default",
    "queryTypes.code",
    "queryTypes.defaults",
    "queryTypes.fields",
    "queryTypes.fields.century",
    "queryTypes.fields.charset",
    "queryTypes.fields.custom",
    "queryTypes.fields.dataType",
    "queryTypes.fields.defaultValue",
    "queryTypes.fields.inputFormats",
    "queryTypes.fields.key",
    "queryTypes.fields.labelKey",
    "queryTypes.fields.maxLength",
    "queryTypes.fields.minLength",
    "queryTypes.fields.numberKind",
    "queryTypes.fields.outputFormat",
    "queryTypes.fields.pattern",
    "queryTypes.fields.picklist",
    "queryTypes.fields.picklistFilter",
    "queryTypes.fields.picklistFilter.byField",
    "queryTypes.fields.required",
    "queryTypes.fields.role",
    "queryTypes.fields.section",
    "queryTypes.fields.transform",
    "queryTypes.fields.visible",
    "queryTypes.labelKey",
    "queryTypes.rules",
    "queryTypes.rules.effect",
    "queryTypes.rules.field",
    "queryTypes.rules.value",
    "queryTypes.rules.when",
    "queryTypes.rules.when.all",
    "queryTypes.rules.when.any",
    "queryTypes.rules.when.field",
    "queryTypes.rules.when.not",
    "queryTypes.rules.when.op",
    "queryTypes.rules.when.value",
    "queryTypes.rules.when.value.$default",
    "queryTypes.sections",
    "queryTypes.sections.key",
    "queryTypes.sections.labelKey",
    "queryTypes.sections.when",
    "queryTypes.sections.when.all",
    "queryTypes.sections.when.any",
    "queryTypes.sections.when.field",
    "queryTypes.sections.when.not",
    "queryTypes.sections.when.op",
    "queryTypes.sections.when.value",
    "queryTypes.sections.when.value.$default",
    "queryTypes.sources",
    "queryTypes.sources.plateOnly",
    "queryTypes.sources.selectedByDefault",
    "queryTypes.sources.sourceId",
    "queryTypes.sources.when",
    "queryTypes.sources.when.all",
    "queryTypes.sources.when.any",
    "queryTypes.sources.when.field",
    "queryTypes.sources.when.not",
    "queryTypes.sources.when.op",
    "queryTypes.sources.when.value",
    "queryTypes.sources.when.value.$default",
    "quickAccess",
    "responseMappings",
    "responseMappings.elements",
    "responseMappings.elements.columns",
    "responseMappings.elements.columns.format",
    "responseMappings.elements.columns.format.pattern",
    "responseMappings.elements.columns.format.template",
    "responseMappings.elements.columns.format.type",
    "responseMappings.elements.columns.highlight",
    "responseMappings.elements.columns.labelKey",
    "responseMappings.elements.columns.path",
    "responseMappings.elements.format",
    "responseMappings.elements.format.pattern",
    "responseMappings.elements.format.template",
    "responseMappings.elements.format.type",
    "responseMappings.elements.highlight",
    "responseMappings.elements.kind",
    "responseMappings.elements.labelKey",
    "responseMappings.elements.path",
    "responseMappings.elements.view",
    "responseMappings.id",
    "responseMappings.persona",
    "responseMappings.queryType",
    "responseMappings.sourceId",
    "responseMappings.when",
    "responseMappings.when.all",
    "responseMappings.when.any",
    "responseMappings.when.field",
    "responseMappings.when.not",
    "responseMappings.when.op",
    "responseMappings.when.value",
    "responseMappings.when.value.$default",
    "schemaVersion",
    "shortcuts",
    "shortcuts.context",
    "shortcuts.keys",
    "site",
    "site.id",
    "site.labelKey",
    "sources",
    "sources.id",
    "sources.labelKey",
    "sources.requiresCredentials",
    "sources.scope",
    "sources.timeoutMs",
    "terminal",
    "terminal.delimiter",
    "theme",
    "theme.auto",
    "theme.defaultMode",
    "theme.tokens",
    "theme.tokens.all",
    "theme.tokens.day",
    "theme.tokens.night",
    "theme.tokens.redShift",
  ];

  it("never gains a key beyond this reviewed allowlist (spec 4.1 Client view)", () => {
    const paths = new Set<string>();
    collectKeyPaths(ClientSiteConfigSchema, "", paths, new Set());
    expect([...paths].sort()).toEqual(EXPECTED_CLIENT_KEY_PATHS);
  });

  it("rejects a non-hex configHash", () => {
    expect(() =>
      ClientSiteConfigSchema.parse({
        ...toClientSiteConfig(serverConfig(), HASH),
        configHash: "not-hex",
      }),
    ).toThrow();
  });
});
