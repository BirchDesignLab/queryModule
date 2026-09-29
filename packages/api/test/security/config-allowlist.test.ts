import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ClientSiteConfigSchema } from "@querymodule/core/config";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/test-app";

const bundled = resolve(import.meta.dirname, "../../../config");
// "kind" is a legitimate key elsewhere (mappings), so it is checked on sources only.
const FORBIDDEN = ["extends", "auth", "retention", "server", "maxConcurrent"];

function keysAtAnyDepth(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysAtAnyDepth(x, out);
  else if (v !== null && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysAtAnyDepth(x, out);
    }
  return out;
}

async function exampleApp() {
  const d = mkdtempSync(join(tmpdir(), "qm-allowlist-"));
  for (const dir of ["sites", "locales", "mock"])
    cpSync(join(bundled, dir), join(d, dir), { recursive: true });
  const t = await createTestApp({ env: { SITE_CONFIG: join(d, "sites/example-ok.json") } });
  await t.createUser("allow@example.test", "correct horse battery staple 1");
  const cookie = await t.cookieFor("allow@example.test", "correct horse battery staple 1");
  return { t, cookie };
}

describe("BR-001 GET config serves the resolved overlay (spec 4.1 client view, 10.3)", () => {
  it("serves the resolved example-ok view, strictly the allowlist (BR-007, SEC-006, UX-011)", async () => {
    const { t, cookie } = await exampleApp();
    const res = await t.request("/api/v1/config", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      terminal: { delimiter: string };
      defaults: { state: string };
      configHash: string;
      sources: Record<string, unknown>[];
    };
    expect(body.terminal.delimiter).toBe("/");
    expect(body.defaults.state).toBe("OK");
    const meta = (await (await t.request("/api/v1/meta")).json()) as { configHash: string };
    expect(body.configHash).toBe(meta.configHash);
    expect(ClientSiteConfigSchema.strict().safeParse(body).success).toBe(true);
    const keys = keysAtAnyDepth(body);
    for (const k of FORBIDDEN) expect(keys.has(k)).toBe(false);
    for (const s of body.sources) expect(s).not.toHaveProperty("kind");
  });
  it("anonymous gets 401", async () => {
    const { t } = await exampleApp();
    expect((await t.request("/api/v1/config")).status).toBe(401);
  });
});
