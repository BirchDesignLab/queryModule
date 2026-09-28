import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { injectNonce } from "../src/http/web";
import { createTestApp } from "./helpers/test-app";

function dist(): string {
  const d = mkdtempSync(join(tmpdir(), "qm-web-"));
  mkdirSync(join(d, "assets"));
  writeFileSync(
    join(d, "index.html"),
    '<!doctype html><html><head><script type="module" nonce="__CSP_NONCE__" src="/assets/app-1a2b.js"></script></head><body></body></html>',
  );
  writeFileSync(join(d, "assets/app-1a2b.js"), "export {};");
  return d;
}

describe("SEC-006 web build serving", () => {
  it("serves index.html with a fresh CSP nonce on every response", async () => {
    const t = await createTestApp({ env: { WEB_DIST: dist() } });
    const a = await t.request("/");
    const b = await t.request("/settings/credentials/x");
    const nonceA = /'nonce-([^']+)'/.exec(a.headers.get("content-security-policy") ?? "")?.[1];
    const nonceB = /'nonce-([^']+)'/.exec(b.headers.get("content-security-policy") ?? "")?.[1];
    expect(nonceA).toBeDefined();
    expect(nonceA).not.toBe(nonceB);
    expect(await a.text()).toContain(`<script type="module" nonce="${nonceA}"`);
    expect(a.headers.get("cache-control")).toBe("no-store");
  });
  it("hashed assets are immutable; unknown /api paths stay JSON 404", async () => {
    const t = await createTestApp({ env: { WEB_DIST: dist() } });
    const js = await t.request("/assets/app-1a2b.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const api = await t.request("/api/v1/nope");
    expect(api.status).toBe(404);
    expect(api.headers.get("content-type")).toMatch(/json/);
  });
  it("a missing /assets/* path is a JSON 404, not the SPA shell, and never immutable", async () => {
    const t = await createTestApp({ env: { WEB_DIST: dist() } });
    const r = await t.request("/assets/missing-chunk.js");
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).not.toBe("public, max-age=31536000, immutable");
    expect(r.headers.get("content-type")).toMatch(/json/);
  });
});

describe("IC1 injectNonce replaces vite's __CSP_NONCE__ placeholder", () => {
  it("stamps exactly one nonce attribute and leaves no placeholder behind", () => {
    const built = '<script type="module" nonce="__CSP_NONCE__" src="/assets/app-1a2b.js"></script>';
    const out = injectNonce(built, "fresh-value");
    expect(out).toBe(
      '<script type="module" nonce="fresh-value" src="/assets/app-1a2b.js"></script>',
    );
    expect((out.match(/nonce="/g) ?? []).length).toBe(1);
    expect(out).not.toContain("__CSP_NONCE__");
  });
});
