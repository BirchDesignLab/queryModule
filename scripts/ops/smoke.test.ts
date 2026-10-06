import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { derivePassword } from "../../packages/api/src/seed/password";

const here = import.meta.dirname;
const secret = "smoke-test-secret-not-real";
const email = "smoke@example.test";

// Stub API: health, meta, sign-in (records the body), config and submit (records the body), and a
// WebSocket feed. wsMode picks what the feed does after the 202: "all" settles both sources,
// "partial" settles one, "pong" settles both and answers pings (step 5 passes), "none" has no feed,
// "garbage" sends a non-JSON frame first and then settles both, "drop" settles one and closes.
type WsMode = "all" | "partial" | "pong" | "none" | "garbage" | "drop";
let wsMode: WsMode = "all";
let events: string[] = [];
const sockets = new Set<WebSocket>();
let wss: WebSocketServer;
let server: Server;
let base: string;
let signInBody: string | undefined;
let submitBody: string | undefined;
let submitStatus = 202;
let partStatus = "dispatched";
const stubHash = "a".repeat(64);
const stubCorrelationId = "01900000-0000-7000-8000-000000000001";
let dir: string;
beforeEach(async () => {
  signInBody = undefined;
  submitBody = undefined;
  submitStatus = 202;
  partStatus = "dispatched";
  wsMode = "all";
  events = [];
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
        return json({ configHash: stubHash });
      if (req.url === "/api/v1/queries" && req.method === "POST") {
        const ok =
          req.headers.cookie === "qm_session=abc123" &&
          req.headers.origin === base &&
          req.headers["x-requested-with"] === "querymodule" &&
          /^[A-Za-z0-9_-]{16,128}$/.test(String(req.headers["idempotency-key"]));
        if (!ok) return res.writeHead(403).end();
        submitBody = body;
        events.push("submit");
        res.writeHead(submitStatus, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            correlationId: stubCorrelationId,
            acknowledgedAt: 1,
            parts: [
              {
                partId: 0,
                queryType: "VEH",
                status: partStatus,
                sourceIds: partStatus === "dispatched" ? ["stateSource", "nationalSource"] : [],
                droppedSourceIds: [],
              },
            ],
          }),
        );
        if (submitStatus === 202) setTimeout(settle, 50);
        return;
      }
      res.writeHead(404).end();
    });
  });
  wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const ok =
      wsMode !== "none" &&
      req.url === "/api/v1/ws" &&
      req.headers.cookie === "qm_session=abc123" &&
      req.headers.origin === base;
    if (!ok) return void socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
      ws.on("message", (d) => {
        const m = JSON.parse(String(d)) as { type?: string; nonce?: string };
        if (m.type === "hello") {
          events.push("hello");
          ws.send(JSON.stringify({ v: 1, type: "welcome", latestSeq: 0 }));
        } else if (m.type === "ping") {
          if (wsMode === "pong") ws.send(JSON.stringify({ v: 1, type: "pong", nonce: m.nonce }));
          else ws.close(1011);
        }
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
const status = (sourceId: string, s: string, seq: number) =>
  JSON.stringify({
    v: 1,
    type: "sourceStatus",
    seq,
    at: 1,
    correlationId: stubCorrelationId,
    partId: 0,
    sourceId,
    resultId: `01900000-0000-7000-8000-00000000010${seq}`,
    status: s,
  });
function settle() {
  const frames = [
    ...(wsMode === "garbage" ? ["not json ZZ-9999"] : []),
    status("stateSource", "pending", 1),
    status("nationalSource", "pending", 2),
    status("stateSource", "complete", 3),
    ...(wsMode === "partial" || wsMode === "drop" ? [] : [status("nationalSource", "complete", 4)]),
  ];
  for (const ws of sockets) {
    for (const f of frames) ws.send(f);
    if (wsMode === "drop") ws.close(1011);
  }
}
afterEach(async () => {
  for (const ws of sockets) ws.terminate();
  sockets.clear();
  wss.close();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

function smoke(
  url: string,
  extra: string[] = [],
  env: Record<string, string> = {},
): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const p = spawn("bash", [resolve(here, "smoke.sh"), url, ...extra], {
      env: {
        ...process.env,
        SEED_PASSWORD_SECRET_FILE: join(dir, "SEED_PASSWORD_SECRET"),
        ...env,
      },
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

const derivedPassword = () => derivePassword(secret, email);

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
    // The submit body (plate, configHash) goes on stdin, not argv.
    expect(argv).toMatch(/^curl .*\/api\/v1\/queries/m);
    const curlLines = argv.split("\n").filter((l) => l.startsWith("curl "));
    expect(curlLines.join("\n")).not.toContain("ZZ-");
    expect(argv).not.toContain(stubHash);
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
    expect(call).toMatch(/-f (.*deploy\/compose\.yml) exec/);
    expect(call).not.toContain(secret);
  });

  it("finds the compose file when the checkout path contains a space (G-m3)", async () => {
    const checkout = join(dir, "my checkout");
    mkdirSync(join(checkout, "scripts", "ops"), { recursive: true });
    for (const f of ["smoke.sh", "ws-soak.ts", "smoke-feed.ts"])
      cpSync(join(here, f), join(checkout, "scripts", "ops", f));
    const docker = [
      'printf "%s\\n" "$*" >> "$STUB_DIR/docker.log"',
      'S=$9; shift 9; exec "$REAL_NODE" -e "$S" "$STUB_SECRET_FILE" "$2"',
    ].join("\n");
    const r = await smokeWithStubs(
      base,
      { docker },
      {
        SCRIPT: join(checkout, "scripts", "ops", "smoke.sh"),
        SEED_PASSWORD_SECRET_FILE: undefined,
        STUB_SECRET_FILE: join(dir, "SEED_PASSWORD_SECRET"),
      },
    );
    expect(r.out).toMatch(/2 ok: login as smoke/);
    const call = readFileSync(join(dir, "bin", "docker.log"), "utf8").trim();
    expect(call.match(/-f (.*deploy\/compose\.yml) exec/)?.[1]).toMatch(
      /my checkout\/scripts\/ops\/\.\.\/\.\.\/deploy\/compose\.yml$/,
    );
  });
});

describe("smoke.sh (spec 8.7)", { timeout: 30_000 }, () => {
  it("logs in as smoke with derivePassword's password, sent on stdin (G-I2, G-I3)", async () => {
    const r = await smoke(base);
    expect(r.out).toMatch(/1 ok: health and meta/);
    expect(r.out).toMatch(/2 ok: login as smoke and GET \/api\/v1\/config/);
    const pw = derivedPassword();
    expect(pw).toHaveLength(43);
    expect(JSON.parse(signInBody ?? "{}")).toEqual({ email, password: pw });
    // The stub closes the socket on a ping: step 5 fails, and nothing secret is printed on the way.
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain(pw);
    expect(r.out).not.toContain(secret);
    expect(r.out).not.toContain("abc123");
  });

  it("step 3 submits a VEH query with step 2's configHash and expects 202", async () => {
    const r = await smoke(base);
    expect(r.out).toContain(`3 ok: submit 202 ${stubCorrelationId}`);
    const sent = JSON.parse(submitBody ?? "{}");
    expect(sent.configHash).toBe(stubHash);
    expect(sent.queryType).toBe("VEH");
    expect(sent.values.plate).toMatch(/^ZZ-\d{4}$/);
    expect(Object.keys(sent).sort()).toEqual(
      ["configHash", "mode", "queryType", "sourceIds", "values"].sort(),
    );
  });

  it("step 3 fails on any status but 202, before step 5, naming the status", async () => {
    submitStatus = 200;
    const r = await smoke(base);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/2 ok/);
    expect(r.out).toMatch(/step 3.*200/);
    expect(r.out).not.toMatch(/3 ok/);
    expect(r.out).not.toMatch(/5 ok/);
    expect(r.out).not.toContain(stubCorrelationId);
  });

  it("runs steps 1 to 5 in order, the feed opening before the submit", async () => {
    wsMode = "pong";
    const r = await smoke(base, ["--soak", "1s"]);
    expect(r.code).toBe(0);
    const at = ["1 ok", "2 ok", "3 ok", "4 ok: 2 sources settled", "5 ok"].map((t) =>
      r.out.indexOf(t),
    );
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(events.slice(0, 2)).toEqual(["hello", "submit"]);
  });

  it("step 4 fails within the bound when one source never settles, with the exact text", async () => {
    wsMode = "partial";
    const r = await smoke(base, [], { SMOKE_SETTLE_MS: "1500" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("4 FAILED: 1 of 2 sources settled");
    expect(r.out).not.toMatch(/4 ok/);
    expect(r.out).not.toMatch(/5 ok/);
  });

  it("step 4 fails when the 202 has no dispatched part (nothing to settle)", async () => {
    partStatus = "skipped";
    const r = await smoke(base, [], { SMOKE_SETTLE_MS: "1500" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("4 FAILED: 0 of 0 sources settled");
    expect(r.out).not.toMatch(/4 ok/);
    expect(r.out).not.toMatch(/5 ok/);
  });

  it("step 4 never prints the cookie, the password or the payload", async () => {
    wsMode = "partial";
    const r = await smoke(base, [], { SMOKE_SETTLE_MS: "1000" });
    expect(r.out).not.toContain("abc123");
    expect(r.out).not.toContain(derivedPassword());
    expect(r.out).not.toContain("ZZ-");
    expect(r.out).not.toContain(stubHash);
  });

  it("step 4 skips a non-JSON frame without echoing it (AW5 T14 Q5)", async () => {
    wsMode = "garbage";
    const r = await smoke(base);
    expect(r.out).toContain("4 ok: 2 sources settled");
    expect(r.out).not.toContain("ZZ-9999");
  });

  it("step 4 reports k of n when the feed closes before every source settles (AW5 T14 Q4)", async () => {
    wsMode = "drop";
    const r = await smoke(base, [], { SMOKE_SETTLE_MS: "5000" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("4 FAILED: 1 of 2 sources settled");
    expect(r.out).not.toMatch(/5 ok/);
  });

  it.each(["abc", "0", "60000"])(
    "refuses SMOKE_SETTLE_MS=%s before the submit: the bound is 1 to 20000 ms (AW5 T14 Q3)",
    async (v) => {
      const r = await smoke(base, [], { SMOKE_SETTLE_MS: v });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("SMOKE_SETTLE_MS must be an integer from 1 to 20000");
      expect(events).not.toContain("submit");
    },
  );

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
