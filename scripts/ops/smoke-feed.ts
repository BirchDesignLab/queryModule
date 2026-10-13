// scripts/ops/smoke-feed.ts
// Usage: QM_COOKIE=<name=value> node scripts/ops/smoke-feed.ts <baseUrl> <readyFile> <goFile> <bodyFile>
// Smoke step 4 (spec 8.7): opens the feed, sends hello and, once welcome arrives, creates readyFile.
// smoke.sh then submits and creates goFile; this reads the 202 body from bodyFile and waits for one
// non-pending sourceStatus per (partId, sourceId) of that body, bounded by SMOKE_SETTLE_MS (20 s).
// Once every source settles it reads GET /api/v1/queries/:correlationId with the same session and
// checks that every returned source carries a payload object (Task 7, #592; spec 8.7 step 4).
// Prints "4 ok: <n> sources settled, <r> returned", or "4 FAILED: <k> of <n> sources settled",
// "4 FAILED: detail read answered HTTP <status>" or "4 FAILED: <m> of <r> returned sources have no
// payload". The cookie comes from the environment, never argv; nothing printed carries the cookie,
// a password, a value or a payload.
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
// The 20 s bound may only shrink (tests); anything else is refused before the submit.
const boundArg = process.env.SMOKE_SETTLE_MS ?? "20000";
const boundMs = /^[0-9]{1,5}$/.test(boundArg) ? Number(boundArg) : 0;
if (boundMs < 1 || boundMs > 20_000) {
  process.stderr.write("SMOKE_SETTLE_MS must be an integer from 1 to 20000\n");
  process.exit(2);
}
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
// After welcome the submit follows, so a lost socket still ends in step 4's "k of n" line once
// the 202 body is read; before welcome there is nothing to count.
let welcomed = false;
let lost = false;
const lose = (why: string) => {
  if (!welcomed) die(why);
  if (lost) return;
  lost = true;
  process.stderr.write(`smoke feed lost: ${why}\n`);
  if (expected !== null) finish();
};
const end = (line: string, ok: boolean) => {
  process.stdout.write(`${line}\n`);
  ws.terminate();
  process.exit(ok ? 0 : 1);
};
type DetailSource = { status?: unknown; payload?: unknown };
/** The detail over HTTP: every returned source must carry a payload object. Prints counts only. */
const readDetail = async (n: number) => {
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/queries/${encodeURIComponent(correlationId)}`, {
      headers: { cookie, origin: base },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return end(`4 FAILED: detail read failed (${(e as Error).name})`, false);
  }
  if (res.status !== 200) return end(`4 FAILED: detail read answered HTTP ${res.status}`, false);
  let body: { parts?: { sources?: DetailSource[] }[] };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return end("4 FAILED: detail read was not JSON", false);
  }
  const returned = (Array.isArray(body.parts) ? body.parts : [])
    .flatMap((p) => (Array.isArray(p?.sources) ? p.sources : []))
    .filter((s) => s?.status === "returned");
  const missing = returned.filter(
    (s) => typeof s.payload !== "object" || s.payload === null || Array.isArray(s.payload),
  ).length;
  if (returned.length === 0) return end("4 FAILED: no returned source in the detail read", false);
  if (missing > 0)
    return end(
      `4 FAILED: ${missing} of ${returned.length} returned sources have no payload`,
      false,
    );
  end(`4 ok: ${n} sources settled, ${returned.length} returned`, true);
};
let finishing = false;
const finish = () => {
  if (finishing) return;
  finishing = true;
  const n = expected?.length ?? 0;
  const k = expected?.filter((e) => settled.has(e)).length ?? 0;
  // n === 0 (no dispatched part) fails: nothing answered, so step 4 cannot pass.
  if (n > 0 && k === n) void readDetail(n);
  else end(`4 FAILED: ${k} of ${n} sources settled`, false);
};
const check = () => {
  if (expected && expected.length > 0 && expected.every((e) => settled.has(e))) finish();
};

ws.on("open", () => ws.send(JSON.stringify({ v: 1, type: "hello", lastSeq: null })));
type Frame = {
  type?: string;
  status?: string;
  correlationId?: string;
  partId?: unknown;
  sourceId?: unknown;
};
const parse = (raw: string): Frame | null => {
  try {
    return JSON.parse(raw) as Frame;
  } catch {
    return null;
  }
};
ws.on("message", (d) => {
  // a frame that is not JSON is skipped, never echoed (it could carry a value)
  const m = parse(String(d));
  if (m === null) return;
  if (m.type === "welcome") {
    welcomed = true;
    writeFileSync(readyFile, "ready");
  } else if (m.type === "sourceStatus" && m.status !== "pending" && m.correlationId)
    settled.add(key(m.correlationId, m.partId, m.sourceId));
  check();
});
ws.on("unexpected-response", (_req, res) => die(`upgrade answered HTTP ${res.statusCode}`));
ws.on("error", (e) => lose(e.message));
ws.on("close", (code) => lose(`socket closed with ${code}`));

const poll = setInterval(() => {
  if (expected === null && existsSync(goFile)) {
    const body = JSON.parse(readFileSync(bodyFile, "utf8")) as {
      correlationId: string;
      parts?: unknown;
    };
    correlationId = body.correlationId;
    // a 202 without a parts array has nothing to settle: n = 0, "4 FAILED" (G-M1)
    const parts = (Array.isArray(body.parts) ? body.parts : []) as {
      partId: number;
      status: string;
      sourceIds?: unknown;
    }[];
    expected = parts
      .filter((p) => p?.status === "dispatched" && Array.isArray(p.sourceIds))
      .flatMap((p) => (p.sourceIds as string[]).map((s) => key(correlationId, p.partId, s)));
    deadline = Date.now() + boundMs;
    if (expected.length === 0 || lost) finish();
    check();
  }
  if (expected !== null && Date.now() >= deadline) {
    clearInterval(poll);
    finish();
  }
}, 100);
