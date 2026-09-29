import { readFileSync } from "node:fs";
import type { SiteConfig } from "../../config/index.js";
import { mergeSiteOverlay, migrateConfig, SiteConfigSchema } from "../../config/index.js";

/** Test-only IO: the shipped site files in packages/config/sites. */
const read = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../../config/sites/${name}.json`, import.meta.url), "utf8"),
  );

function migrated(name: string): Record<string, unknown> {
  const m = migrateConfig(read(name));
  if (!m.ok) throw new Error(m.error.key);
  return m.config;
}

function resolveSite(name: string): SiteConfig {
  const site = migrated(name);
  const ext = site.extends;
  if (typeof ext !== "string") return SiteConfigSchema.parse(site);
  const merged = mergeSiteOverlay(migrated(ext), site);
  if (merged.errors.length > 0) throw new Error(merged.errors[0]?.key);
  return SiteConfigSchema.parse(merged.config);
}

export const defaultSite = resolveSite("default");
export const exampleOkSite = resolveSite("example-ok");
