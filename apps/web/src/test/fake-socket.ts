import type { SocketLike } from "@querymodule/client";

export class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
    const message = JSON.parse(data) as { type: string; nonce?: string };
    queueMicrotask(() => {
      if (message.type === "hello")
        this.onmessage?.({ data: JSON.stringify({ v: 1, type: "welcome", latestSeq: 0 }) });
      if (message.type === "ping")
        this.onmessage?.({
          data: JSON.stringify({ v: 1, type: "pong", nonce: message.nonce, serverTime: 1 }),
        });
    });
  }
  close(): void {
    this.closed = true;
  }
}

/** A socket that opens on the next tick and answers hello and ping like the Track A heartbeat. */
export function autoHeartbeatSocket(): (url: string) => SocketLike {
  return () => {
    const socket = new FakeSocket();
    queueMicrotask(() => socket.onopen?.());
    return socket;
  };
}
