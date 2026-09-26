import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  API_BASE_PATH,
  API_VERSION,
  CONFIG_SCHEMA_VERSION,
  CORE_VERSION,
  EMBED_PROTOCOL_VERSION,
  SOURCE_ADAPTER_API_VERSION,
  WS_PROTOCOL_VERSION,
} from "./version";

describe("version constants (spec 4.7)", () => {
  it("API_VERSION is v1 and prefixes every route", () => {
    expect(API_VERSION).toBe("v1");
    expect(API_BASE_PATH).toBe("/api/v1");
  });

  it("CORE_VERSION is the package semver", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(CORE_VERSION).toBe(pkg.version);
  });

  it("schema and protocol versions are 1", () => {
    expect(CONFIG_SCHEMA_VERSION).toBe(1);
    expect(WS_PROTOCOL_VERSION).toBe(1);
    expect(EMBED_PROTOCOL_VERSION).toBe(1);
    expect(SOURCE_ADAPTER_API_VERSION).toBe(1);
  });
});
