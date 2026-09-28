// scripts/ops/ws-soak.ts
// Usage: node scripts/ops/ws-soak.ts <baseUrl> <cookie name=value> <seconds>
// Holds an authenticated socket, pings every 20 s, fails on 2 missed pongs or an early close (spec 6.8, 8.7).
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const [base, cookie, secsArg] = process.argv.slice(2);
if (!base || !cookie) {
  process.stderr.write("usage: ws-soak <baseUrl> <cookie> <seconds>\n");
  process.exit(2);
}
const secs = Number(secsArg ?? "25");
const ws = new WebSocket(`${base.replace(/^http/, "ws")}/api/v1/ws`, {
  headers: { origin: base, cookie },
});
let pongs = 0;
let missed = 0;
let pending: string | null = null;
let done = false;
const fail = (why: string) => {
  if (done) return;
  done = true;
  process.stderr.write(`ws soak failed: ${why}\n`);
  process.exit(1);
};
const tick = () => {
  if (pending) {
    missed += 1;
    if (missed >= 2) fail("2 missed pongs");
  }
  pending = randomUUID();
  ws.send(JSON.stringify({ v: 1, type: "ping", nonce: pending }));
};
ws.on("open", () => {
  ws.send(JSON.stringify({ v: 1, type: "hello", lastSeq: null }));
  tick();
  setInterval(tick, 20_000);
});
ws.on("message", (d) => {
  const m = JSON.parse(String(d)) as { type?: string; nonce?: string };
  if (m.type === "pong" && m.nonce === pending) {
    pongs += 1;
    pending = null;
    missed = 0;
  }
});
ws.on("unexpected-response", (_req, res) => fail(`upgrade answered HTTP ${res.statusCode}`));
ws.on("error", (e) => fail(e.message));
ws.on("close", (code) => fail(`socket closed with ${code}`));
setTimeout(() => {
  done = true;
  process.stdout.write(`ws soak ok: ${pongs} pongs over ${secs}s\n`);
  ws.terminate();
  process.exit(pongs >= 1 ? 0 : 1);
}, secs * 1000);
