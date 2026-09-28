import type { WsEvent } from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "../src/events/bus";

const ev = {
  v: 1,
  type: "sourceStatus",
  seq: 1,
  at: 1,
  correlationId: "0190a000-0000-7000-8000-000000000001",
  partId: 0,
  sourceId: "s",
  resultId: "0190a000-0000-7000-8000-000000000002",
  status: "returned",
} as WsEvent;

describe("EventBus", () => {
  it("delivers per user only and unsubscribes", () => {
    const bus = createEventBus();
    const a = vi.fn();
    const b = vi.fn();
    const offA = bus.subscribe("A", a);
    bus.subscribe("B", b);
    bus.publish("B", ev);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(ev);
    offA();
    bus.publish("A", ev);
    expect(a).not.toHaveBeenCalled();
  });
  it("endSession fires each handler once", () => {
    const bus = createEventBus();
    const h = vi.fn();
    bus.onSessionEnded("s1", h);
    bus.endSession("s1");
    bus.endSession("s1");
    expect(h).toHaveBeenCalledTimes(1);
  });
});
