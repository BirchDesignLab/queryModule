import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type ClientSiteConfig,
  type SiteConfig,
  SiteConfigSchema,
  toClientSiteConfig,
} from "@querymodule/core/config";

export interface LoadedConfig {
  siteConfig: SiteConfig;
  configHash: string;
  clientConfig: ClientSiteConfig;
  configDir: string;
  fieldKeys: string[];
  locales: Record<string, Record<string, unknown>>;
}
export class ConfigLoadError extends Error {
  constructor(
    readonly file: string,
    readonly path: string,
    reason: string,
  ) {
    super(`config ${file} at ${path || "/"}: ${reason}`);
    this.name = "ConfigLoadError";
  }
}

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    throw new ConfigLoadError(
      file,
      "",
      e instanceof SyntaxError ? "invalid JSON" : "file not readable",
    );
  }
}

export async function loadSiteConfig(siteConfigFile: string): Promise<LoadedConfig> {
  const file = resolve(siteConfigFile);
  const raw = await readJson(file);
  if (raw !== null && typeof raw === "object" && "extends" in raw) {
    throw new ConfigLoadError(
      file,
      "/extends",
      "extends is loaded from M1 P2 (config load + validate); not supported by this build",
    );
  }
  const parsed = SiteConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ConfigLoadError(
      file,
      `/${(issue?.path ?? []).join("/")}`,
      issue?.message ?? "invalid",
    );
  }
  const siteConfig = parsed.data;
  const configDir = resolve(dirname(file), "..");
  const locales: Record<string, Record<string, unknown>> = {};
  for (const locale of siteConfig.locales) {
    const bundle = await readJson(join(configDir, "locales", `${locale}.json`));
    if (bundle === null || typeof bundle !== "object" || Array.isArray(bundle)) {
      throw new ConfigLoadError(file, "/locales", `locale bundle ${locale}.json is not an object`);
    }
    locales[locale] = bundle as Record<string, unknown>;
  }
  const configHash = createHash("sha256").update(canonicalJson(siteConfig)).digest("hex");
  const fieldKeys = [...new Set(siteConfig.queryTypes.flatMap((q) => q.fields.map((f) => f.key)))];
  return {
    siteConfig,
    configHash,
    clientConfig: toClientSiteConfig(siteConfig, configHash),
    configDir,
    fieldKeys,
    locales,
  };
}
