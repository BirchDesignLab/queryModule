import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { Outlet } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { ACK_202, API, server, submitRecorder, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";

function renderPanel(persona: string | null = null) {
  const services = testServices();
  services.authStore.getState().setSignedIn(TEST_USER);
  services.preferences.getState().setPersonaOverride(persona);
  const routes = [
    {
      element: (
        <ClientSupportProvider clientSupported>
          <Outlet />
        </ClientSupportProvider>
      ),
      children: appRoutes(true),
    },
  ];
  return renderRoutes(routes, { services });
}

async function openPanel(persona: string | null = null) {
  const view = renderPanel(persona);
  await screen.findByLabelText("Plate");
  return view;
}

const polite = () => screen.getByTestId("announcer-polite");
const SHORT = ACK_202.correlationId.slice(0, 8);

/** A POST that answers when the returned function is called. */
function held(status: number, body: unknown): () => void {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post(`${API}/api/v1/queries`, async ({ request }) => {
      submitRecorder.calls.push({ key: null, body: await request.json() });
      await gate;
      return HttpResponse.json(body as never, { status });
    }),
  );
  return release;
}

afterEach(() => {
  server.events.removeAllListeners();
});

describe("B3 dispatcher requests list (spec 6.7)", () => {
  it("starts with the empty text and the list beside the panel, not inside it", async () => {
    await openPanel();
    const region = screen.getByRole("region", { name: "Requests this shift" });
    expect(region).toHaveTextContent("No requests yet this shift.");
    expect(within(region).queryByRole("list")).toBeNull();
    expect(document.querySelector(".qm-panes > .qm-requests")).toBe(region);
  });

  it("a run shows Sending, then the same row Acknowledged with the reference from the 202", async () => {
    const release = held(202, ACK_202);
    const { user, services } = await openPanel();
    const announce = vi.spyOn(services.announcer, "announce");
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const region = screen.getByRole("region", { name: "Requests this shift" });
    const row = await within(region).findByRole("listitem");
    expect(row).toHaveTextContent("Vehicle");
    expect(row.querySelector("code")).toHaveTextContent("VEH.ZZ-0001");
    expect(row).toHaveTextContent("Sending");
    // Sending is not announced (Submitting is the button's own reason text).
    expect(announce.mock.calls.filter(([text]) => /query sent/.test(String(text)))).toHaveLength(0);
    release();
    await waitFor(() => expect(row).toHaveTextContent("Acknowledged"));
    expect(within(region).getAllByRole("listitem")[0]).toBe(row);
    expect(row).toHaveTextContent(SHORT);
    expect(row).not.toHaveTextContent(ACK_202.correlationId);
    expect(row).toHaveTextContent(/\d\d-\d\d-\d\d \d\d:\d\d:\d\d/);
    expect(row).toHaveTextContent("State system: pending");
    expect(row).toHaveTextContent("National system: pending");
    await waitFor(() =>
      expect(polite()).toHaveTextContent(
        new RegExp(`Vehicle query sent at .* Reference ${SHORT}\\.`),
      ),
    );
    // One announcement per state change: the acknowledgment, said once, by the shared announcer.
    expect(announce.mock.calls.filter(([text]) => /query sent/.test(String(text)))).toHaveLength(1);
    expect(region.querySelector("[aria-live], [role=status], [role=alert]")).toBeNull();
    // Focus never moves on its own.
    expect(screen.getByLabelText("Plate")).toHaveFocus();
  });

  it("lists requests newest first", async () => {
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await screen.findByText(`Acknowledged`);
    await user.click(screen.getByRole("button", { name: "Person" }));
    await user.type(await screen.findByLabelText(/Last name/), "TESTERSON{Enter}");
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Person");
    expect(rows[1]).toHaveTextContent("Vehicle");
    // The count sits beside the heading (design target), not in the region's name.
    const region = screen.getByRole("region", { name: "Requests this shift" });
    expect(region).toHaveTextContent("2 requests");
  });

  it("the dispatcher list shows no count before the first request; one request is singular", async () => {
    const { user } = await openPanel();
    const region = screen.getByRole("region", { name: "Requests this shift" });
    expect(region).not.toHaveTextContent(/\d+ requests?\b/);
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await screen.findByText("Acknowledged");
    expect(region).toHaveTextContent("1 request");
    expect(region).not.toHaveTextContent("1 requests");
  });

  it("a failed run is a Failed row with its reason, announced once by the existing message", async () => {
    server.use(http.post(`${API}/api/v1/queries`, () => new HttpResponse(null, { status: 503 })));
    const { user, services } = await openPanel();
    const announce = vi.spyOn(services.announcer, "announce");
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const row = await screen.findByRole("listitem");
    await waitFor(() => expect(row).toHaveTextContent("Failed"));
    expect(row).toHaveTextContent("The server was restarting.");
    expect(within(row).queryByRole("button")).toBeNull();
    expect(announce).toHaveBeenCalledWith("The server is restarting. Try again shortly.");
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("a skipped part is a line on the row that claims no reason", async () => {
    server.use(
      http.post(`${API}/api/v1/queries`, () =>
        HttpResponse.json(
          {
            ...ACK_202,
            parts: [
              ...ACK_202.parts,
              {
                partId: 2,
                queryType: "WNT",
                status: "skipped",
                sourceIds: [],
                droppedSourceIds: [],
              },
            ],
          },
          { status: 202 },
        ),
      ),
    );
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const row = await screen.findByRole("listitem");
    await waitFor(() => expect(row).toHaveTextContent("Wanted check was not run."));
    expect(row).not.toHaveTextContent("linked query has no sources");
  });

  it("two parts to one source show that source pending once", async () => {
    server.use(
      http.post(`${API}/api/v1/queries`, () =>
        HttpResponse.json(
          {
            ...ACK_202,
            parts: [
              {
                partId: 1,
                queryType: "VEH",
                status: "dispatched",
                sourceIds: ["stateSource"],
                droppedSourceIds: [],
              },
              {
                partId: 2,
                queryType: "WNT",
                status: "dispatched",
                sourceIds: ["stateSource"],
                droppedSourceIds: [],
              },
            ],
          },
          { status: 202 },
        ),
      ),
    );
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const row = await screen.findByRole("listitem");
    await waitFor(() => expect(row).toHaveTextContent("Acknowledged"));
    expect(within(row).getAllByText("State system: pending")).toHaveLength(1);
  });

  it("Copy reference copies the full ID, names its row, and announces once", async () => {
    const { user, services } = await openPanel();
    const announce = vi.spyOn(services.announcer, "announce");
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await user.click(
      await screen.findByRole("button", { name: /^Copy reference \S+ for VEH\.ZZ-0001/ }),
    );
    expect(await navigator.clipboard.readText()).toBe(ACK_202.correlationId);
    await waitFor(() => expect(polite()).toHaveTextContent("Reference copied."));
    expect(announce.mock.calls.filter(([text]) => text === "Reference copied.")).toHaveLength(1);
  });

  it("sign-out clears the list and it stays out of browser storage", async () => {
    const { user, services, router } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await screen.findByText("Acknowledged");
    expect(JSON.stringify({ ...localStorage })).not.toContain("ZZ-0001");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("ZZ-0001");
    expect(services.requests.getState().items).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: TEST_USER.email }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(services.requests.getState().items).toEqual([]);
  });

  it("a signed-in user change starts an empty list", async () => {
    const { user, services } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await screen.findByText("Acknowledged");
    services.reset.resetAll();
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Requests this shift" })).toBeNull(),
    );
    expect(services.requests.getState().items).toEqual([]);
  });

  it("an answer that lands after a reset does not add a row", async () => {
    const release = held(202, ACK_202);
    const { user, services } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await screen.findByText("Sending");
    services.reset.resetAll();
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(services.requests.getState().items).toEqual([]);
  });
});

describe("B3 officer last request (spec 6.3)", () => {
  it("shows the last request below the form, with Nothing sent yet before the first", async () => {
    await openPanel("mobileUnit");
    await waitFor(() =>
      expect(document.querySelector("main.qm-query-panel")).toHaveClass("qm-layout--mobile-unit"),
    );
    const region = screen.getByRole("region", { name: "Last request" });
    expect(region).toHaveTextContent("Nothing sent yet.");
    expect(screen.queryByRole("region", { name: "Requests this shift" })).toBeNull();
  });

  it("keeps only the latest row, acknowledged, with a copy button", async () => {
    const { user } = await openPanel("mobileUnit");
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const region = await screen.findByRole("region", { name: "Last request" });
    await waitFor(() => expect(region).toHaveTextContent("Acknowledged"));
    await user.type(screen.getByLabelText("Plate"), "{Enter}");
    await waitFor(() => expect(submitRecorder.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(within(region).getAllByRole("listitem")).toHaveLength(1));
    expect(
      within(region).getByRole("button", { name: /^Copy reference \S+ for VEH\.ZZ-0001/ }),
    ).toBeVisible();
    // One row only: the officer's pane has no count.
    expect(region).not.toHaveTextContent(/\d+ requests?\b/);
  });
});
