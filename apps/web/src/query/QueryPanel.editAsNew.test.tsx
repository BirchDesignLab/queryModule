import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { API, CLIENT_CONFIG, server, submitRecorder, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";

// Edit as new query (#477, ruling #434). A 409 row offers no Retry, since the same values cannot
// succeed under the config that changed. It offers "Edit as new query": the row's kept values load
// into the form under the config the panel has now; whatever that config no longer has is dropped
// and named; focus moves to the form only because the user pressed the action. The failed row is
// history and stays; nothing is sent; nothing is stored.

const CHANGED_HASH = "0000000000000000000000000000000000000000000000000000000000000002";

/** The default site with the Year field removed from Vehicle, as an administrator's publish would. */
function configWithoutYear() {
  const config = structuredClone(CLIENT_CONFIG);
  const vehicle = config.queryTypes.find((q) => q.code === "VEH");
  if (vehicle) vehicle.fields = vehicle.fields.filter((f) => f.key !== "year");
  return { ...config, configHash: CHANGED_HASH };
}

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
  await waitFor(() => expect(view.services.drafts.getState().queryType).not.toBeNull());
  return view;
}

/** Posts answer 409 once; from then on the config is the one without Year. */
function configChangesUnderTheSubmit() {
  let changed = false;
  server.use(
    http.get(`${API}/api/v1/config`, () =>
      HttpResponse.json(changed ? configWithoutYear() : CLIENT_CONFIG),
    ),
    http.post(`${API}/api/v1/queries`, async ({ request }) => {
      submitRecorder.calls.push({
        key: request.headers.get("idempotency-key"),
        body: await request.json(),
      });
      changed = true;
      return HttpResponse.json(
        { error: { code: "configHashMismatch", currentConfigHash: CHANGED_HASH } },
        { status: 409 },
      );
    }),
  );
}

async function failWithAChangedConfig(user: Awaited<ReturnType<typeof openPanel>>["user"]) {
  await user.type(screen.getByLabelText("Year"), "2024");
  await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
  const region = screen.getByRole("region", { name: "Requests this shift" });
  await within(region).findByRole("button", { name: /^Edit as new query/ });
  // The refetched config has applied: the form no longer has the Year field.
  await waitFor(() => expect(screen.queryByLabelText("Year")).toBeNull());
  return region;
}

describe("edit as new query after a 409 (#477)", () => {
  it("a 409 row offers Edit as new query, named by the row, and no Retry", async () => {
    configChangesUnderTheSubmit();
    const { user } = await openPanel();
    const region = await failWithAChangedConfig(user);
    expect(
      within(region).getByRole("button", { name: "Edit as new query: Vehicle ZZ-0001" }),
    ).toHaveTextContent("Edit as new query");
    expect(within(region).queryByRole("button", { name: /^Retry/ })).toBeNull();
  });

  it("loads the kept values, drops what the config lost with a visible note, and focuses the form", async () => {
    configChangesUnderTheSubmit();
    const { user, services } = await openPanel();
    const region = await failWithAChangedConfig(user);
    // The draft moved on after the failure; the action loads what the row kept.
    await user.clear(screen.getByLabelText("Plate"));
    await user.type(screen.getByLabelText("Plate"), "ZZ-0009");
    expect(document.activeElement).toBe(screen.getByLabelText("Plate"));
    await user.click(
      within(region).getByRole("button", { name: "Edit as new query: Vehicle ZZ-0001" }),
    );
    const plate = screen.getByLabelText("Plate");
    expect(plate).toHaveValue("ZZ-0001");
    expect(plate).toHaveFocus();
    // The note names the field in words; it never shows the value that was dropped.
    const note = screen.getByTestId("edit-as-new-note");
    expect(note).toHaveTextContent("Not loaded");
    expect(note).toHaveTextContent("Year");
    expect(note).not.toHaveTextContent("2024");
    expect(screen.getByTestId("announcer-polite")).toHaveTextContent("Year");
    // The kept draft holds nothing for Year.
    expect(services.drafts.getState().drafts.VEH?.values).toEqual(
      expect.not.objectContaining({ year: expect.anything() }),
    );
  });

  it("the failed row stays as history and nothing is sent", async () => {
    configChangesUnderTheSubmit();
    const { user, services } = await openPanel();
    const region = await failWithAChangedConfig(user);
    const before = submitRecorder.calls.length;
    await user.click(
      within(region).getByRole("button", { name: "Edit as new query: Vehicle ZZ-0001" }),
    );
    expect(submitRecorder.calls).toHaveLength(before);
    expect(within(region).getAllByRole("listitem")).toHaveLength(1);
    expect(within(region).getByRole("listitem")).toHaveTextContent("Failed");
    expect(services.requests.getState().items[0]?.submitted?.values).toMatchObject({
      plate: "ZZ-0001",
      year: "2024",
    });
    // The action is still there: the row is history and can be edited again.
    expect(
      within(region).getByRole("button", { name: "Edit as new query: Vehicle ZZ-0001" }),
    ).toBeInTheDocument();
  });

  it("writes nothing to storage and does not change the URL", async () => {
    configChangesUnderTheSubmit();
    const { user } = await openPanel();
    const region = await failWithAChangedConfig(user);
    const url = window.location.href;
    const stored = (): string =>
      JSON.stringify([Object.entries(window.localStorage), Object.entries(window.sessionStorage)]);
    const before = stored();
    await user.click(
      within(region).getByRole("button", { name: "Edit as new query: Vehicle ZZ-0001" }),
    );
    expect(stored()).toBe(before);
    expect(stored()).not.toContain("ZZ-0001");
    expect(window.location.href).toBe(url);
  });

  it("the note goes away when the user clears the form", async () => {
    configChangesUnderTheSubmit();
    const { user } = await openPanel();
    const region = await failWithAChangedConfig(user);
    await user.click(
      within(region).getByRole("button", { name: "Edit as new query: Vehicle ZZ-0001" }),
    );
    expect(screen.getByTestId("edit-as-new-note")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByTestId("edit-as-new-note")).toBeNull();
  });

  it("with nothing dropped there is no note, but the values load and focus moves", async () => {
    let answered = false;
    server.use(
      http.post(`${API}/api/v1/queries`, () => {
        answered = true;
        return HttpResponse.json(
          { error: { code: "configHashMismatch", currentConfigHash: "x" } },
          { status: 409 },
        );
      }),
    );
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const region = screen.getByRole("region", { name: "Requests this shift" });
    const edit = await within(region).findByRole("button", { name: /^Edit as new query/ });
    expect(answered).toBe(true);
    await user.clear(screen.getByLabelText("Plate"));
    await user.click(edit);
    expect(screen.getByLabelText("Plate")).toHaveValue("ZZ-0001");
    expect(screen.getByLabelText("Plate")).toHaveFocus();
    expect(screen.queryByTestId("edit-as-new-note")).toBeNull();
  });

  it("a row that failed another way gets no Edit as new query", async () => {
    server.use(http.post(`${API}/api/v1/queries`, () => new HttpResponse(null, { status: 403 })));
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const row = await screen.findByRole("listitem");
    await waitFor(() => expect(row).toHaveTextContent("Failed"));
    expect(within(row).queryByRole("button", { name: /Edit as new query/ })).toBeNull();
  });

  it("the officer's last request offers the action too", async () => {
    configChangesUnderTheSubmit();
    const { user } = await openPanel("mobileUnit");
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const region = await screen.findByRole("region", { name: "Last request" });
    const edit = await within(region).findByRole("button", { name: /^Edit as new query/ });
    await user.clear(screen.getByLabelText("Plate"));
    await user.click(edit);
    expect(screen.getByLabelText("Plate")).toHaveValue("ZZ-0001");
    expect(screen.getByLabelText("Plate")).toHaveFocus();
  });
});
