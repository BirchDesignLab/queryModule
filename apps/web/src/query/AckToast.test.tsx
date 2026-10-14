import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACK_CORRELATION_ID } from "../test/feed-driver.js";
import { CLIENT_CONFIG, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";
import { AckToast } from "./AckToast.js";

// The ack toast (spec 6.6 Toasts, spec 10.2 A6; ruling 12): shown when a Sending row is
// acknowledged, polite, at least 10 s, dismissible by keyboard, names the request by type and
// primary field, carries the copyable reference and ack time, never payload content.

const ACK_AT = Date.UTC(2026, 8, 29, 17, 4, 5);

function setup() {
  const services = testServices();
  services.authStore.getState().setSignedIn(TEST_USER);
  services.queryClient.setQueryData(["config"], CLIENT_CONFIG);
  const view = renderRoutes([{ path: "/", element: <AckToast /> }], { services });
  const send = (values: Record<string, string>) => {
    const id = services.requests.getState().begin({
      queryType: "VEH",
      summary: "ignored",
      submitted: { queryType: "VEH", values, sourceIds: [], mode: "normal" },
    });
    return id;
  };
  const ack = (id: string) =>
    act(() => {
      services.requests.getState().settle(id, {
        kind: "acknowledged",
        queryType: "VEH",
        response: { correlationId: ACK_CORRELATION_ID, acknowledgedAt: ACK_AT, parts: [] },
      });
    });
  return { ...view, send, ack };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("A6 the ack toast", () => {
  it("shows nothing until a row is acknowledged", () => {
    const { send } = setup();
    send({ plate: "ZZ-0001" });
    expect(screen.queryByRole("status", { name: /acknowledged/i })).toBeNull();
  });

  it("names the request, shows the ack time and a copyable reference, and no payload", async () => {
    const { send, ack, user } = setup();
    ack(send({ plate: "ZZ-0001" }));
    const toast = await screen.findByTestId("ack-toast");
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.textContent).toContain("Vehicle ZZ-0001");
    expect(toast.textContent).toMatch(/Sent \d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(toast.textContent).toContain(ACK_CORRELATION_ID.slice(0, 8));
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(
      screen.getByRole("button", {
        name: `Copy acknowledgment reference ${ACK_CORRELATION_ID.slice(0, 8)} for Vehicle ZZ-0001`,
      }),
    );
    expect(writeText).toHaveBeenCalledWith(ACK_CORRELATION_ID);
  });

  it("is dismissed by keyboard", async () => {
    const { send, ack, user } = setup();
    ack(send({ plate: "ZZ-0001" }));
    await screen.findByTestId("ack-toast");
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.queryByTestId("ack-toast")).toBeNull();
  });

  it("stays at least 10 s, then goes", async () => {
    vi.useFakeTimers();
    const { send, ack } = setup();
    ack(send({ plate: "ZZ-0001" }));
    expect(screen.getByTestId("ack-toast")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(9_900);
    });
    expect(screen.getByTestId("ack-toast")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId("ack-toast")).toBeNull();
  });

  it("pauses while the pointer is over it, then runs a full 10 s again (spec 6.6)", () => {
    vi.useFakeTimers();
    const { send, ack } = setup();
    ack(send({ plate: "ZZ-0001" }));
    const toast = screen.getByTestId("ack-toast");
    fireEvent.pointerEnter(toast);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId("ack-toast")).toBeTruthy();
    fireEvent.pointerLeave(toast);
    act(() => {
      vi.advanceTimersByTime(9_900);
    });
    expect(screen.getByTestId("ack-toast")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId("ack-toast")).toBeNull();
  });

  it("pauses while focus is inside it and resumes when focus leaves (spec 6.6)", () => {
    vi.useFakeTimers();
    const { send, ack } = setup();
    ack(send({ plate: "ZZ-0001" }));
    const copy = screen.getAllByRole("button")[0];
    if (copy === undefined) throw new Error("no toast button");
    act(() => copy.focus());
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId("ack-toast")).toBeTruthy();
    act(() => copy.blur());
    act(() => {
      vi.advanceTimersByTime(10_100);
    });
    expect(screen.queryByTestId("ack-toast")).toBeNull();
  });

  it("is cleared with the list on a reset", async () => {
    const { send, ack, services } = setup();
    ack(send({ plate: "ZZ-0001" }));
    await screen.findByTestId("ack-toast");
    act(() => services.requests.getState().reset());
    expect(screen.queryByTestId("ack-toast")).toBeNull();
  });

  it("does not move focus", async () => {
    const { send, ack } = setup();
    const before = document.activeElement;
    ack(send({ plate: "ZZ-0001" }));
    await screen.findByTestId("ack-toast");
    expect(document.activeElement).toBe(before);
  });
});
