import type { SocketLike } from "../heartbeat/heartbeat-probe";

/**
 * A scriptable SocketLike for client tests: the test plays the server by calling open(),
 * receive() and serverClose(). Frames the client sends are recorded in `sent`.
 */
export class FakeSocket implements SocketLike {
  sent: string[] = [];
  /** Every code passed to close(), in order; empty until the client closes the socket. */
  closeCodes: (number | undefined)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  /** Make the next send() throw, as a browser socket does when it is not open. */
  throwOnSend = false;

  constructor(readonly url = "ws://api.test/api/v1/ws") {}

  get closed(): boolean {
    return this.closeCodes.length > 0;
  }

  send(data: string): void {
    if (this.throwOnSend) throw new Error("socket is not open");
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closeCodes.push(code);
  }

  /** The frames the client sent, parsed. */
  sentMessages(): { type: string; [key: string]: unknown }[] {
    return this.sent.map((frame) => JSON.parse(frame) as { type: string });
  }

  open(): void {
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  receiveRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  serverClose(code = 1006): void {
    this.onclose?.({ code });
  }
}
