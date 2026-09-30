import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { ACK_202, API, CLIENT_CONFIG, server, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";
import { RequestsPane } from "./RequestsPane.js";

// A retry outcome that lands after a reset which leaves the pane mounted (mounted stays true, so
// the unmount guard cannot catch it): the row is gone, so nothing is announced.
describe("RequestsPane: a late retry outcome", () => {
  it("is not announced once its row is gone, although the pane is still mounted", async () => {
    const services = testServices();
    services.authStore.getState().setSignedIn(TEST_USER);
    const id = services.requests.getState().begin({
      queryType: "VEH",
      summary: "VEH.ZZ-0001",
      submitted: { queryType: "VEH", values: { plate: "ZZ-0001" }, sourceIds: [], mode: "normal" },
    });
    services.requests.getState().settle(id, { kind: "unavailable" });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/api/v1/queries`, async () => {
        await gate;
        return HttpResponse.json(ACK_202, { status: 202 });
      }),
    );
    const { user } = renderRoutes(
      [{ path: "/", element: <RequestsPane config={CLIENT_CONFIG} variant="list" /> }],
      { services },
    );
    const announce = vi.spyOn(services.announcer, "announce");
    await user.click(await screen.findByRole("button", { name: /^Retry/ }));
    await waitFor(() => expect(services.submit.getState().status).toBe("submitting"));
    // The reset clears the rows and drops the request; this harness has no route guard, so the
    // pane stays mounted.
    services.reset.resetAll();
    expect(services.requests.getState().items).toEqual([]);
    announce.mockClear();
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("region", { name: /Requests this shift/ })).toBeInTheDocument();
    expect(announce).not.toHaveBeenCalled();
  });

  it("is still announced while its row exists", async () => {
    const services = testServices();
    services.authStore.getState().setSignedIn(TEST_USER);
    const id = services.requests.getState().begin({
      queryType: "VEH",
      summary: "VEH.ZZ-0001",
      submitted: { queryType: "VEH", values: { plate: "ZZ-0001" }, sourceIds: [], mode: "normal" },
    });
    services.requests.getState().settle(id, { kind: "unavailable" });
    server.use(
      http.post(`${API}/api/v1/queries`, () => HttpResponse.json(ACK_202, { status: 202 })),
    );
    const { user } = renderRoutes(
      [{ path: "/", element: <RequestsPane config={CLIENT_CONFIG} variant="list" /> }],
      { services },
    );
    await user.click(await screen.findByRole("button", { name: /^Retry/ }));
    await waitFor(() =>
      expect(screen.getByTestId("announcer-polite")).toHaveTextContent(/Vehicle query sent at/),
    );
  });
});
