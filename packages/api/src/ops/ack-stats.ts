// D-M2P2-4, NFR-004: the "metric ackReceipt" summary behind scripts/ops/ack-stats.ts (#771 T12 Q2).
// Summarizes the "metric ackReceipt" log lines: the server-clock time from the acknowledgment to the
// client's receipt. One JSON line: count, p50, p95, max (ms) and malformed (lines that are not JSON
// objects, or whose e2eMs is not a finite number >= 0). Lines of any other message are ignored.
// Reads only; no values from the log are echoed.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface AckStats {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  malformed: number;
}

/** Nearest-rank percentile of an ascending list; null when empty. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

/** Folds NDJSON log lines into the summary. Blank lines are skipped, not counted. */
export function summarizeAckLines(lines: Iterable<string>): AckStats {
  const e2e: number[] = [];
  let malformed = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      malformed += 1;
      continue;
    }
    const r = rec as { msg?: unknown; e2eMs?: unknown };
    if (r.msg !== "metric ackReceipt") continue;
    if (typeof r.e2eMs !== "number" || !Number.isFinite(r.e2eMs) || r.e2eMs < 0) {
      malformed += 1;
      continue;
    }
    e2e.push(r.e2eMs);
  }
  e2e.sort((a, b) => a - b);
  return {
    count: e2e.length,
    p50: percentile(e2e, 50),
    p95: percentile(e2e, 95),
    max: e2e.at(-1) ?? null,
    malformed,
  };
}

async function* readLines(input: NodeJS.ReadableStream): AsyncGenerator<string> {
  for await (const l of createInterface({ input, crlfDelay: Infinity })) yield l;
}

export async function ackStatsOf(input: NodeJS.ReadableStream): Promise<AckStats> {
  const all: string[] = [];
  for await (const l of readLines(input)) all.push(l);
  return summarizeAckLines(all);
}

/** Where the CLI reads and writes; the wrapper passes the process streams. */
export interface AckStatsIo {
  stdin: NodeJS.ReadableStream;
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
}

/** The CLI: an optional log file argument, else stdin. Exit 0 printed, 1 unreadable input, 2 usage. */
export async function runAckStats(argv: string[], io: AckStatsIo): Promise<number> {
  if (argv.length > 1) {
    io.stderr.write("usage: ack-stats [log-file]\n");
    return 2;
  }
  const file = argv[0];
  try {
    const stats = await ackStatsOf(file ? createReadStream(file) : io.stdin);
    io.stdout.write(`${JSON.stringify(stats)}\n`);
    return 0;
  } catch {
    io.stderr.write("ack-stats: could not read the log input\n");
    return 1;
  }
}
