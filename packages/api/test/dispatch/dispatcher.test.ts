import type { SourcePayload } from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type AdapterRegistry,
  type SourceAdapter,
  SourceError,
  type SourceRequest,
} from "../../src/adapters/types";
import type { LoadedConfig } from "../../src/config/load";
import {
  createDispatcher,
  DISPATCH_CAPS,
  type DispatchJob,
  type Outcome,
} from "../../src/dispatch/dispatcher";
import { abortError, type Timers } from "../../src/dispatch/timers";
import { captureLogger } from "../helpers/fixture";

// Spec 5.2 step 5, FR-040, FR-041, FR-043, FR-044, NFR-002: per-source deadlines and caps, one
// outcome per job, no retries. Time is a manual fake: no real sleeps.
const T0 = 1_790_000_000_000;
const PLATE = "ZZ-0001";
const SNAP = { configHash: "h-1" } as unknown as LoadedConfig;
const PAYLOAD = { summary: "mock" } as unknown as SourcePayload;

/** Manual time: clock, monotonic clock and Timers all read one `now`, moved only by advance. */
function fakeTime() {
  let now = T0;
  let nextId = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout(fn, ms) {
      nextId += 1;
      pending.set(nextId, { at: now + ms, fn });
      return nextId;
    },
    clearTimeout(h) {
      pending.delete(h as number);
    },
    sleep: () => Promise.reject(new Error("sleep is not used by the dispatcher")),
  };
  async function advance(ms: number): Promise<void> {
    const target = now + ms;
    for (;;) {
      await settle();
      let due: [number, { at: number; fn: () => void }] | undefined;
      for (const e of pending) if (e[1].at <= target && (!due || e[1].at < due[1].at)) due = e;
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = target;
    await settle();
  }
  return {
    clock: { now: () => now },
    monotonic: { nowMs: () => now - T0 + 5 },
    timers,
    advance,
    timerCount: () => pending.size,
  };
}

/** Lets every queued promise callback run (real setImmediate; the fake time owns no macrotask). */
const settle = () => new Promise<void>((r) => setImmediate(r));

interface Call {
  req: SourceRequest;
  creds: unknown;
  signal: AbortSignal;
  resolve: (p: SourcePayload) => void;
  reject: (e: unknown) => void;
}

/** A registry whose one adapter records each call and leaves it for the test to settle. */
function fakeAdapters() {
  const calls: Call[] = [];
  const adapter: SourceAdapter = {
    query: (req, creds, signal) =>
      new Promise<SourcePayload>((resolve, reject) => {
        calls.push({ req, creds, signal, resolve, reject });
      }),
  };
  const get = vi.fn((_kind: string, _snapshot: LoadedConfig) => adapter);
  const adapters: AdapterRegistry = { get };
  return { adapters, calls, get };
}

let n = 0;
function job(over: Partial<DispatchJob> = {}): DispatchJob {
  n += 1;
  return {
    correlationId: "corr-1",
    partId: 0,
    sourceId: "stateSource",
    resultId: `result-${n}`,
    userId: "user-1",
    actor: { id: "user-1", email: null, role: "user" },
    identitySource: "local",
    queryType: "VEH",
    types: { vehicleType: "PC" },
    values: { plate: PLATE },
    snapshot: SNAP,
    adapterKind: "mock",
    credentialUserId: null,
    delegationId: null,
    requiresCredentials: false,
    deadline: T0 + 10_000,
    // fakeTime's monotonic reading at T0: the job was acknowledged then
    acknowledgedMonoMs: 5,
    ...over,
  };
}

interface Seen {
  job: DispatchJob;
  outcome: Outcome;
  latencyMs: number;
}

function setup(o: { onOutcome?: (s: Seen) => Promise<void> } = {}) {
  const time = fakeTime();
  const fa = fakeAdapters();
  const logger = captureLogger();
  const seen: Seen[] = [];
  const dispatcher = createDispatcher(
    {
      adapters: fa.adapters,
      clock: time.clock,
      monotonic: time.monotonic,
      timers: time.timers,
      logger,
    },
    async (j, outcome, latencyMs) => {
      const s = { job: j, outcome, latencyMs };
      seen.push(s);
      if (o.onOutcome) await o.onOutcome(s);
    },
  );
  return { time, ...fa, logger, seen, dispatcher };
}

describe("DISPATCH_CAPS", () => {
  it("is spec 5.2's defaults: 4 per source, 32 in all", () => {
    expect(DISPATCH_CAPS).toEqual({ perSource: 4, global: 32 });
  });
});

describe("createDispatcher outcomes (spec 5.2 step 5, FR-043, FR-044)", () => {
  it("a returning adapter gives returned with its payload and the monotonic latency", async () => {
    const s = setup();
    const j = job();
    s.dispatcher.enqueue([j]);
    expect(s.get).toHaveBeenCalledWith("mock", SNAP);
    expect(s.calls).toHaveLength(1);
    const call = s.calls[0];
    expect(call?.req).toEqual({
      correlationId: "corr-1",
      partId: 0,
      sourceId: "stateSource",
      queryType: "VEH",
      values: { plate: PLATE },
      types: { vehicleType: "PC" },
    });
    expect(call?.creds).toBeNull();
    await s.time.advance(250);
    call?.resolve(PAYLOAD);
    await s.time.advance(0);
    expect(s.seen).toEqual([
      { job: j, outcome: { status: "returned", payload: PAYLOAD }, latencyMs: 250 },
    ]);
    // the deadline timer is cleared once the job settles
    expect(s.time.timerCount()).toBe(0);
    expect(call?.signal.aborted).toBe(false);
    expect(s.dispatcher.inFlight()).toBe(0);
  });

  it("SourceError maps to its code: credentialsRejected and failed", async () => {
    const s = setup();
    s.dispatcher.enqueue([job(), job()]);
    s.calls[0]?.reject(new SourceError("credentialsRejected"));
    s.calls[1]?.reject(new SourceError("failed"));
    await s.time.advance(0);
    expect(s.seen.map((x) => x.outcome)).toEqual([
      { status: "credentialsRejected", errorCode: "credentialsRejected" },
      { status: "failed", errorCode: "failed" },
    ]);
  });

  it("a plain Error, or a registry that throws, gives failed", async () => {
    const s = setup();
    s.dispatcher.enqueue([job()]);
    s.calls[0]?.reject(new Error(`adapter text ${PLATE}`));
    s.get.mockImplementationOnce(() => {
      throw new Error("mock adapter disabled");
    });
    s.dispatcher.enqueue([job()]);
    await s.time.advance(0);
    expect(s.seen.map((x) => x.outcome)).toEqual([
      { status: "failed", errorCode: "failed" },
      { status: "failed", errorCode: "failed" },
    ]);
    expect(JSON.stringify(s.logger.entries)).not.toContain(PLATE);
  });

  it("a never-settling adapter gives timedOut exactly at the deadline, its signal aborted", async () => {
    const s = setup();
    const j = job({ deadline: T0 + 1_000 });
    s.dispatcher.enqueue([j]);
    await s.time.advance(999);
    expect(s.seen).toEqual([]);
    expect(s.calls[0]?.signal.aborted).toBe(false);
    await s.time.advance(1);
    expect(s.seen).toEqual([{ job: j, outcome: { status: "timedOut" }, latencyMs: 1_000 }]);
    expect(s.calls[0]?.signal.aborted).toBe(true);
    expect(s.time.timerCount()).toBe(0);
  });

  it("a settlement after the deadline is logged once with ids only and changes nothing", async () => {
    const s = setup();
    const j = job({ deadline: T0 + 1_000 });
    s.dispatcher.enqueue([j, job({ deadline: T0 + 1_000, sourceId: "nationalSource" })]);
    await s.time.advance(1_000);
    expect(s.seen).toHaveLength(2);
    s.calls[0]?.resolve(PAYLOAD);
    s.calls[0]?.resolve(PAYLOAD);
    s.calls[1]?.reject(new SourceError("failed"));
    await s.time.advance(5_000);
    expect(s.seen).toHaveLength(2);
    expect(s.seen.map((x) => x.outcome.status)).toEqual(["timedOut", "timedOut"]);
    expect(s.logger.entries).toEqual([
      {
        level: "warn",
        msg: "dispatch late settlement",
        f: { resultId: j.resultId, sourceId: "stateSource" },
      },
      {
        level: "warn",
        msg: "dispatch late settlement",
        f: { resultId: s.seen[1]?.job.resultId, sourceId: "nationalSource" },
      },
    ]);
    expect(JSON.stringify(s.logger.entries)).not.toMatch(/ZZ-0001|mock/);
  });

  it("an adapter honouring the deadline abort (AbortError) is not a late settlement (AW3 critic c)", async () => {
    const s = setup();
    const j = job({ deadline: T0 + 1_000 });
    s.dispatcher.enqueue([j]);
    await s.time.advance(1_000);
    expect(s.calls[0]?.signal.aborted).toBe(true);
    s.calls[0]?.reject(abortError());
    await s.time.advance(1);
    expect(s.seen.map((x) => x.outcome.status)).toEqual(["timedOut"]);
    expect(s.logger.entries).toEqual([]);
  });

  it("requiresCredentials with no credential gives credentialsMissing without an adapter call", async () => {
    const s = setup();
    const j = job({ requiresCredentials: true, credentialUserId: null });
    // m2 ruling: latency runs from the acknowledgment, so time before enqueue counts
    await s.time.advance(250);
    s.dispatcher.enqueue([j]);
    await s.time.advance(0);
    expect(s.get).not.toHaveBeenCalled();
    expect(s.calls).toHaveLength(0);
    expect(s.seen).toEqual([{ job: j, outcome: { status: "credentialsMissing" }, latencyMs: 250 }]);
  });

  it("requiresCredentials with a credential owner calls the adapter", async () => {
    const s = setup();
    s.dispatcher.enqueue([job({ requiresCredentials: true, credentialUserId: "user-1" })]);
    expect(s.calls).toHaveLength(1);
  });
});

describe("createDispatcher caps and queueing (spec 5.2, NFR-002)", () => {
  it("6 jobs on one source: 4 run, 2 wait, and the next starts when one settles", async () => {
    const s = setup();
    const jobs = Array.from({ length: 6 }, () => job());
    s.dispatcher.enqueue(jobs);
    expect(s.calls.map((c) => c.req.sourceId)).toHaveLength(4);
    expect(s.dispatcher.inFlight()).toBe(6);
    s.calls[0]?.resolve(PAYLOAD);
    await s.time.advance(0);
    expect(s.calls).toHaveLength(5);
    expect(s.seen.map((x) => x.job)).toEqual([jobs[0]]);
  });

  it("40 jobs over 10 sources: at most 32 run at once, and a slot frees for the queue", async () => {
    const s = setup();
    const jobs = Array.from({ length: 40 }, (_, i) => job({ sourceId: `source${i % 10}` }));
    s.dispatcher.enqueue(jobs);
    expect(s.calls).toHaveLength(32);
    const perSource = new Map<string, number>();
    for (const c of s.calls)
      perSource.set(c.req.sourceId, (perSource.get(c.req.sourceId) ?? 0) + 1);
    expect(Math.max(...perSource.values())).toBeLessThanOrEqual(4);
    s.calls[0]?.resolve(PAYLOAD);
    await s.time.advance(0);
    expect(s.calls).toHaveLength(33);
  });

  it("latencyMs runs from the acknowledgment to the outcome, queue wait included (m2 ruling)", async () => {
    const s = setup();
    const jobs = Array.from({ length: 5 }, () => job());
    s.dispatcher.enqueue(jobs);
    expect(s.calls).toHaveLength(4);
    await s.time.advance(300);
    s.calls[0]?.resolve(PAYLOAD);
    await s.time.advance(0);
    expect(s.calls).toHaveLength(5);
    await s.time.advance(200);
    s.calls[4]?.resolve(PAYLOAD);
    await s.time.advance(0);
    expect(s.seen.map((x) => [x.job.resultId, x.latencyMs])).toEqual([
      [jobs[0]?.resultId, 300],
      [jobs[4]?.resultId, 500],
    ]);
  });

  it("a job blocked on its source does not hold back a later job on a free source", () => {
    const s = setup();
    s.dispatcher.enqueue([
      ...Array.from({ length: 5 }, () => job()),
      job({ sourceId: "nationalSource" }),
    ]);
    expect(s.calls.map((c) => c.req.sourceId)).toEqual([
      "stateSource",
      "stateSource",
      "stateSource",
      "stateSource",
      "nationalSource",
    ]);
  });

  it("a queued job is timedOut at its own deadline, no adapter call, while its source stays full", async () => {
    const s = setup();
    const running = Array.from({ length: 4 }, () => job({ deadline: T0 + 1_000 }));
    const late = job({ deadline: T0 + 100 });
    s.dispatcher.enqueue([...running, late]);
    await s.time.advance(99);
    expect(s.seen).toEqual([]);
    await s.time.advance(1);
    expect(s.calls).toHaveLength(4);
    expect(s.seen).toEqual([{ job: late, outcome: { status: "timedOut" }, latencyMs: 100 }]);
    expect(s.dispatcher.inFlight()).toBe(4);
    // Only the four running deadline timers remain: the queued job's timer went with it.
    expect(s.time.timerCount()).toBe(4);
  });

  it("a queued job that starts before its deadline leaves no queue timer behind", async () => {
    const s = setup();
    const jobs = Array.from({ length: 5 }, () => job({ deadline: T0 + 1_000 }));
    s.dispatcher.enqueue(jobs);
    expect(s.time.timerCount()).toBe(5);
    s.calls[0]?.resolve(PAYLOAD);
    await s.time.advance(0);
    expect(s.calls).toHaveLength(5);
    expect(s.time.timerCount()).toBe(4);
    await s.time.advance(1_000);
    expect(s.seen.map((x) => x.outcome.status)).toEqual([
      "returned",
      "timedOut",
      "timedOut",
      "timedOut",
      "timedOut",
    ]);
    expect(s.time.timerCount()).toBe(0);
  });

  it("a credentialsMissing job behind a full source settles without waiting for a slot", async () => {
    const s = setup();
    const missing = job({ requiresCredentials: true });
    s.dispatcher.enqueue([...Array.from({ length: 4 }, () => job()), missing]);
    await s.time.advance(0);
    expect(s.seen.map((x) => x.job)).toEqual([missing]);
  });
});

describe("createDispatcher in-flight, drain and shutdown (spec 5.2, 11)", () => {
  it("inFlight counts a job until its onOutcome promise resolves", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const s = setup({ onOutcome: () => gate });
    s.dispatcher.enqueue([job()]);
    s.calls[0]?.resolve(PAYLOAD);
    await s.time.advance(0);
    expect(s.seen).toHaveLength(1);
    expect(s.dispatcher.inFlight()).toBe(1);
    release();
    await s.time.advance(0);
    expect(s.dispatcher.inFlight()).toBe(0);
  });

  it("an onOutcome rejection is logged with ids and the error class only, and leaves in-flight", async () => {
    const s = setup({
      onOutcome: async () => {
        throw new TypeError(`write failed ${PLATE}`);
      },
    });
    const j = job();
    s.dispatcher.enqueue([j]);
    s.calls[0]?.resolve(PAYLOAD);
    await s.time.advance(0);
    expect(s.dispatcher.inFlight()).toBe(0);
    expect(s.logger.entries).toEqual([
      {
        level: "error",
        msg: "dispatch outcome failed",
        f: { resultId: j.resultId, sourceId: "stateSource", error: { name: "TypeError" } },
      },
    ]);
  });

  it("maxDeadline reports the latest in-flight deadline, null when idle", async () => {
    const s = setup();
    expect(s.dispatcher.maxDeadline()).toBeNull();
    s.dispatcher.enqueue([
      job({ deadline: T0 + 3_000 }),
      job({ deadline: T0 + 7_000 }),
      job({ deadline: T0 + 5_000 }),
    ]);
    expect(s.dispatcher.maxDeadline()).toBe(T0 + 7_000);
    await s.time.advance(7_000);
    expect(s.dispatcher.maxDeadline()).toBeNull();
  });

  it("drain(1000) resolves at once when idle", async () => {
    const s = setup();
    let done = false;
    const p = s.dispatcher.drain(1_000).then(() => {
      done = true;
    });
    await s.time.advance(0);
    await p;
    expect(done).toBe(true);
    expect(s.time.timerCount()).toBe(0);
  });

  it("drain(1000) resolves when the last job settles, clearing its bound timer", async () => {
    const s = setup();
    s.dispatcher.enqueue([job()]);
    let done = false;
    void s.dispatcher.drain(1_000).then(() => {
      done = true;
    });
    await s.time.advance(500);
    expect(done).toBe(false);
    s.calls[0]?.resolve(PAYLOAD);
    await s.time.advance(0);
    expect(done).toBe(true);
    expect(s.time.timerCount()).toBe(0);
  });

  it("drain(1000) resolves at the bound while a job is still running", async () => {
    const s = setup();
    s.dispatcher.enqueue([job()]);
    let done = false;
    void s.dispatcher.drain(1_000).then(() => {
      done = true;
    });
    await s.time.advance(999);
    expect(done).toBe(false);
    await s.time.advance(1);
    expect(done).toBe(true);
    expect(s.dispatcher.inFlight()).toBe(1);
  });

  it("after stopIntake enqueue refuses: no adapter call, nothing in flight, one log line", async () => {
    const s = setup();
    s.dispatcher.stopIntake();
    s.dispatcher.enqueue([job(), job()]);
    await s.time.advance(0);
    expect(s.calls).toHaveLength(0);
    expect(s.seen).toHaveLength(0);
    expect(s.dispatcher.inFlight()).toBe(0);
    expect(s.logger.entries).toEqual([
      { level: "warn", msg: "dispatch enqueue refused", f: { count: 2 } },
    ]);
  });

  it("a job already running when intake stops still settles", async () => {
    const s = setup();
    s.dispatcher.enqueue([job()]);
    s.dispatcher.stopIntake();
    s.calls[0]?.resolve(PAYLOAD);
    await s.time.advance(0);
    expect(s.seen.map((x) => x.outcome.status)).toEqual(["returned"]);
  });

  it("abortAll aborts every running signal, starts no queued job and reports no outcome", async () => {
    const s = setup();
    s.dispatcher.enqueue(Array.from({ length: 6 }, () => job()));
    expect(s.calls).toHaveLength(4);
    s.dispatcher.abortAll();
    expect(s.calls.every((c) => c.signal.aborted)).toBe(true);
    expect(s.dispatcher.inFlight()).toBe(0);
    expect(s.time.timerCount()).toBe(0);
    for (const c of s.calls) c.reject(new DOMException("aborted", "AbortError"));
    await s.time.advance(20_000);
    expect(s.calls).toHaveLength(4);
    expect(s.seen).toEqual([]);
    expect(s.logger.entries).toEqual([]);
  });

  it("after abortAll enqueue refuses and no new adapter call starts", async () => {
    const s = setup();
    s.dispatcher.abortAll();
    s.dispatcher.enqueue([job()]);
    await s.time.advance(0);
    expect(s.calls).toHaveLength(0);
    expect(s.dispatcher.inFlight()).toBe(0);
    expect(s.logger.entries).toEqual([
      { level: "warn", msg: "dispatch enqueue refused", f: { count: 1 } },
    ]);
  });

  it("an outcome reported before abortAll still counts until its onOutcome resolves", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const s = setup({ onOutcome: () => gate });
    s.dispatcher.enqueue([job()]);
    s.calls[0]?.resolve(PAYLOAD);
    await s.time.advance(0);
    s.dispatcher.abortAll();
    expect(s.dispatcher.inFlight()).toBe(1);
    release();
    await s.time.advance(0);
    expect(s.dispatcher.inFlight()).toBe(0);
  });
});
