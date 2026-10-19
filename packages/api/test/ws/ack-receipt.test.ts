import { WS_PROTOCOL_VERSION } from "@querymodule/core/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { barrier, closeServers, sendHello, setupDispatchApp } from "../helpers/ws-replay";

// D-M2P2-4, NFR-004, spec 4.7: ackReceipt is a metric, not audit. One log line per owned,
// not-yet-counted correlation id; e2eMs is server clock only (the frame's receivedAt is unused).
afterEach(closeServers);

const receipt = (correlationId: string, receivedAt = 1) =>
  JSON.stringify({ v: WS_PROTOCOL_VERSION, type: "ackReceipt", correlationId, receivedAt });
const metrics = (lines: string[]) =>
  lines
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.msg === "metric ackReceipt");

// Positive control: after a negative receipt, an owned receipt on the same socket is counted;
// once its line is visible, any late line from the negative receipt would already be there too.
const expectOnlyControl = async (
  c: Awaited<ReturnType<typeof setupDispatchApp>>,
  ws: { send: (s: string) => void },
  controlId: string,
  already: number,
) => {
  ws.send(receipt(controlId));
  await vi.waitFor(() => expect(metrics(c.t.logLines)).toHaveLength(already + 1));
  const all = metrics(c.t.logLines);
  expect(all.at(-1)?.correlationId).toBe(controlId);
  expect(all).toHaveLength(already + 1);
};

describe("ackReceipt metric (NFR-004, D-M2P2-4)", () => {
  it("an owned receipt logs once with e2eMs from the server clock; a repeat logs nothing", async () => {
    const c = await setupDispatchApp();
    const { correlationId } = await c.submit(c.cookieA, "ZZ-0001");
    const a = await c.sock(c.cookieA);
    sendHello(a.ws, null);
    await barrier(a.ws, a.got);
    c.time.clock.advance(1234);
    a.ws.send(receipt(correlationId, 999_999_999_999));
    await vi.waitFor(() => expect(metrics(c.t.logLines)).toHaveLength(1));
    const first = metrics(c.t.logLines);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      level: "info",
      msg: "metric ackReceipt",
      correlationId,
      e2eMs: 1234,
    });
    expect(Object.keys(first[0] ?? {}).sort()).toEqual([
      "correlationId",
      "e2eMs",
      "level",
      "msg",
      "time",
    ]);
    c.time.clock.advance(50);
    a.ws.send(receipt(correlationId));
    const control = await c.submit(c.cookieA, "ZZ-0001");
    await expectOnlyControl(c, a.ws, control.correlationId, 1);
    expect(metrics(c.t.logLines).filter((l) => l.correlationId === correlationId)).toHaveLength(1);
    expect(a.got.map((m) => m.type)).not.toContain("error");
    a.ws.close();
  });

  it("another user's correlation id logs nothing and gets no frame", async () => {
    const c = await setupDispatchApp();
    const { correlationId } = await c.submit(c.cookieA, "ZZ-0001");
    const control = await c.submit(c.cookieB, "ZZ-0001");
    const b = await c.sock(c.cookieB);
    sendHello(b.ws, null);
    await barrier(b.ws, b.got);
    const before = b.got.length;
    b.ws.send(receipt(correlationId));
    await barrier(b.ws, b.got);
    expect(b.got.slice(before).map((m) => m.type)).toEqual(["pong"]);
    await expectOnlyControl(c, b.ws, control.correlationId, 0);
    expect(c.t.logLines.join("\n")).not.toContain(correlationId);
    b.ws.close();
  });

  it("an unknown correlation id logs nothing", async () => {
    const c = await setupDispatchApp();
    const control = await c.submit(c.cookieA, "ZZ-0001");
    const a = await c.sock(c.cookieA);
    sendHello(a.ws, null);
    await barrier(a.ws, a.got);
    a.ws.send(receipt("01900000-0000-7000-8000-000000000000"));
    await expectOnlyControl(c, a.ws, control.correlationId, 0);
    expect(c.t.logLines.join("\n")).not.toContain("01900000-0000-7000-8000-000000000000");
    a.ws.close();
  });

  it("a receipt before hello is ignored, and counts later once hello is sent", async () => {
    const c = await setupDispatchApp();
    const { correlationId } = await c.submit(c.cookieA, "ZZ-0001");
    const a = await c.sock(c.cookieA);
    a.ws.send(receipt(correlationId));
    // ping is answered in order after the receipt frame was handled
    await barrier(a.ws, a.got);
    expect(metrics(c.t.logLines)).toHaveLength(0);
    sendHello(a.ws, null);
    a.ws.send(receipt(correlationId));
    await vi.waitFor(() => expect(metrics(c.t.logLines)).toHaveLength(1));
    a.ws.close();
  });
});
