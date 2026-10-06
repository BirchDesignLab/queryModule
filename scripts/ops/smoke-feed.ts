// scripts/ops/smoke-feed.ts
// Usage: QM_COOKIE=<name=value> node scripts/ops/smoke-feed.ts <baseUrl> <readyFile> <goFile> <bodyFile>
// Smoke step 4 (spec 8.7): opens the feed, sends hello and, once welcome arrives, creates readyFile.
// smoke.sh then submits and creates goFile; this reads the 202 body from bodyFile and waits for one
// non-pending sourceStatus per (partId, sourceId) of that body, bounded by SMOKE_SETTLE_MS (20 s).
// Prints "4 ok: <n> sources settled" or "4 FAILED: <k> of <n> sources settled". The cookie comes from
// the environment, never argv; nothing printed carries the cookie, a password or a payload.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import WebSocket from "ws";

const [baseArg, readyFile, goFile, bodyFile] = process.argv.slice(2);
const cookie = process.env.QM_COOKIE;
if (!baseArg || !readyFile || !goFile || !bodyFile || !cookie) {
  process.stderr.write(
    "usage: QM_COOKIE=<name=value> smoke-feed <baseUrl> <readyFile> <goFile> <bodyFile>\n",
  );
  process.exit(2);
}
const base = baseArg.replace(/\/$/, "");
const boundMs = Number(process.env.SMOKE_SETTLE_MS ?? "20000");
const settled = new Set<string>();
let expected: string[] | null = null;
let correlationId = "";
let deadline = 0;
const key = (cid: string, partId: unknown, sourceId: unknown) => `${cid}|${partId}|${sourceId}`;

const ws = new WebSocket(`${base.replace(/^http/, "ws")}/api/v1/ws`, {
  headers: { origin: base, cookie },
});
const die = (why: string) => {
  process.stderr.write(`smoke feed failed: ${why}\n`);
  process.exit(1);
};
const finish = () => {
  const n = expected?.length ?? 0;
  const k = expected?.filter((e) => settled.has(e)).length ?? 0;
  // n === 0 (no dispatched part) fails: nothing answered, so step 4 cannot pass.
  const ok = n > 0 && k === n;
  if (ok) process.stdout.write(`4 ok: ${n} sources settled\n`);
  else process.stdout.write(`4 FAILED: ${k} of ${n} sources settled\n`);
  ws.terminate();
  process.exit(ok ? 0 : 1);
};
const check = () => {
  if (expected && expected.length > 0 && expected.every((e) => settled.has(e))) finish();
};

ws.on("open", () => ws.send(JSON.stringify({ v: 1, type: "hello", lastSeq: null })));
ws.on("message", (d) => {
  const m = JSON.parse(String(d)) as {
    type?: string;
    status?: string;
    correlationId?: string;
    partId?: unknown;
    sourceId?: unknown;
  };
  if (m.type === "welcome") writeFileSync(readyFile, "ready");
  else if (m.type === "sourceStatus" && m.status !== "pending" && m.correlationId)
    settled.add(key(m.correlationId, m.partId, m.sourceId));
  check();
});
ws.on("unexpected-response", (_req, res) => die(`upgrade answered HTTP ${res.statusCode}`));
ws.on("error", (e) => die(e.message));
ws.on("close", (code) => die(`socket closed with ${code}`));

const poll = setInterval(() => {
  if (expected === null && existsSync(goFile)) {
    const body = JSON.parse(readFileSync(bodyFile, "utf8")) as {
      correlationId: string;
      parts: { partId: number; status: string; sourceIds: string[] }[];
    };
    correlationId = body.correlationId;
    expected = body.parts
      .filter((p) => p.status === "dispatched")
      .flatMap((p) => p.sourceIds.map((s) => key(correlationId, p.partId, s)));
    deadline = Date.now() + boundMs;
    if (expected.length === 0) finish();
    check();
  }
  if (expected !== null && Date.now() >= deadline) {
    clearInterval(poll);
    finish();
  }
}, 100);
