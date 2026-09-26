import type { Literal } from "./schema-fields";

/** Configured default: FieldDef.defaultValue ?? QueryType.defaults[key] ?? SiteConfig.defaults[key] (spec 4.1). */
export function configuredDefault(
  config: { defaults: Record<string, Literal> },
  queryType: {
    fields: { key: string; defaultValue?: Literal }[];
    defaults?: Record<string, Literal>;
  },
  fieldKey: string,
): Literal | undefined {
  const field = queryType.fields.find((f) => f.key === fieldKey);
  return field?.defaultValue ?? queryType.defaults?.[fieldKey] ?? config.defaults[fieldKey];
}
