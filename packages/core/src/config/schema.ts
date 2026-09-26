import { z } from "zod";
import { RoleSchema } from "../contracts/identity";
import { BoundedIdSchema, FieldKeySchema } from "../contracts/primitives";
import { CONFIG_SCHEMA_VERSION } from "../contracts/version";
import { makeFieldSchemas } from "./schema-fields";
import { objectFor, type SchemaMode } from "./schema-mode";
import { isValidShortcutKeys, SHORTCUT_CONTEXTS } from "./shortcuts";

export const SEVERITIES = ["critical", "warning", "info"] as const;
export const SOURCE_SCOPES = ["state", "national", "local"] as const;
export const PERSONA_LAYOUTS = ["dispatch", "mobileUnit", "mobile"] as const;
export const THEME_MODES = ["day", "night", "redShift"] as const;
export const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/;
export const DEFAULT_DELEGATION_PURPOSE = {
  key: "training",
  labelKey: "delegation.training",
  delegatorRoles: ["trainingOfficer" as const],
};

export function makeSiteConfigSchemas(mode: SchemaMode) {
  const f = makeFieldSchemas(mode);
  const obj = objectFor(mode);
  const { Key, Literal, Condition } = f;

  const PicklistValue = obj({
    code: Key,
    labelKey: Key,
    enabled: z.boolean().default(true),
    parent: Key.optional(),
  });
  const Picklist = obj({ id: Key, values: z.array(PicklistValue).min(1) });

  // ADR-0005 / W1 xhigh ruling 2 / ledger Ruling P-7: Source.kind is BoundedIdSchema.
  const Source = obj({
    id: Key,
    labelKey: Key,
    scope: z.enum(SOURCE_SCOPES),
    kind: BoundedIdSchema,
    timeoutMs: z.int().positive().default(10000),
    maxConcurrent: z.int().positive().default(4),
    requiresCredentials: z.boolean(),
    server: z.record(z.string(), z.unknown()).optional(),
  });

  // ADR-0005: positional field references (both the bare-string and the rest-object forms) are
  // FieldKeySchema, same as CommandDef/CommandPosition field refs elsewhere in config (Task 7).
  const Position = z.union([FieldKeySchema, obj({ field: FieldKeySchema, rest: z.literal(true) })]);
  const CommandDef = obj({
    code: Key,
    queryType: Key,
    presets: z.record(z.string(), Literal).optional(),
    positions: z.array(Position),
  });

  const Severity = z.enum(SEVERITIES);
  const KeywordStyle = obj({ keyword: Key, severity: Severity, except: z.array(Key).optional() });
  const SeverityStyle = obj({
    color: Key,
    background: Key,
    bold: z.boolean(),
    icon: Key,
    marker: Key,
    audibleCue: z.boolean().default(false),
  });

  const Format = z.discriminatedUnion("type", [
    obj({ type: z.literal("text") }),
    obj({ type: z.literal("upper") }),
    obj({ type: z.literal("phone") }),
    obj({ type: z.literal("date"), pattern: Key }),
    obj({ type: z.literal("template"), template: Key }),
  ]);
  const View = z.enum(["summary", "detail", "both"]);
  const ValueElement = obj({
    kind: z.literal("value"),
    path: Key,
    labelKey: Key,
    view: View,
    format: Format.optional(),
    highlight: z.boolean().default(true),
  });
  const TableElement = obj({
    kind: z.literal("table"),
    path: Key,
    labelKey: Key,
    view: View,
    highlight: z.boolean().default(true),
    columns: z
      .array(
        obj({
          path: Key,
          labelKey: Key,
          format: Format.optional(),
          highlight: z.boolean().optional(),
        }),
      )
      .min(1),
  });
  const MappingElement = z.discriminatedUnion("kind", [ValueElement, TableElement]);
  const ResponseMapping = obj({
    id: Key,
    queryType: Key,
    sourceId: Key.optional(),
    persona: Key.optional(),
    when: Condition.optional(),
    elements: z.array(MappingElement).min(1),
  });

  const ShortcutBinding = obj({
    keys: z.string().refine(isValidShortcutKeys, { message: "invalid shortcut keys" }),
    context: z.enum(SHORTCUT_CONTEXTS),
  });
  const ShortcutMap = z.record(
    z.string(),
    z.union([ShortcutBinding, z.array(ShortcutBinding).min(1)]),
  );

  const TokenOverrides = z.record(z.string(), z.string());
  const ThemeConfig = obj({
    defaultMode: z.enum(THEME_MODES).default("day"),
    auto: z.enum(["off", "os", "time"]).default("off"),
    tokens: obj({
      all: TokenOverrides.optional(),
      day: TokenOverrides.optional(),
      night: TokenOverrides.optional(),
      redShift: TokenOverrides.optional(),
    }).optional(),
  });

  const PersonaDef = obj({ key: Key, labelKey: Key, layout: z.enum(PERSONA_LAYOUTS) });

  const AuthConfig = obj({
    mfaRequired: z.union([z.boolean(), obj({ roles: z.array(RoleSchema).min(1) })]).default(false),
    session: obj({
      absoluteMinutes: z.int().positive().default(720),
      idleMinutes: z.int().positive().default(30),
    }).default({ absoluteMinutes: 720, idleMinutes: 30 }),
    embedded: obj({
      roleClaims: obj({ claim: Key, map: z.record(z.string(), RoleSchema) }),
    }).optional(),
  });

  const DelegationConfig = obj({
    maxDurationMinutes: z.int().positive().default(480),
    purposes: z
      .array(
        obj({
          key: Key,
          labelKey: Key,
          delegatorRoles: z.array(RoleSchema).min(1),
          maxDurationMinutes: z.int().positive().optional(),
        }),
      )
      .default([DEFAULT_DELEGATION_PURPOSE]),
  });

  const SiteConfig = obj({
    $schema: z.string().optional(),
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
    extends: Key.optional(),
    // ADR-0005 / W1 xhigh ruling 2 / ledger Ruling P-7: site.id is BoundedIdSchema.
    site: obj({ id: BoundedIdSchema, labelKey: Key }),
    locales: z.array(z.string().regex(LOCALE_PATTERN)).min(1).default(["en"]),
    features: z.record(z.string(), z.boolean()).default({}),
    personas: z.array(PersonaDef).min(1),
    auth: AuthConfig,
    delegation: DelegationConfig,
    retention: obj({ payloadDays: z.int().nullable(), valuesDays: z.int().nullable() }),
    terminal: obj({ delimiter: z.string().default(".") }).default({ delimiter: "." }),
    defaults: z.record(z.string(), Literal).default({}),
    picklists: z.array(Picklist).default([]),
    sources: z.array(Source).min(1),
    queryTypes: z.array(f.QueryType).min(1),
    commands: z.array(CommandDef).default([]),
    keywords: z.array(KeywordStyle).default([]),
    keywordSeverityStyles: obj({
      critical: SeverityStyle,
      warning: SeverityStyle,
      info: SeverityStyle,
    }),
    responseMappings: z.array(ResponseMapping).default([]),
    quickAccess: z.array(Key).default([]),
    shortcuts: ShortcutMap.optional(),
    theme: ThemeConfig.optional(),
  });

  return {
    ...f,
    PicklistValue,
    Picklist,
    Source,
    Position,
    CommandDef,
    Severity,
    KeywordStyle,
    SeverityStyle,
    Format,
    MappingElement,
    ResponseMapping,
    ShortcutBinding,
    ShortcutMap,
    ThemeConfig,
    PersonaDef,
    AuthConfig,
    DelegationConfig,
    SiteConfig,
  };
}

const S = makeSiteConfigSchemas("strict");

export const SiteConfigSchema = S.SiteConfig;
export type SiteConfig = z.infer<typeof S.SiteConfig>;
export type SiteConfigInput = z.input<typeof S.SiteConfig>;
export type QueryType = z.infer<typeof S.QueryType>;
export type FieldDef = z.infer<typeof S.FieldDef>;
export type FieldRule = z.infer<typeof S.FieldRule>;
export type SectionDef = z.infer<typeof S.SectionDef>;
export type QueryTypeSource = z.infer<typeof S.QueryTypeSource>;
export type NestedQuery = z.infer<typeof S.NestedQuery>;
export type Picklist = z.infer<typeof S.Picklist>;
export type PicklistValue = z.infer<typeof S.PicklistValue>;
export type Source = z.infer<typeof S.Source>;
export type CommandDef = z.infer<typeof S.CommandDef>;
export type CommandPosition = z.infer<typeof S.Position>;
export type KeywordStyle = z.infer<typeof S.KeywordStyle>;
export type SeverityStyle = z.infer<typeof S.SeverityStyle>;
export type Severity = z.infer<typeof S.Severity>;
export type Format = z.infer<typeof S.Format>;
export type MappingElement = z.infer<typeof S.MappingElement>;
export type ResponseMapping = z.infer<typeof S.ResponseMapping>;
export type ThemeConfig = z.infer<typeof S.ThemeConfig>;
export type PersonaDef = z.infer<typeof S.PersonaDef>;
export type AuthConfig = z.infer<typeof S.AuthConfig>;
export type DelegationConfig = z.infer<typeof S.DelegationConfig>;
