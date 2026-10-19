import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { ackStatsOf, percentile, summarizeAckLines } from "./ack-stats";

// D-M2P2-4, NFR-004: percentiles over "metric ackReceipt" log lines. Mock ids only.
const line = (e2eMs: unknown, msg = "metric ackReceipt") =>
  JSON.stringify({ level: "info", time: 1, msg, correlationId: "c", e2eMs });
const FIXTURE = [
  ...[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => line(n)),
  line(5, "something else"),
  "not json {",
  "[1,2]",
  line("NaN"),
  line(-3),
  "",
];

describe("ack-stats", () => {
  it("prints count, p50, p95, max and counts malformed lines", () => {
    expect(summarizeAckLines(FIXTURE)).toEqual({
      count: 10,
      p50: 50,
      p95: 100,
      max: 100,
      malformed: 4,
    });
  });

  it("an empty input gives zero and null", () => {
    expect(summarizeAckLines([])).toEqual({
      count: 0,
      p50: null,
      p95: null,
      max: null,
      malformed: 0,
    });
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
  });

  it("reads a stream", async () => {
    const s = await ackStatsOf(Readable.from([`${FIXTURE.join("\r\n")}\n`]));
    expect(s.count).toBe(10);
    expect(s.malformed).toBe(4);
  });
});

describe("ack-stats CLI", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const script = resolve(import.meta.dirname, "ack-stats.ts");
  const run = (args: string[], input?: string) =>
    spawnSync(process.execPath, [script, ...args], { encoding: "utf8", input, timeout: 30_000 });

  it("reads a file argument or stdin and prints one JSON line", () => {
    dir = mkdtempSync(join(tmpdir(), "qm-ack-stats-"));
    const f = join(dir, "log.ndjson");
    writeFileSync(f, `${FIXTURE.join("\n")}\n`);
    const want = { count: 10, p50: 50, p95: 100, max: 100, malformed: 4 };
    const a = run([f]);
    expect(a.status).toBe(0);
    expect(JSON.parse(a.stdout)).toEqual(want);
    const b = run([], `${FIXTURE.join("\n")}\n`);
    expect(b.status).toBe(0);
    expect(JSON.parse(b.stdout)).toEqual(want);
  }, 30_000);

  it("a missing file or extra arguments fail", () => {
    dir = mkdtempSync(join(tmpdir(), "qm-ack-stats-"));
    expect(run([join(dir, "nope.log")]).status).toBe(1);
    expect(run(["a", "b"]).status).toBe(2);
  }, 30_000);
});
