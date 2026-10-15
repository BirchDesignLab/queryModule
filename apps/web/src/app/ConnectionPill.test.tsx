import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";
import { ConnectionPill, RESTORED_MS } from "./ConnectionPill.js";

// G24 (mockup v5 header): the connection state is on screen, not only announced.

function setup() {
  const services = testServices();
  services.authStore.getState().setSignedIn(TEST_USER);
  renderRoutes([{ path: "/", element: <ConnectionPill /> }], { services });
  return services;
}

afterEach(() => vi.useRealTimers());

describe("G24 connection pill", () => {
  it("says Connected while the connection is up", () => {
    setup();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("says so while the connection is down, then shows Connection restored for a few seconds", () => {
    vi.useFakeTimers();
    const services = setup();
    act(() => services.submit.setState({ status: "noConnection" }));
    expect(screen.getByText("No connection to server")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    act(() => services.submit.setState({ status: "idle" }));
    expect(screen.getByText("Connection restored")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(RESTORED_MS);
    });
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("is plain text, not a live region: the announcer already speaks these changes", () => {
    setup();
    expect(
      screen.getByText("Connected").closest("[aria-live], [role=status], [role=alert]"),
    ).toBeNull();
  });
});
