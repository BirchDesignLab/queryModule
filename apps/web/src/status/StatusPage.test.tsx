import type { SocketLike } from "@querymodule/client";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { autoHeartbeatSocket, FakeSocket } from "../test/fake-socket.js";
import { TEST_PASSWORD, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";
import { heartbeatUrl } from "./StatusPage.js";

async function openStatus(createSocket: (url: string) => SocketLike) {
  const t = renderRoot({ createSocket });
  await t.user.type(await screen.findByLabelText(/Email/), TEST_USER.email);
  await t.user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
  await t.user.click(screen.getByRole("button", { name: "Sign in" }));
  await t.user.click(await screen.findByRole("link", { name: "Status" }));
  return t;
}

describe("NFR-003 authenticated heartbeat on the status page (spec 5.3, 6.8, 9.3)", () => {
  it("reports connected and announces it", async () => {
    const urls: string[] = [];
    const factory = autoHeartbeatSocket();
    await openStatus((url) => {
      urls.push(url);
      return factory(url);
    });
    expect(
      await screen.findByText(/^Connected\. Heartbeat round trip/, { selector: "#status-text" }),
    ).toBeInTheDocument();
    expect(urls).toEqual(["ws://localhost:3000/api/v1/ws"]);
    expect(screen.getByTestId("announcer-polite")).toHaveTextContent("Connected");
  });
  it("reports a closed connection", async () => {
    await openStatus(() => {
      const socket: SocketLike = {
        send: () => undefined,
        close: () => undefined,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
      queueMicrotask(() => socket.onclose?.());
      return socket;
    });
    expect(
      await screen.findByText("Connection failed: the server closed the connection", {
        selector: "#status-text",
      }),
    ).toBeInTheDocument();
  });
  it("T23 carry-forward: closes the socket via the ResetController when a probe is pending", async () => {
    let socket: FakeSocket | null = null;
    const t = await openStatus((url) => {
      socket = new FakeSocket();
      void url;
      return socket;
    });
    expect(await screen.findByRole("heading", { name: "Connection status" })).toBeInTheDocument();
    expect(socket).not.toBeNull();
    t.services.reset.resetAll();
    expect((socket as unknown as FakeSocket).closed).toBe(true);
  });
  it("derives ws or wss from the page protocol", () => {
    expect(heartbeatUrl({ protocol: "https:", host: "querymodule.birchdesignlab.com" })).toBe(
      "wss://querymodule.birchdesignlab.com/api/v1/ws",
    );
    expect(heartbeatUrl({ protocol: "http:", host: "localhost:3000" })).toBe(
      "ws://localhost:3000/api/v1/ws",
    );
  });
});
