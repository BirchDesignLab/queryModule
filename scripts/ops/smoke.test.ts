import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * Runs smoke.sh with fake commands first on PATH. Each stub is a bash script body; it can call
 * the real binaries through $REAL_NODE and $REAL_CURL, and log to $STUB_DIR.
 */
function smokeWithStubs(
  url: string,
  stubs: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<{ code: number | null; out: string }> {
  const stubDir = join(dir, "bin");
  mkdirSync(stubDir, { recursive: true });
  for (const [name, body] of Object.entries(stubs))
    writeFileSync(join(stubDir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  const script =
    'export REAL_NODE="$(command -v node)" REAL_CURL="$(command -v curl)"; ' +
    'export PATH="$(cd "$STUB_DIR" && pwd):$PATH"; exec bash "$SCRIPT" "$URL"';
  return new Promise((done) => {
    const merged: NodeJS.ProcessEnv = {
      ...process.env,
      STUB_DIR: stubDir,
      SCRIPT: resolve(here, "smoke.sh"),
      URL: url,
    };
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const p = spawn("bash", ["-c", script], { env: merged });
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

const derivedPassword = () => createHmac("sha256", secret).update(email).digest("base64url");

describe("smoke.sh keeps secrets off argv (G-I2, #167)", { timeout: 30_000 }, () => {
  it("never passes the seed secret, the password or the session cookie as an argument", async () => {
    // node and curl log their full argv, then run the real binary.
    const log = 'printf "%s\\n" "$(basename "$0") $*" >> "$STUB_DIR/argv.log"';
    const r = await smokeWithStubs(
      base,
      {
        node: `${log}\nexec "$REAL_NODE" "$@"`,
        curl: `${log}\nexec "$REAL_CURL" "$@"`,
      },
      { SEED_PASSWORD_SECRET_FILE: join(dir, "SEED_PASSWORD_SECRET") },
    );
    expect(r.out).toMatch(/2 ok: login as smoke/);
    const argv = readFileSync(join(dir, "bin", "argv.log"), "utf8");
    expect(argv).toMatch(/^node /m);
    expect(argv).toMatch(/^curl .*sign-in\/email/m);
    expect(argv).not.toContain(derivedPassword());
    expect(argv).not.toContain(secret);
    expect(argv).not.toContain("abc123");
  });
});

describe("smoke.sh on the deploy host (G-I3, #167)", { timeout: 30_000 }, () => {
  it("derives the password inside the app container from /run/secrets", async () => {
    // A fake docker that checks the exec shape, then runs the same node -e script on the host
    // with the test's secret file standing in for the container's /run/secrets file.
    const docker = [
      'printf "%s\\n" "$*" >> "$STUB_DIR/docker.log"',
      '[ "$1 $2" = "compose -f" ] || exit 97',
      '[ "$4 $5 $6 $7 $8" = "exec -T app node -e" ] || exit 97',
      'SCRIPT_E=$9; shift 9; [ "$1" = /run/secrets/SEED_PASSWORD_SECRET ] || exit 98',
      'exec "$REAL_NODE" -e "$SCRIPT_E" "$STUB_SECRET_FILE" "$2"',
    ].join("\n");
    const r = await smokeWithStubs(
      base,
      { docker },
      {
        SEED_PASSWORD_SECRET_FILE: undefined,
        STUB_SECRET_FILE: join(dir, "SEED_PASSWORD_SECRET"),
      },
    );
    expect(r.out).toMatch(/2 ok: login as smoke/);
    expect(JSON.parse(signInBody ?? "{}")).toEqual({ email, password: derivedPassword() });
    const call = readFileSync(join(dir, "bin", "docker.log"), "utf8").trim();
    expect(call.split(" ")[2]).toMatch(/deploy\/compose\.yml$/);
    expect(call).not.toContain(secret);
  });
});

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
