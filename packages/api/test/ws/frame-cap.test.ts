import { WS_PROTOCOL_VERSION } from "@querymodule/core/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WS_CLIENT_FRAME_LIMIT } from "../../src/ws/limits";
import { WS_LOCAL_CLOSE } from "../../src/ws/server";
import { barrier, closeServers, sendHello, setupDispatchApp } from "../helpers/ws-replay";

// AW4 C1 (M2 Manager 8 ruling, 10-18-26): every client frame (hello, ping, ackReceipt) spends one
// unit of a per-socket budget; past WS_CLIENT_FRAME_LIMIT in one window the socket is closed with
// WS_LOCAL_CLOSE.frameLimit and one log line that carries no frame value.
afterEach(closeServers);

const UNKNOWN_ID = "01900000-0000-7000-8000-0000000000aa";
const receipt = (correlationId: string) =>
  JSON.stringify({ v: WS_PROTOCOL_VERSION, type: "ackReceipt", correlationId, receivedAt: 1 });
const closed = (ws: { once: (e: "close", f: (code: number) => void) => void }) =>
  new Promise<number>((res) => ws.once("close", (code) => res(code)));
const capLines = (lines: string[]) =>
  lines
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.msg === "ws client frame limit exceeded");

describe("per-socket client frame cap (AW4 C1)", () => {
  it("a flood past the limit closes the socket with frameLimit and logs one line with no value", async () => {
    const c = await setupDispatchApp();
    const a = await c.sock(c.cookieA);
    const done = closed(a.ws);
    sendHello(a.ws, null);
    // hello is frame 1; limit more frames take the socket one past the budget.
    for (let i = 0; i < WS_CLIENT_FRAME_LIMIT.limit; i++) a.ws.send(receipt(UNKNOWN_ID));
    expect(await done).toBe(WS_LOCAL_CLOSE.frameLimit);
    await vi.waitFor(() => expect(capLines(c.t.logLines)).toHaveLength(1));
    const [line] = capLines(c.t.logLines);
    expect(Object.keys(line ?? {}).sort()).toEqual(["level", "msg", "sessionId", "time"]);
    expect(c.t.logLines.join("\n")).not.toContain(UNKNOWN_ID);
  });

  it("frames up to the limit in one window keep the socket open", async () => {
    const c = await setupDispatchApp();
    const a = await c.sock(c.cookieA);
    sendHello(a.ws, null);
    // hello plus limit - 2 receipts plus the barrier's ping is exactly the limit.
    for (let i = 0; i < WS_CLIENT_FRAME_LIMIT.limit - 2; i++) a.ws.send(receipt(UNKNOWN_ID));
    await barrier(a.ws, a.got);
    expect(a.ws.readyState).toBe(a.ws.OPEN);
    expect(capLines(c.t.logLines)).toHaveLength(0);
    a.ws.close();
  });

  it("the budget refills when the window passes", async () => {
    const c = await setupDispatchApp();
    const a = await c.sock(c.cookieA);
    sendHello(a.ws, null);
    for (let i = 0; i < WS_CLIENT_FRAME_LIMIT.limit - 2; i++) a.ws.send(receipt(UNKNOWN_ID));
    await barrier(a.ws, a.got);
    c.time.clock.advance(WS_CLIENT_FRAME_LIMIT.windowMs);
    for (let i = 0; i < WS_CLIENT_FRAME_LIMIT.limit - 1; i++) a.ws.send(receipt(UNKNOWN_ID));
    await barrier(a.ws, a.got);
    expect(a.ws.readyState).toBe(a.ws.OPEN);
    expect(capLines(c.t.logLines)).toHaveLength(0);
    a.ws.close();
  });

  it("the window runs on the monotonic clock: a backward wall-clock step still refills it (G-G-m1)", async () => {
    const c = await setupDispatchApp();
    const a = await c.sock(c.cookieA);
    sendHello(a.ws, null);
    for (let i = 0; i < WS_CLIENT_FRAME_LIMIT.limit - 2; i++) a.ws.send(receipt(UNKNOWN_ID));
    await barrier(a.ws, a.got);
    // The wall clock steps back an hour (an NTP correction); monotonic time keeps going.
    const wall = c.t.deps.clock.now;
    c.t.deps.clock.now = () => wall() - 3_600_000;
    c.time.clock.advance(WS_CLIENT_FRAME_LIMIT.windowMs);
    for (let i = 0; i < WS_CLIENT_FRAME_LIMIT.limit - 1; i++) a.ws.send(receipt(UNKNOWN_ID));
    await barrier(a.ws, a.got);
    expect(a.ws.readyState).toBe(a.ws.OPEN);
    expect(capLines(c.t.logLines)).toHaveLength(0);
    a.ws.close();
  });
});
