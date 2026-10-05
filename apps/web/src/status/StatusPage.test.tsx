import type { SocketLike } from "@querymodule/client";
import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { autoHeartbeatSocket, FakeSocket } from "../test/fake-socket.js";
import { API, CLIENT_CONFIG, server, TEST_PASSWORD, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";
import { heartbeatUrl } from "./StatusPage.js";

async function openStatus(
  createSocket: (url: string) => SocketLike,
  beforeOpen?: (t: ReturnType<typeof renderRoot>) => void,
) {
  const t = renderRoot({ createSocket });
  // These tests count the heartbeat probe's sockets; the app's feed socket (AppShell) shares
  // createSocket, so keep it from opening here. The feed has its own tests (AppChrome.test.tsx).
  vi.spyOn(t.services.feed, "open").mockImplementation(() => undefined);
  beforeOpen?.(t);
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
    await waitFor(() =>
      expect(screen.getByTestId("announcer-polite")).toHaveTextContent(
        "Connected, configuration loaded",
      ),
    );
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
      queueMicrotask(() => socket.onclose?.({ code: 1006 }));
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
    expect(await screen.findByRole("heading", { name: "Status", level: 1 })).toBeInTheDocument();
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

const tile = (name: string) => {
  const heading = screen.getByRole("heading", { level: 2, name });
  const section = heading.closest("section");
  if (section === null) throw new Error(`no section for ${name}`);
  return within(section);
};

async function statusReady() {
  await screen.findByText(/^Connected\. Heartbeat round trip/, { selector: "#status-text" });
  await waitFor(() => expect(tile("Configuration").getByText("Loaded")).toBeInTheDocument());
}

describe("the status page: Connection, Configuration and Session tiles", () => {
  it("focuses the h1 on navigation and lays out three ruled sections with their own h2", async () => {
    await openStatus(autoHeartbeatSocket());
    const h1 = await screen.findByRole("heading", { level: 1, name: "Status" });
    expect(h1).toHaveFocus();
    await statusReady();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Connection",
      "Configuration",
      "Session",
    ]);
  });

  it("Connection: a Checking chip, then Connected with the last-checked time", async () => {
    await openStatus(autoHeartbeatSocket());
    await statusReady();
    const connection = tile("Connection");
    expect(connection.getByText("Connected", { selector: ".qm-badge" })).toHaveClass(
      "qm-badge--ok",
    );
    expect(connection.getByText(/^\d\d-\d\d-\d\d \d\d:\d\d:\d\d$/)).toBeInTheDocument();
    expect(connection.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });

  it("Connection: Failed uses the critical (error) badge and keeps the reason in the sentence", async () => {
    await openStatus(() => {
      const socket = new FakeSocket();
      queueMicrotask(() => socket.onclose?.({ code: 1006 }));
      return socket;
    });
    const failed = await screen.findByText("Failed", { selector: ".qm-badge" });
    expect(failed).toHaveClass("qm-badge--critical");
    expect(
      screen.getByText("Connection failed: the server closed the connection", {
        selector: "#status-text",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("announcer-polite")).toHaveTextContent(
        "Connection failed: the server closed the connection, configuration loaded",
      ),
    );
  });

  it("Configuration: the site, the 12-character version hash, the schema version and the last check", async () => {
    await openStatus(autoHeartbeatSocket());
    await statusReady();
    const config = tile("Configuration");
    expect(config.getByText(CLIENT_CONFIG.configHash.slice(0, 12))).toBeInTheDocument();
    expect(config.getByText(String(CLIENT_CONFIG.schemaVersion))).toBeInTheDocument();
    expect(config.getByText(/^\d\d-\d\d-\d\d \d\d:\d\d:\d\d$/)).toBeInTheDocument();
    expect(config.getByText("Loaded")).toHaveClass("qm-badge--ok");
  });

  it("Configuration: Unavailable, with no rows, when there is no config and the check fails", async () => {
    server.use(http.get(`${API}/api/v1/config`, () => new HttpResponse(null, { status: 500 })));
    await openStatus(autoHeartbeatSocket());
    const chip = await screen.findByText("Unavailable", { selector: ".qm-badge" });
    expect(chip).toHaveClass("qm-badge--critical");
    expect(tile("Configuration").queryByText("Version hash")).toBeNull();
    // The layout is not "Loading" for ever: it says what the configuration says.
    expect(tile("Session").getByText("Layout").closest("div")).toHaveTextContent("Unavailable");
    await waitFor(() =>
      expect(screen.getByTestId("announcer-polite")).toHaveTextContent(
        "Connected, configuration check failed",
      ),
    );
  });

  it("Session: email, role and layout; the layout reads Loading until the config is known, never Dispatch first", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      http.get(`${API}/api/v1/config`, async () => {
        await gate;
        return HttpResponse.json(CLIENT_CONFIG);
      }),
    );
    await openStatus(autoHeartbeatSocket());
    const session = tile("Session");
    expect(session.getByText(TEST_USER.email)).toBeInTheDocument();
    expect(session.getByText("User")).toBeInTheDocument();
    const layout = session.getByText("Layout").closest("div");
    expect(layout).toHaveTextContent("Loading");
    expect(layout).not.toHaveTextContent("Dispatch");
    expect(
      tile("Configuration").getByText("Loading", { selector: ".qm-badge" }),
    ).toBeInTheDocument();
    release();
    await waitFor(() => expect(layout).toHaveTextContent("Dispatch"));
  });

  it("Session: the officer layout reads Mobile unit and the page takes the officer density class", async () => {
    const t = await openStatus(autoHeartbeatSocket());
    await statusReady();
    act(() => t.services.preferences.getState().setPersonaOverride("mobileUnit"));
    await waitFor(() => expect(tile("Session").getByText("Mobile unit")).toBeInTheDocument());
    expect(screen.getByRole("main")).toHaveClass("qm-layout--mobile-unit");
  });

  it("Check again: re-checks both, keeps focus on the button, and announces once per check", async () => {
    let sockets = 0;
    const factory = autoHeartbeatSocket();
    let configRequests = 0;
    server.use(
      http.get(`${API}/api/v1/config`, () => {
        configRequests += 1;
        return HttpResponse.json(CLIENT_CONFIG);
      }),
    );
    let announce: ReturnType<typeof vi.spyOn> | undefined;
    const t = await openStatus(
      (url) => {
        sockets += 1;
        return factory(url);
      },
      (r) => {
        announce = vi.spyOn(r.services.announcer, "announce");
      },
    );
    await statusReady();
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(1));
    const socketsBefore = sockets;
    const configBefore = configRequests;
    const button = tile("Connection").getByRole("button", { name: "Check again" });
    await t.user.click(button);
    expect(button).toHaveFocus();
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(2));
    expect(sockets).toBe(socketsBefore + 1);
    expect(configRequests).toBe(configBefore + 1);
    expect(button).toHaveFocus();
    expect(button).not.toHaveAttribute("aria-disabled", "true");
    expect(announce).toHaveBeenLastCalledWith("Connected, configuration loaded");
  });

  it("Check again: while a check runs the button is aria-disabled, focus stays, and a second press starts nothing", async () => {
    const sockets: FakeSocket[] = [];
    const t = await openStatus(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    await screen.findByRole("heading", { level: 1, name: "Status" });
    const button = tile("Connection").getByRole("button", { name: "Check again" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(tile("Connection").getByText("Checking", { selector: ".qm-badge" })).toBeInTheDocument();
    await t.user.click(button);
    expect(sockets).toHaveLength(1);
    expect(button).toHaveAttribute("aria-disabled", "true");
    // The press lands on the button (a click focuses it) and stays there.
    expect(button).toHaveFocus();
  });

  it("Check again: a failed config check keeps the loaded config, says so, and is part of the one announcement", async () => {
    let failConfig = false;
    server.use(
      http.get(`${API}/api/v1/config`, () =>
        failConfig ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(CLIENT_CONFIG),
      ),
    );
    const t = await openStatus(autoHeartbeatSocket());
    await statusReady();
    failConfig = true;
    await t.user.click(tile("Connection").getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(screen.getByTestId("announcer-polite")).toHaveTextContent(
        "Connected, configuration check failed",
      ),
    );
    const config = tile("Configuration");
    expect(config.getByText("Loaded")).toBeInTheDocument();
    expect(config.getByText("The last check failed.")).toBeInTheDocument();
    failConfig = false;
    await t.user.click(tile("Connection").getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(config.queryByText("The last check failed.")).toBeNull());
  });

  it("a reset during a check closes the socket, drops the late answers and announces nothing", async () => {
    // The socket answers hello but holds the pong; the config answer is held too, so both land after the reset.
    let socket: FakeSocket | null = null;
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let announce: ReturnType<typeof vi.spyOn> | undefined;
    let requests = 0;
    server.use(
      http.get(`${API}/api/v1/config`, async () => {
        requests += 1;
        // The shell's own prefetch answers at once; the status check's request is the second.
        if (requests > 1) await gate;
        return HttpResponse.json(CLIENT_CONFIG);
      }),
    );
    const t = await openStatus(
      () => {
        socket = new FakeSocket();
        socket.send = (data: string) => {
          const message = JSON.parse(data) as { type: string };
          if (message.type === "hello")
            queueMicrotask(() =>
              socket?.onmessage?.({
                data: JSON.stringify({ v: 1, type: "welcome", latestSeq: 0 }),
              }),
            );
        };
        queueMicrotask(() => socket?.onopen?.());
        return socket;
      },
      (r) => {
        announce = vi.spyOn(r.services.announcer, "announce");
      },
    );
    await screen.findByRole("heading", { level: 1, name: "Status" });
    await waitFor(() => expect(requests).toBeGreaterThan(1));
    act(() => t.services.reset.resetAll());
    expect((socket as unknown as FakeSocket).closed).toBe(true);
    // The late answers: the pong (the probe settles ok) and the config.
    await act(async () => {
      (socket as unknown as FakeSocket).onmessage?.({
        data: JSON.stringify({ v: 1, type: "pong", nonce: "x", serverTime: 1 }),
      });
      release();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(announce).not.toHaveBeenCalled();
    // The previous session's config is not written back into the cleared cache.
    expect(t.services.queryClient.getQueryData(["config"])).toBeUndefined();
  });

  it("a dropped check cancels the probe's 10 s timer", async () => {
    const timeouts = new Map<number, number>();
    const realSet = window.setTimeout.bind(window);
    const setSpy = vi.spyOn(window, "setTimeout").mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      const id = realSet(fn, ms) as unknown as number;
      if (ms === 10_000) timeouts.set(id, ms);
      return id;
    }) as typeof window.setTimeout);
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const t = await openStatus(() => new FakeSocket());
    await screen.findByRole("heading", { level: 1, name: "Status" });
    await waitFor(() => expect(timeouts.size).toBeGreaterThan(0));
    const [probeTimer] = [...timeouts.keys()].slice(-1);
    clearSpy.mockClear();
    act(() => t.services.reset.resetAll());
    expect(clearSpy).toHaveBeenCalledWith(probeTimer);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it("a socket that cannot be created is a failed check, not a stuck one", async () => {
    await openStatus(() => {
      throw new Error("SecurityError");
    });
    expect(await screen.findByText("Failed", { selector: ".qm-badge" })).toBeInTheDocument();
    expect(
      screen.getByText("Connection failed: network error", { selector: "#status-text" }),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Check again" });
    expect(button).not.toHaveAttribute("aria-disabled", "true");
    await waitFor(() =>
      expect(screen.getByTestId("announcer-polite")).toHaveTextContent(
        "Connection failed: network error, configuration loaded",
      ),
    );
  });
});
