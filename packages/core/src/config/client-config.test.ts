import { describe, expect, it } from "vitest";
import { ClientSiteConfigSchema, toClientSiteConfig } from "./client-config";
import { SiteConfigSchema } from "./schema";
import { minimalSiteConfigInput } from "./test-fixtures";

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
    });
  });

  it("keeps delegation purposes without delegatorRoles", () => {
    expect(toClientSiteConfig(serverConfig(), HASH).delegation).toEqual({
      purposes: [{ key: "training", labelKey: "delegation.training" }],
      maxDurationMinutes: 480,
    });
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

  it("rejects a non-hex configHash", () => {
    expect(() =>
      ClientSiteConfigSchema.parse({
        ...toClientSiteConfig(serverConfig(), HASH),
        configHash: "not-hex",
      }),
    ).toThrow();
  });
});
