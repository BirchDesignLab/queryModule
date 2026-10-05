import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserSocket } from "./browser-socket.js";

class StubWebSocket {
  static last: StubWebSocket | null = null;
  closed: number | undefined;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    StubWebSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closed = code;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("FR-065 browser socket adapter (spec 6.8)", () => {
  it("passes the close code through so the feed can tell a session end (4001) apart", () => {
    vi.stubGlobal("WebSocket", StubWebSocket);
    const socket = createBrowserSocket("ws://api.test/api/v1/ws");
    const onclose = vi.fn();
    socket.onclose = onclose;
    StubWebSocket.last?.onclose?.({ code: 4001 });
    expect(onclose).toHaveBeenCalledExactlyOnceWith({ code: 4001 });
  });

  it("forwards open, message, error, send and close", () => {
    vi.stubGlobal("WebSocket", StubWebSocket);
    const socket = createBrowserSocket("ws://api.test/api/v1/ws");
    const onopen = vi.fn();
    const onmessage = vi.fn();
    const onerror = vi.fn();
    socket.onopen = onopen;
    socket.onmessage = onmessage;
    socket.onerror = onerror;
    StubWebSocket.last?.onopen?.();
    StubWebSocket.last?.onmessage?.({ data: "frame" });
    StubWebSocket.last?.onerror?.();
    socket.send("hello");
    socket.close(1000);
    expect(onopen).toHaveBeenCalledTimes(1);
    expect(onmessage).toHaveBeenCalledExactlyOnceWith({ data: "frame" });
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(StubWebSocket.last?.sent).toEqual(["hello"]);
    expect(StubWebSocket.last?.closed).toBe(1000);
  });
});
