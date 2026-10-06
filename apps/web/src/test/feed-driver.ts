import type { SocketLike } from "@querymodule/client";
import { FakeSocket } from "./fake-socket.js";

/** The ids the canned 202 (`ACK_202` in msw-server) is acknowledged under. */
export const ACK_CORRELATION_ID = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const RESULT_ID = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

/**
 * A feed socket tests can push `sourceStatus` events through, as the server would after a submit.
 * It opens on the next tick and answers hello and ping like the Track A feed.
 */
export class FeedDriver {
  private socket: FakeSocket | null = null;
  private seq = 0;
  readonly createSocket = (): SocketLike => {
    const socket = new FakeSocket();
    this.socket = socket;
    queueMicrotask(() => socket.onopen?.());
    return socket;
  };
  /** Delivers one `sourceStatus` event (status only; ids from the canned 202). */
  status(sourceId: string, status: string, partId = 1, correlationId = ACK_CORRELATION_ID): void {
    this.seq += 1;
    this.socket?.onmessage?.({
      data: JSON.stringify({
        v: 1,
        type: "sourceStatus",
        seq: this.seq,
        at: Date.now(),
        correlationId,
        partId,
        sourceId,
        resultId: RESULT_ID,
        status,
      }),
    });
  }
  get opened(): boolean {
    return this.socket !== null;
  }
}
