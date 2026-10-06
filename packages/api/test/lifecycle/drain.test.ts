import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { type SourcePayload, SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import WebSocket from "ws";
import type { SourceAdapter } from "../../src/adapters/types";
import { createDispatcher } from "../../src/dispatch/dispatcher";
import { createDrainStop, DRAIN_SLACK_MS, HTTP_DRAIN_MS } from "../../src/startup";
import { attachWebSocket } from "../../src/ws/server";
import { manualTime, settle } from "../helpers/manual-time";
import { createTestApp } from "../helpers/test-app";

// Spec 5.2 SIGTERM drain (NFR-003; spec 8.3, 10.4): the stop sequence refuses new submits with
// 503 unavailable and new WebSocket upgrades, lets a submit already in flight finish T1 and
// enqueue, waits for in-flight dispatch up to max(0, maxDeadline - now) + 5 s, then closes the
// sockets and the DB. Time is manual: no real sleeps. Mock data only (spec 5.4, 10.8).
const EMAIL = "drain@example.test";
const PW = "correct-horse-battery-1";
const LATENCY_MS = 2_000;
const TIMEOUT_MS = 10_000;
const PAYLOAD = { status: "NO RECORD" } as unknown as SourcePayload;

type Time = ReturnType<typeof manualTime>;

async function setup(o: { adapter: (time: Time) => SourceAdapter; hungOutcome?: boolean }) {
  const time = manualTime();
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
    random: () => 0,
  });
  await t.createUser(EMAIL, PW);
  const cookie = await t.cookieFor(EMAIL, PW);
  const { configHash } = t.deps.config.current();
  vi.spyOn(t.deps.adapters, "get").mockReturnValue(o.adapter(time));
  if (o.hungOutcome) {
    // a T2 stub that never resolves
    t.deps.dispatcher = createDispatcher(
      {
        adapters: t.deps.adapters,
        clock: t.deps.clock,
        monotonic: t.deps.monotonic,
        timers: t.deps.timers,
        logger: t.deps.logger,
      },
      () => new Promise<void>(() => {}),
    );
    const hung = t.deps.dispatcher;
    onTestFinished(() => hung.abortAll());
  }
  const server = serve({ fetch: t.app.fetch, port: 0, hostname: "127.0.0.1" }) as Server;
  if (!server.listening) await once(server, "listening");
  onTestFinished(() => {
    if (server.listening) server.close();
    server.closeAllConnections();
  });
  const ws = attachWebSocket(server, t.deps);
  const port = (server.address() as AddressInfo).port;
  // stop()'s DB close is recorded, not done, so the rows can be read after it; the real close
  // runs when the test finishes.
  const dbClosed: { inFlight: number }[] = [];
  vi.spyOn(t.deps.db.$client, "close").mockImplementationOnce(() => {
    dbClosed.push({ inFlight: t.deps.dispatcher.inFlight() });
  });
  const stop = createDrainStop(t.deps, server, ws);
  let stopped = false;
  const startStop = () =>
    stop().then(() => {
      stopped = true;
    });
  const body = (key: string) => ({
    method: "POST",
    headers: {
      origin: t.env.publicOrigin,
      cookie,
      "content-type": "application/json",
      "x-requested-with": "querymodule",
      "idempotency-key": key,
    },
    body: JSON.stringify({
      queryType: "VEH",
      values: { plate: "ZZ-0001", state: "TX" },
      sourceIds: ["stateSource"],
      mode: "normal",
      configHash,
    }),
  });
  const submit = (key = crypto.randomUUID()) => t.request("/api/v1/queries", body(key));
  const submitHttp = (key = crypto.randomUUID()) =>
    fetch(`http://127.0.0.1:${port}/api/v1/queries`, body(key));
  const statuses = async () =>
    (
      await t.deps.db.$client.execute(
        "SELECT status FROM source_result ORDER BY correlation_id, source_id",
      )
    ).rows.map((r) => String(r.status));
  const requestRows = async () =>
    Number((await t.deps.db.$client.execute("SELECT count(*) AS n FROM query_request")).rows[0]?.n);
  const openWs = () =>
    new Promise<WebSocket>((res, rej) => {
      const s = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws`, {
        headers: { origin: t.env.publicOrigin, cookie },
      });
      s.once("open", () => res(s));
      s.once("unexpected-response", (_q, r) => rej(new Error(`HTTP ${r.statusCode}`)));
      s.once("error", rej);
    });
  return {
    t,
    time,
    submit,
    submitHttp,
    statuses,
    requestRows,
    openWs,
    startStop,
    stopped: () => stopped,
    dbClosed,
  };
}

const slowAdapter = (time: Time): SourceAdapter => ({
  query: (_req, _creds, signal) => time.timers.sleep(LATENCY_MS, signal).then(() => PAYLOAD),
});

describe("SIGTERM drain (spec 5.2, NFR-003)", () => {
  it("a 2 s job in flight: new submit 503, WS refused, replay 202, job returned before the DB closes", async () => {
    const s = await setup({ adapter: slowAdapter });
    const key = crypto.randomUUID();
    const first = await s.submit(key);
    expect(first.status).toBe(202);
    const ack = SubmitQueryResponseSchema.parse(await first.json());
    expect(s.t.deps.dispatcher.inFlight()).toBe(1);
    const feed = await s.openWs();
    const feedClosed = new Promise<number>((r) => feed.once("close", (code) => r(code)));

    const stopping = s.startStop();
    await settle();
    expect(s.t.deps.lifecycle.draining).toBe(true);
    const rowsBefore = await s.requestRows();
    const late = await s.submit();
    expect(late.status).toBe(503);
    expect(((await late.json()) as { error: { code: string } }).error.code).toBe("unavailable");
    expect(await s.requestRows()).toBe(rowsBefore);
    await expect(s.openWs()).rejects.toThrow();
    const replay = await s.submit(key);
    expect(replay.status).toBe(202);
    expect(SubmitQueryResponseSchema.parse(await replay.json()).correlationId).toBe(
      ack.correlationId,
    );
    expect(s.stopped()).toBe(false);

    await s.time.run(LATENCY_MS);
    await stopping;
    expect(s.dbClosed).toEqual([{ inFlight: 0 }]);
    expect(await s.statuses()).toEqual(["returned"]);
    expect(await feedClosed).toBe(1001);
    expect(s.t.fatals).toEqual([]);
    expect(s.t.logLines.some((l) => l.includes('"msg":"stopped"'))).toBe(true);
  }, 20_000);

  it("a never-settling adapter: the row is timedOut at its deadline and stop() resolves then", async () => {
    const s = await setup({
      adapter: () => ({ query: () => new Promise<SourcePayload>(() => {}) }),
    });
    expect((await s.submit()).status).toBe(202);
    const t0 = s.time.clock.now();
    const stopping = s.startStop();
    await s.time.run(TIMEOUT_MS - 1);
    expect(s.stopped()).toBe(false);
    await s.time.run(1);
    await vi.waitFor(() => expect(s.stopped()).toBe(true));
    await stopping;
    // resolved at the deadline, not at the bound (deadline + 5 s)
    expect(s.time.clock.now() - t0).toBe(TIMEOUT_MS);
    expect(s.dbClosed).toEqual([{ inFlight: 0 }]);
    expect(await s.statuses()).toEqual(["timedOut"]);
    expect(s.t.fatals).toEqual([]);
  }, 20_000);

  it("a hung onOutcome: stop() resolves at the bound and the row stays pending", async () => {
    const s = await setup({ adapter: slowAdapter, hungOutcome: true });
    expect((await s.submit()).status).toBe(202);
    const stopping = s.startStop();
    // bound = (deadline - now) + 5 s = 15 s from the stop
    await s.time.run(TIMEOUT_MS + 5_000 - 1);
    expect(s.stopped()).toBe(false);
    await s.time.run(1);
    await vi.waitFor(() => expect(s.stopped()).toBe(true));
    await stopping;
    expect(s.dbClosed).toEqual([{ inFlight: 1 }]);
    expect(await s.statuses()).toEqual(["pending"]);
  }, 20_000);

  it("a submit in flight when stop() starts is acknowledged and its outcome lands before the DB closes", async () => {
    const s = await setup({ adapter: slowAdapter });
    // hold the submit inside T1, past the 503 check
    const record = s.t.deps.audit.record.bind(s.t.deps.audit);
    let reached: () => void = () => {};
    const atGate = new Promise<void>((r) => {
      reached = r;
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    s.t.deps.audit.record = async (tx, event) => {
      if (event.type === "submitted") {
        reached();
        await gate;
      }
      return record(tx, event);
    };
    const inFlight = s.submitHttp();
    await atGate;
    const stopping = s.startStop();
    await settle();
    expect(s.t.deps.lifecycle.draining).toBe(true);
    expect(s.t.deps.dispatcher.inFlight()).toBe(0);
    release();
    const r = await inFlight;
    expect(r.status).toBe(202);
    await vi.waitFor(() => expect(s.t.deps.dispatcher.inFlight()).toBe(1));
    expect(s.stopped()).toBe(false);
    await s.time.run(LATENCY_MS);
    await stopping;
    expect(s.dbClosed).toEqual([{ inFlight: 0 }]);
    expect(await s.statuses()).toEqual(["returned"]);
    expect(s.t.fatals).toEqual([]);
  }, 20_000);

  it("a held, unfinished request does not keep stop() past the HTTP bound; its late enqueue is not fatal", async () => {
    const s = await setup({ adapter: slowAdapter });
    // hold the submit inside T1, past the 503 check, for longer than the HTTP bound
    const record = s.t.deps.audit.record.bind(s.t.deps.audit);
    let reached: () => void = () => {};
    const atGate = new Promise<void>((r) => {
      reached = r;
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    s.t.deps.audit.record = async (tx, event) => {
      if (event.type === "submitted") {
        reached();
        await gate;
      }
      return record(tx, event);
    };
    const held = s.submitHttp().then(
      (r) => r.status,
      () => "cut off",
    );
    await atGate;
    const stopping = s.startStop();
    await s.time.run(HTTP_DRAIN_MS - 1);
    expect(s.stopped()).toBe(false);
    // at the HTTP bound the connection is cut; nothing is in flight in dispatch, so stop() ends
    // after the slack at most
    await s.time.run(1 + DRAIN_SLACK_MS);
    await vi.waitFor(() => expect(s.stopped()).toBe(true));
    await stopping;
    expect(await held).toBe("cut off");
    expect(s.t.logLines.some((l) => l.includes('"msg":"drain http wait timed out"'))).toBe(true);
    // the cut-off handler commits T1 after stopIntake: its rows stay pending for the next start's
    // sweep, without d.fatal (the drain exits 0)
    release();
    await vi.waitFor(() =>
      expect(s.t.logLines.some((l) => l.includes('"msg":"dispatch refused during drain"'))).toBe(
        true,
      ),
    );
    const line = s.t.logLines.find((l) => l.includes('"msg":"dispatch refused during drain"'));
    expect(line).not.toContain("ZZ-0001");
    expect(s.t.fatals).toEqual([]);
    expect(await s.statuses()).toEqual(["pending"]);
  }, 20_000);
});

describe("an enqueue refused after T1 commits (manager ruling M1)", () => {
  it("is a post-commit failure: 202 stands, one error line with ids and class, d.fatal", async () => {
    const s = await setup({ adapter: slowAdapter });
    s.t.deps.dispatcher.stopIntake();
    const r = await s.submit();
    expect(r.status).toBe(202);
    const ack = SubmitQueryResponseSchema.parse(await r.json());
    expect(s.t.fatals).toHaveLength(1);
    const line = s.t.logLines.find((l) => l.includes('"msg":"dispatch jobs failed"'));
    expect(line).toContain(ack.correlationId);
    expect(line).toContain("DispatchRefusedError");
    expect(line).not.toContain("ZZ-0001");
    // the rows stay pending for the next start's sweep
    expect(await s.statuses()).toEqual(["pending"]);
  }, 20_000);
});

describe("a fatal error and the drain (AW4 critic 2; spec 5.2, 8.1: the fatal path never drains)", () => {
  it("a fatal during the drain ends it: stop() rejects, no stopped line", async () => {
    const s = await setup({ adapter: slowAdapter });
    expect((await s.submit()).status).toBe(202);
    const stopping = s.startStop();
    const outcome = stopping.then(
      () => "resolved",
      (e: unknown) => (e as Error).name,
    );
    await settle();
    s.t.deps.fatal(new Error("x"));
    expect(await outcome).toBe("DrainAbortedError");
    expect(s.t.fatals).toHaveLength(1);
    expect(s.t.logLines.some((l) => l.includes('"msg":"drain ended by fatal error"'))).toBe(true);
    expect(s.t.logLines.some((l) => l.includes('"msg":"stopped"'))).toBe(false);
  }, 20_000);

  it("SIGTERM after a fatal: stop() rejects at once and never starts draining", async () => {
    const s = await setup({ adapter: slowAdapter });
    s.t.deps.fatal(new Error("x"));
    await expect(s.startStop()).rejects.toThrow("drain: fatal close");
    expect(s.t.deps.lifecycle.draining).toBe(false);
    expect(s.t.logLines.some((l) => l.includes('"msg":"drain ended by fatal error"'))).toBe(true);
    expect(s.t.logLines.some((l) => l.includes('"msg":"stopped"'))).toBe(false);
  }, 20_000);

  it("after a fatal a new submit gets 503 unavailable before T1", async () => {
    const s = await setup({ adapter: slowAdapter });
    s.t.deps.fatal(new Error("x"));
    const r = await s.submit();
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("unavailable");
    expect(await s.requestRows()).toBe(0);
    expect(s.t.fatals).toHaveLength(1);
  }, 20_000);
});

describe("the drain's worst case (AW4 critic minor; spec 8.3)", () => {
  it("HTTP bound + the 18 s timeoutMs docs/deploy.md allows + slack stays <= 25 s, inside the 30 s stop_grace_period", () => {
    const DEPLOY_DOC_MAX_TIMEOUT_MS = 18_000;
    expect(HTTP_DRAIN_MS + DEPLOY_DOC_MAX_TIMEOUT_MS + DRAIN_SLACK_MS).toBeLessThanOrEqual(25_000);
  });
});
