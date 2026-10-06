import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createLocalUser } from "../../src/auth/users";
import { sourceResult } from "../../src/db/schema";
import { loadDeps } from "../../src/startup";
import { removeTempDirs, sweepStaleTempDirs } from "../helpers/temp-dirs";

// Spec 5.2 SIGTERM drain, process level (NFR-003; spec 8.3, 10.4): the server runs as a child
// process on a file database with a 3 s mock latency and a 10 s source timeout; a submit is
// acknowledged, the child gets SIGTERM, and it exits 0 within timeoutMs + 5 s with every row
// terminal (the in-flight call answered before the DB closed). CI only (POSIX signals);
// spawn-heavy, so it carries an explicit timeout.
const PREFIXES = ["qm-drain-"];
sweepStaleTempDirs(tmpdir(), 10 * 60 * 1000, PREFIXES);
const created: string[] = [];
afterAll(() => removeTempDirs(created.splice(0), "test/lifecycle/drain-process"));
const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `qm-drain-${label}-`));
  created.push(dir);
  return dir;
};

const apiDir = resolve(import.meta.dirname, "../..");
const configDir = resolve(apiDir, "../config");
const k = (fill: number) => Buffer.alloc(32, fill).toString("base64");
const EMAIL = "drain@example.test";
const PASSWORD = "correct-horse-battery-1";
const LATENCY_MS = 3_000;
const TIMEOUT_MS = 10_000;
const ORIGIN = "http://localhost:3000";

/** A port the child can bind, outside the OS ephemeral ranges (as kill.test.ts). */
async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = 20_000 + Math.floor(Math.random() * 12_000);
    const srv = createServer();
    const bound = await new Promise<boolean>((r) => {
      srv.once("error", () => r(false));
      srv.listen(port, "0.0.0.0", () => r(true));
    });
    if (bound) {
      await new Promise<void>((r) => srv.close(() => r()));
      return port;
    }
  }
  throw new Error("no free port in 20000-31999");
}

/** A copy of the bundled default site and mock: every mock source answers after 3 s. */
function slowSiteConfig(): string {
  const root = tempDir("cfg");
  cpSync(join(configDir, "locales"), join(root, "locales"), { recursive: true });
  mkdirSync(join(root, "mock"));
  mkdirSync(join(root, "sites"));
  const mock = JSON.parse(readFileSync(join(configDir, "mock/default.json"), "utf8")) as {
    sources: Record<string, { latencyMs: [number, number] }>;
  };
  for (const s of Object.values(mock.sources)) s.latencyMs = [LATENCY_MS, LATENCY_MS];
  writeFileSync(join(root, "mock/default.json"), JSON.stringify(mock));
  const site = JSON.parse(readFileSync(join(configDir, "sites/default.json"), "utf8")) as {
    sources: { timeoutMs: number }[];
  };
  for (const s of site.sources) s.timeoutMs = TIMEOUT_MS;
  const file = join(root, "sites/slow.json");
  writeFileSync(file, JSON.stringify(site));
  return file;
}

async function makeEnv(): Promise<NodeJS.ProcessEnv> {
  const secrets = tempDir("sec");
  for (const [n, v] of Object.entries({
    DB_ENCRYPTION_KEY: k(1),
    CREDENTIAL_KEY: k(2),
    DATA_KEY: k(3),
    BETTER_AUTH_SECRET: k(4),
  }))
    writeFileSync(join(secrets, n), v);
  return {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(await freePort()),
    PUBLIC_ORIGIN: ORIGIN,
    DATA_DIR: tempDir("data"),
    SECRETS_DIR: secrets,
    ALLOW_MOCK_SOURCES: "true",
    SITE_CONFIG: slowSiteConfig(),
    WEB_DIST: "",
  };
}

/** Starts src/main.ts and resolves once it logs "listening". */
async function startChild(
  env: NodeJS.ProcessEnv,
): Promise<{ child: ChildProcess; out: () => string }> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: apiDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  await new Promise<void>((resolveStart, reject) => {
    child.stdout?.on("data", (b: Buffer) => {
      out += b.toString();
      if (out.includes('"msg":"listening"')) resolveStart();
    });
    child.stderr?.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.once("exit", (code) =>
      reject(new Error(`child exited ${code} before listening: ${out}`)),
    );
  });
  return { child, out: () => out };
}

function exitCode(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((r) => child.once("exit", (code) => r(code)));
}

async function submit(base: string, configHash: string): Promise<string> {
  const signIn = await fetch(`${base}/api/v1/auth/sign-in/email`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(signIn.status).toBe(200);
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .find((c) => c.startsWith("__Host-qm_session="));
  if (!cookie) throw new Error("no session cookie");
  const r = await fetch(`${base}/api/v1/queries`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      cookie,
      "content-type": "application/json",
      "x-requested-with": "querymodule",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      queryType: "VEH",
      values: { plate: "ZZ-0001", state: "TX" },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "normal",
      configHash,
    }),
  });
  expect(r.status).toBe(202);
  return SubmitQueryResponseSchema.parse(await r.json()).correlationId;
}

describe.skipIf(process.platform === "win32")("spec 5.2 SIGTERM drain (NFR-003, spec 8.3)", () => {
  it("SIGTERM after the 202: exit 0 within timeoutMs + 5 s, every row terminal", async () => {
    const env = await makeEnv();
    const seed = await loadDeps(env, { logSink: () => {} });
    await createLocalUser(seed.auth, { email: EMAIL, name: "Drain Test", password: PASSWORD });
    const { configHash } = seed.config.current();
    seed.db.$client.close();

    const { child, out } = await startChild(env);
    let correlationId: string;
    try {
      correlationId = await submit(`http://127.0.0.1:${env.PORT}`, configHash);
    } catch (e) {
      child.kill("SIGKILL");
      throw e;
    }
    const t0 = Date.now();
    child.kill("SIGTERM");
    const code = await exitCode(child);
    expect(Date.now() - t0).toBeLessThan(TIMEOUT_MS + 5_000);
    expect(code, out()).toBe(0);
    expect(out()).toContain('"msg":"stopped"');

    const deps = await loadDeps(env, { logSink: () => {} });
    try {
      const rows = await deps.db
        .select({ status: sourceResult.status })
        .from(sourceResult)
        .where(eq(sourceResult.correlationId, correlationId));
      expect(rows.map((r) => r.status)).toEqual(["returned", "returned"]);
    } finally {
      deps.db.$client.close();
    }
  }, 120_000);
});
