import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const created: string[] = [];
// Same tolerance as startup.test.ts: on win32 a just-closed libsql file can stay locked for a
// few seconds, so a stuck temp dir is left for a later sweep; every other error still throws.
afterAll(() => {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || (code !== "EPERM" && code !== "EBUSY")) throw e;
    }
  }
});
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
};

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address() as { port: number };
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

const apiDir = resolve(import.meta.dirname, "..");
const k = (fill: number) => Buffer.alloc(32, fill).toString("base64");
const AUTH_SECRET = k(4);

/**
 * Boots src/main.ts in a child process, waits for "listening", then has the preloaded fixture
 * raise `kind` with a message that embeds a loaded secret. Resolves with the exit code and output.
 */
async function runFatal(kind: "exception" | "rejection" | "double" | "sigterm") {
  const secrets = tempDir("qm-fatal-sec-");
  const files = {
    DB_ENCRYPTION_KEY: k(1),
    CREDENTIAL_KEY: k(2),
    DATA_KEY: k(3),
    BETTER_AUTH_SECRET: AUTH_SECRET,
  };
  for (const [n, v] of Object.entries(files)) writeFileSync(join(secrets, n), v);
  const trigger = join(tempDir("qm-fatal-trig-"), "go");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--import", "./test/fixtures/fatal-trigger.mjs", "src/main.ts"],
    {
      cwd: apiDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(await freePort()),
        PUBLIC_ORIGIN: "http://localhost:3000",
        DATA_DIR: tempDir("qm-fatal-data-"),
        SECRETS_DIR: secrets,
        QM_FATAL_TRIGGER: trigger,
        QM_FATAL_KIND: kind,
        QM_FATAL_MESSAGE: `boom SELECT * FROM mock_table WHERE key='${AUTH_SECRET}'`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (b: Buffer) => {
    stdout += b.toString();
    if (stdout.includes('"msg":"listening"')) writeFileSync(trigger, "");
  });
  child.stderr.on("data", (b: Buffer) => {
    stderr += b.toString();
  });
  const code = await new Promise<number | null>((r) => child.on("exit", (c) => r(c)));
  return { code, stdout, stderr };
}

describe("#224 main.ts fails closed on an error outside the request path (spec 8.1, 5.9)", () => {
  for (const [kind, event] of [
    ["exception", "uncaughtException"],
    ["rejection", "unhandledRejection"],
  ] as const) {
    it(`exits non-zero with exactly one fatal line and no secret or stack on ${event}`, async () => {
      const { code, stdout, stderr } = await runFatal(kind);
      expect(stdout).toContain('"msg":"listening"');
      expect(code).toBe(1);
      const fatal = stderr.split("\n").filter((l) => l.includes('"level":"fatal"'));
      expect(fatal).toHaveLength(1);
      const line = JSON.parse(fatal[0] ?? "{}");
      expect(line).toMatchObject({ level: "fatal", event, error: { name: "Error" } });
      expect(`${stdout}${stderr}`).not.toContain(AUTH_SECRET);
      expect(`${stdout}${stderr}`).not.toContain("SELECT");
      expect(stderr).not.toMatch(/^\s+at /m);
    }, 60_000);
  }

  const fatalLines = (stderr: string) =>
    stderr.split("\n").filter((l) => l.includes('"level":"fatal"'));

  it("a second fatal event during the drain exits 1 at once without a second line (#231 C-m2)", async () => {
    const { code, stdout, stderr } = await runFatal("double");
    expect(stdout).toContain('"msg":"listening"');
    expect(code).toBe(1);
    expect(fatalLines(stderr)).toHaveLength(1);
    expect(`${stdout}${stderr}`).not.toContain(AUTH_SECRET);
    expect(stderr).not.toMatch(/^\s+at /m);
  }, 60_000);

  it("SIGTERM during a fatal drain still exits 1, never the clean 0 (#231 C-m2)", async () => {
    const { code, stdout, stderr } = await runFatal("sigterm");
    expect(stdout).toContain('"msg":"listening"');
    expect(code).toBe(1);
    expect(fatalLines(stderr)).toHaveLength(1);
    expect(`${stdout}${stderr}`).not.toContain(AUTH_SECRET);
  }, 60_000);
});
