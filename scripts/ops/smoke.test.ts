import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = import.meta.dirname;
const secret = "smoke-test-secret-not-real";
const email = "smoke@example.test";

// Stub API: health, meta, sign-in (records the body) and config. No WebSocket, so step 5 fails.
let server: Server;
let base: string;
let signInBody: string | undefined;
let dir: string;
beforeEach(async () => {
  signInBody = undefined;
  dir = mkdtempSync(join(tmpdir(), "qm-smoke-"));
  writeFileSync(join(dir, "SEED_PASSWORD_SECRET"), `${secret}\n`);
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const json = (o: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(200, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(o));
      };
      if (req.url === "/api/v1/health") return json({ status: "ok" });
      if (req.url === "/api/v1/meta") return json({ apiVersion: "v1" });
      if (req.url === "/api/v1/auth/sign-in/email" && req.method === "POST") {
        signInBody = body;
        return json({}, { "set-cookie": "qm_session=abc123; Path=/; HttpOnly" });
      }
      if (req.url === "/api/v1/config" && req.headers.cookie === "qm_session=abc123")
        return json({ configHash: "x" });
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

function smoke(url: string): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const p = spawn("bash", [resolve(here, "smoke.sh"), url], {
      env: { ...process.env, SEED_PASSWORD_SECRET_FILE: join(dir, "SEED_PASSWORD_SECRET") },
    });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
    });
    p.stderr.on("data", (d) => {
      out += d;
    });
    p.on("close", (code) => done({ code, out }));
  });
}

describe("smoke.sh (spec 8.7)", { timeout: 30_000 }, () => {
  it("logs in as smoke with derivePassword's password, sent on stdin (G-I2, G-I3)", async () => {
    const r = await smoke(base);
    expect(r.out).toMatch(/1 ok: health and meta/);
    expect(r.out).toMatch(/2 ok: login as smoke and GET \/api\/v1\/config/);
    const pw = createHmac("sha256", secret).update(email).digest("base64url");
    expect(pw).toHaveLength(43);
    expect(JSON.parse(signInBody ?? "{}")).toEqual({ email, password: pw });
    // No WebSocket on the stub: step 5 fails, and nothing secret is printed on the way.
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain(pw);
    expect(r.out).not.toContain(secret);
    expect(r.out).not.toContain("abc123");
  });

  it("accepts a base URL with a trailing slash (G-M5)", async () => {
    const r = await smoke(`${base}/`);
    expect(r.out).toMatch(/2 ok/);
  });
});

describe("ws-soak.ts", { timeout: 30_000 }, () => {
  it("takes the cookie from QM_COOKIE, not argv (G-I2)", async () => {
    const r = await new Promise<number | null>((done) => {
      const env = { ...process.env };
      delete env.QM_COOKIE;
      spawn("node", [resolve(here, "ws-soak.ts"), base, "1"], { env }).on("close", done);
    });
    expect(r).toBe(2);
  });
});
