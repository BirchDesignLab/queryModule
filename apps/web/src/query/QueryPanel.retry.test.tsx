import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { Outlet } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { ACK_202, API, server, submitRecorder, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";

// Failed-row retry (docs: work queue item 2). A failed row keeps what it sent, in memory; Retry
// sends those values again as a NEW request (new Idempotency-Key, new row) and never moves focus.

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

/** Renders, then waits for the store to hold a type: draft writes before that are dropped. */
async function openPanel(persona: string | null = null) {
  const view = renderPanel(persona);
  await screen.findByLabelText("Plate");
  await waitFor(() => expect(view.services.drafts.getState().queryType).not.toBeNull());
  return view;
}

/** Answers 503 until told to answer 202; every call is recorded with its key. */
function flaky() {
  const state = { failing: true };
  server.use(
    http.post(`${API}/api/v1/queries`, async ({ request }) => {
      submitRecorder.calls.push({
        key: request.headers.get("idempotency-key"),
        body: await request.json(),
      });
      return state.failing
        ? new HttpResponse(null, { status: 503 })
        : HttpResponse.json(ACK_202, { status: 202 });
    }),
  );
  return state;
}

afterEach(() => {
  server.events.removeAllListeners();
});

describe("retry on the dispatcher's list (spec 6.7)", () => {
  it("a failed row offers Retry, named by its command; the retry is a new request and a new row", async () => {
    const answers = flaky();
    const { user, services } = await openPanel();
    const announce = vi.spyOn(services.announcer, "announce");
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const region = screen.getByRole("region", { name: "Requests this shift" });
    const retry = await within(region).findByRole("button", { name: /^Retry VEH\.ZZ-0001/ });
    expect(retry).toHaveTextContent("Retry");
    answers.failing = false;
    // The draft changes after the failure; the retry still sends what the row kept.
    await user.clear(screen.getByLabelText("Plate"));
    await user.type(screen.getByLabelText("Plate"), "ZZ-0009");
    await user.click(retry);
    await waitFor(() => expect(within(region).getAllByRole("listitem")).toHaveLength(2));
    const [fresh, failed] = within(region).getAllByRole("listitem");
    await waitFor(() => expect(fresh).toHaveTextContent("Acknowledged"));
    expect(failed).toHaveTextContent("Failed");
    expect(fresh).toHaveTextContent("VEH.ZZ-0001");
    expect(submitRecorder.calls).toHaveLength(2);
    expect(submitRecorder.calls[1]?.body).toEqual(submitRecorder.calls[0]?.body);
    expect(submitRecorder.calls[1]?.key).not.toBe(submitRecorder.calls[0]?.key);
    // The result goes through the shared region only, once; focus never moved.
    await waitFor(() =>
      expect(announce.mock.calls.filter(([text]) => /query sent/.test(String(text)))).toHaveLength(
        1,
      ),
    );
    expect(retry).toHaveFocus();
    expect(region.querySelector("[aria-live], [role=status], [role=alert]")).toBeNull();
  });

  it("a failed retry stays a failed row of its own, and can be retried again", async () => {
    flaky();
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const region = screen.getByRole("region", { name: "Requests this shift" });
    await user.click(await within(region).findByRole("button", { name: /^Retry/ }));
    await waitFor(() => expect(within(region).getAllByRole("listitem")).toHaveLength(2));
    await waitFor(() =>
      expect(within(region).getAllByRole("button", { name: /^Retry/ })).toHaveLength(2),
    );
  });

  it("keeps the subtype, the field values and the sources with the row", async () => {
    flaky();
    const { user, services } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await screen.findByRole("button", { name: /^Retry/ });
    const row = services.requests.getState().items[0];
    expect(row?.submitted).toMatchObject({
      queryType: "VEH",
      values: { plate: "ZZ-0001" },
      mode: "plateOnly",
    });
    expect(row?.submitted?.sourceIds.length).toBeGreaterThan(0);
  });

  it("no Retry on a row the server refused for its values (400) or its user (403)", async () => {
    server.use(
      http.post(`${API}/api/v1/queries`, () =>
        HttpResponse.json(
          { error: { code: "VALIDATION", message: "no", errors: [] } },
          { status: 400 },
        ),
      ),
    );
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const row = await screen.findByRole("listitem");
    await waitFor(() => expect(row).toHaveTextContent("Failed"));
    expect(within(row).queryByRole("button", { name: /^Retry/ })).toBeNull();
  });

  it("while the connection is down a Retry sends nothing and says so through the shared region", async () => {
    server.use(
      http.post(`${API}/api/v1/queries`, () => HttpResponse.error()),
      http.get(`${API}/api/v1/health`, () => HttpResponse.error()),
    );
    const { user, services } = await openPanel();
    const announce = vi.spyOn(services.announcer, "announce");
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const retry = await screen.findByRole("button", { name: /^Retry/ });
    await waitFor(() => expect(services.submit.getState().status).toBe("noConnection"));
    announce.mockClear();
    await user.click(retry);
    expect(announce).toHaveBeenCalledWith("No connection to server");
    expect(services.requests.getState().items).toHaveLength(1);
    expect(retry).toHaveFocus();
  });

  it("the kept values leave with a reset and never reach browser storage", async () => {
    flaky();
    const { user, services } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await screen.findByRole("button", { name: /^Retry/ });
    expect(JSON.stringify({ ...localStorage })).not.toContain("ZZ-0001");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("ZZ-0001");
    services.reset.resetAll();
    expect(services.requests.getState().items).toEqual([]);
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull());
  });

  it("a Retry that lands after a reset adds no row", async () => {
    const answers = flaky();
    const { user, services } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const retry = await screen.findByRole("button", { name: /^Retry/ });
    answers.failing = false;
    await user.click(retry);
    services.reset.resetAll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(services.requests.getState().items).toEqual([]);
  });
});

describe("retry on the officer's last request (spec 6.3)", () => {
  it("the retry replaces the one visible row; focus goes to the Last request heading, not <body>", async () => {
    const answers = flaky();
    const { user } = await openPanel("mobileUnit");
    await waitFor(() =>
      expect(document.querySelector("main.qm-query-panel")).toHaveClass("qm-layout--mobile-unit"),
    );
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const region = await screen.findByRole("region", { name: "Last request" });
    const retry = await within(region).findByRole("button", { name: /^Retry VEH\.ZZ-0001/ });
    answers.failing = false;
    await user.click(retry);
    await waitFor(() => expect(region).toHaveTextContent("Acknowledged"));
    expect(within(region).getAllByRole("listitem")).toHaveLength(1);
    expect(within(region).queryByRole("button", { name: /^Retry/ })).toBeNull();
    expect(within(region).getByRole("heading", { name: "Last request" })).toHaveFocus();
  });
});

describe("the existing failed-row behaviour is kept", () => {
  it("a 503 row still states its reason and announces the existing message once", async () => {
    flaky();
    const { user, services } = await openPanel();
    const announce = vi.spyOn(services.announcer, "announce");
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const row = await screen.findByRole("listitem");
    await waitFor(() => expect(row).toHaveTextContent("The server was restarting."));
    expect(announce).toHaveBeenCalledWith("The server is restarting. Try again shortly.");
    expect(announce).toHaveBeenCalledTimes(1);
  });
});
