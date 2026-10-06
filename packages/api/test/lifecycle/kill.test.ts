import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createLocalUser } from "../../src/auth/users";
import { auditEvent, eventLog, sourceResult } from "../../src/db/schema";
import { loadDeps } from "../../src/startup";
import { removeTempDirs, sweepStaleTempDirs } from "../helpers/temp-dirs";

// Spec 10.4 "Kill during dispatch" (D-A16; NFR-003, SEC-010, SEC-012): the server runs as a child
// process on a file database with a 30 s mock latency; a submit is acknowledged, the child is
// SIGKILLed after the 202, and the restart's sweep marks those rows interrupted with one
// interrupted audit row each and an event_log row. Nothing is re-dispatched: after 35 s of real
// time, more than the mock latency, no sourceResponded row exists for them. CI only (POSIX
// signals); spawn-heavy, so it carries an explicit timeout.
const PREFIXES = ["qm-kill-"];
sweepStaleTempDirs(tmpdir(), 10 * 60 * 1000, PREFIXES);
const created: string[] = [];
afterAll(() => removeTempDirs(created.splice(0), "test/lifecycle/kill"));
const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `qm-kill-${label}-`));
  created.push(dir);
  return dir;
};

const apiDir = resolve(import.meta.dirname, "../..");
const configDir = resolve(apiDir, "../config");
const k = (fill: number) => Buffer.alloc(32, fill).toString("base64");
const EMAIL = "kill@example.test";
const PASSWORD = "correct-horse-battery-1";
const LATENCY_MS = 30_000;
const ORIGIN = "http://localhost:3000";

/** A port the child can bind, outside the OS ephemeral ranges (as main-fatal.test.ts). */
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

/** A copy of the bundled default site and mock: every mock source answers after 30 s. */
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
  // the deadline is past the latency, so a re-dispatched call would answer within the 35 s wait
  for (const s of site.sources) s.timeoutMs = LATENCY_MS + 1_000;
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

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((r) => child.once("exit", () => r()));
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

/** Reads the request's rows through loadDeps, which never sweeps (spec 5.2). */
async function inspect(env: NodeJS.ProcessEnv, correlationId: string, userId: string) {
  const deps = await loadDeps(env, { logSink: () => {} });
  try {
    const rows = await deps.db
      .select({ resultId: sourceResult.resultId, status: sourceResult.status })
      .from(sourceResult)
      .where(eq(sourceResult.correlationId, correlationId));
    const ids = rows.map((r) => r.resultId);
    const audit = await deps.db
      .select({ type: auditEvent.type, details: auditEvent.details })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.correlationId, correlationId),
          inArray(auditEvent.type, ["interrupted", "sourceResponded"]),
        ),
      );
    const events = await deps.db
      .select({ resultId: eventLog.resultId, status: eventLog.status })
      .from(eventLog)
      .where(and(eq(eventLog.userId, userId), inArray(eventLog.resultId, ids)));
    return { rows, audit, events };
  } finally {
    deps.db.$client.close();
  }
}

describe.skipIf(process.platform === "win32")(
  "spec 10.4 kill during dispatch (D-A16, NFR-003, SEC-010, SEC-012)",
  () => {
    it("SIGKILL after the 202: the restart marks the rows interrupted, audits each once, re-dispatches nothing", async () => {
      const env = await makeEnv();
      // the user, made before the first start on the same data dir
      const seed = await loadDeps(env, { logSink: () => {} });
      const userId = (
        await createLocalUser(seed.auth, { email: EMAIL, name: "Kill Test", password: PASSWORD })
      ).id;
      const { configHash } = seed.config.current();
      seed.db.$client.close();

      const first = await startChild(env);
      let correlationId: string;
      try {
        correlationId = await submit(`http://127.0.0.1:${env.PORT}`, configHash);
      } finally {
        first.child.kill("SIGKILL");
        await exited(first.child);
      }
      const killed = await inspect(env, correlationId, userId);
      expect(killed.rows.map((r) => r.status)).toEqual(["pending", "pending"]);
      expect(killed.audit).toEqual([]);

      const second = await startChild(env);
      try {
        // more than the mock latency: a re-dispatched call would have answered by now
        await new Promise((r) => setTimeout(r, LATENCY_MS + 5_000));
      } finally {
        second.child.kill("SIGTERM");
        await exited(second.child);
      }
      const after = await inspect(env, correlationId, userId);
      expect(after.rows.map((r) => r.status)).toEqual(["interrupted", "interrupted"]);
      const ids = after.rows.map((r) => r.resultId).sort();
      // one interrupted row each, and no sourceResponded row: nothing was re-dispatched
      expect(after.audit.every((a) => a.type === "interrupted")).toBe(true);
      expect(after.audit.map((a) => (a.details as { resultId: string }).resultId).sort()).toEqual(
        ids,
      );
      expect(after.events.map((e) => e.status)).toEqual(["interrupted", "interrupted"]);
      expect(after.events.map((e) => e.resultId).sort()).toEqual(ids);
    }, 120_000);
  },
);
