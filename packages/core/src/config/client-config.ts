import { z } from "zod";
import { MessageKeySchema, Sha256HexSchema } from "../contracts/primitives";
import { CONFIG_SCHEMA_VERSION } from "../contracts/version";
import { FEATURES, type FeatureKey } from "./features";
import { makeSiteConfigSchemas, type SiteConfig, SOURCE_SCOPES } from "./schema";

const C = makeSiteConfigSchemas("client");

/**
 * The recursive rule condition inside ClientSiteConfigSchema, the same instance.
 * The OpenAPI generator gives it the registry id "Condition" so its component
 * name never comes from zod's internal counter (#69).
 */
export const ClientConditionSchema = C.Condition;

/** Separate allowlist schema, never the server object with fields stripped (spec 4.1). */
export const ClientSiteConfigSchema = z.object({
  schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
  configHash: Sha256HexSchema,
  site: z.object({ id: z.string().min(1), labelKey: MessageKeySchema }),
  locales: z.array(z.string().min(1)).min(1),
  // One key per catalogue entry, typed by FeatureKey; z.object strips feature keys a newer server adds.
  features: z.object(
    Object.fromEntries(FEATURES.map((k) => [k, z.boolean()])) as Record<FeatureKey, z.ZodBoolean>,
  ),
  personas: z.array(C.PersonaDef),
  delegation: z.object({
    purposes: z.array(
      z.object({
        key: z.string().min(1),
        labelKey: MessageKeySchema,
        maxDurationMinutes: z.int().positive().optional(),
      }),
    ),
    maxDurationMinutes: z.int().positive(),
  }),
  terminal: z.object({ delimiter: z.string().min(1) }),
  defaults: z.record(z.string(), C.Literal),
  picklists: z.array(C.Picklist),
  queryTypes: z.array(C.QueryType),
  commands: z.array(C.CommandDef),
  keywords: z.array(C.KeywordStyle),
  keywordSeverityStyles: z.object({
    critical: C.SeverityStyle,
    warning: C.SeverityStyle,
    info: C.SeverityStyle,
  }),
  responseMappings: z.array(C.ResponseMapping),
  quickAccess: z.array(z.string().min(1)),
  shortcuts: C.ShortcutMap.optional(),
  theme: C.ThemeConfig.optional(),
  sources: z.array(
    z.object({
      id: z.string().min(1),
      labelKey: MessageKeySchema,
      scope: z.enum(SOURCE_SCOPES),
      timeoutMs: z.int().positive(),
      requiresCredentials: z.boolean(),
    }),
  ),
});
export type ClientSiteConfig = z.infer<typeof ClientSiteConfigSchema>;

export function toClientSiteConfig(config: SiteConfig, configHash: string): ClientSiteConfig {
  const view = {
    schemaVersion: config.schemaVersion,
    configHash,
    site: { id: config.site.id, labelKey: config.site.labelKey },
    locales: [...config.locales],
    features: Object.fromEntries(FEATURES.map((k) => [k, config.features[k] === true])),
    personas: config.personas,
    delegation: {
      purposes: config.delegation.purposes.map((p) =>
        p.maxDurationMinutes === undefined
          ? { key: p.key, labelKey: p.labelKey }
          : { key: p.key, labelKey: p.labelKey, maxDurationMinutes: p.maxDurationMinutes },
      ),
      maxDurationMinutes: config.delegation.maxDurationMinutes,
    },
    terminal: config.terminal,
    defaults: config.defaults,
    picklists: config.picklists,
    queryTypes: config.queryTypes,
    commands: config.commands,
    keywords: config.keywords,
    keywordSeverityStyles: config.keywordSeverityStyles,
    responseMappings: config.responseMappings,
    quickAccess: config.quickAccess,
    ...(config.shortcuts ? { shortcuts: config.shortcuts } : {}),
    ...(config.theme ? { theme: config.theme } : {}),
    sources: config.sources.map((s) => ({
      id: s.id,
      labelKey: s.labelKey,
      scope: s.scope,
      timeoutMs: s.timeoutMs,
      requiresCredentials: s.requiresCredentials,
    })),
  };
  return ClientSiteConfigSchema.parse(view);
}
