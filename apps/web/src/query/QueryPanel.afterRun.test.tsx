import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { ACK_202, API, server, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";

// G32 (developer ruling): after a run is acknowledged the draft keeps the query type and the site
// defaults (State is TX) and clears what was typed, so nothing from the last query rides into the
// next. A run that did not reach an acknowledgment keeps the draft: the user still needs it (Retry,
// a fix, Edit as new query). One draft across form and terminal; the mode toggle is FR-056's
// separate, open question and is not touched here.

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

const polite = () => screen.getByTestId("announcer-polite");

describe("G32 the draft after a run", () => {
  it("an acknowledged form run clears the typed values and keeps the type and the site defaults", async () => {
    const { user, services } = await openPanel();
    await user.selectOptions(screen.getByLabelText("State"), "OK");
    // A State other than the site default reveals the required Plate type.
    await user.selectOptions(screen.getByLabelText(/Plate type/), "PC");
    await user.type(screen.getByLabelText("Year"), "2024");
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await waitFor(() => expect(polite()).toHaveTextContent(/Vehicle query sent/));
    await waitFor(() => expect(screen.getByLabelText("Plate")).toHaveValue(""));
    expect(screen.getByLabelText("Year")).toHaveValue("");
    // The site default is back, not the State the last query used.
    expect(screen.getByLabelText("State")).toHaveValue("TX");
    expect(services.drafts.getState().queryType).toBe("VEH");
    expect(services.drafts.getState().drafts.VEH).toEqual({ values: {}, sources: null });
    // Focus is ready for the next query.
    expect(screen.getByLabelText("Plate")).toHaveFocus();
  });

  it("the source choice goes back to the defaults too", async () => {
    const { user, services } = await openPanel();
    await user.click(screen.getByRole("checkbox", { name: /National/ }));
    expect(services.drafts.getState().drafts.VEH?.sources).toEqual(["stateSource"]);
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await waitFor(() => expect(polite()).toHaveTextContent(/Vehicle query sent/));
    await waitFor(() => expect(services.drafts.getState().drafts.VEH?.sources).toBeNull());
    expect(screen.getByRole("checkbox", { name: /National/ })).toBeChecked();
  });

  it("another type's draft is not touched", async () => {
    const { user, services } = await openPanel();
    await user.click(screen.getByRole("button", { name: "Person" }));
    await user.type(screen.getByLabelText(/Last name/), "Testcase");
    await user.click(screen.getByRole("button", { name: "Vehicle" }));
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await waitFor(() => expect(polite()).toHaveTextContent(/Vehicle query sent/));
    await waitFor(() => expect(screen.getByLabelText("Plate")).toHaveValue(""));
    expect(services.drafts.getState().drafts.PER?.values.last).toBe("Testcase");
  });

  it("a run that is not acknowledged keeps the draft", async () => {
    server.use(http.post(`${API}/api/v1/queries`, () => new HttpResponse(null, { status: 403 })));
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const row = await screen.findByRole("listitem");
    await waitFor(() => expect(row).toHaveTextContent("Failed"));
    expect(screen.getByLabelText("Plate")).toHaveValue("ZZ-0001");
  });

  it("a server 400 keeps the draft, with its errors on the fields", async () => {
    server.use(
      http.post(`${API}/api/v1/queries`, () =>
        HttpResponse.json(
          {
            error: {
              code: "validationFailed",
              errors: [{ key: "validation.required", params: { field: "plate" } }],
            },
          },
          { status: 400 },
        ),
      ),
    );
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await waitFor(() => expect(screen.getByLabelText("Plate")).toHaveAttribute("aria-invalid"));
    expect(screen.getByLabelText("Plate")).toHaveValue("ZZ-0001");
  });

  it("a user who started the next query while the first was in flight keeps what they typed", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/api/v1/queries`, async () => {
        await gate;
        return HttpResponse.json(ACK_202, { status: 202 });
      }),
    );
    const { user, services } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    await user.clear(screen.getByLabelText("Plate"));
    await user.type(screen.getByLabelText("Plate"), "ZZ-0002");
    release();
    await waitFor(() => expect(polite()).toHaveTextContent(/Vehicle query sent/));
    expect(screen.getByLabelText("Plate")).toHaveValue("ZZ-0002");
    expect(services.drafts.getState().drafts.VEH?.values.plate).toBe("ZZ-0002");
  });

  it("an acknowledged terminal run clears the command to the type and its defaults", async () => {
    const { user, services } = await openPanel();
    await user.click(screen.getByRole("button", { name: "Terminal mode" }));
    const input = screen.getByLabelText("Command");
    await user.type(input, ".ABC123");
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(polite()).toHaveTextContent(/Vehicle query sent/));
    const typed = () => (input as HTMLInputElement).value;
    await waitFor(() => expect(typed()).not.toContain("ABC123"));
    expect(typed()).toMatch(/^VEH/);
    expect(input).toHaveFocus();
    expect(services.drafts.getState().drafts.VEH).toEqual({ values: {}, sources: null });
    // One draft across modes: back in the form, nothing from the run is there either.
    await user.click(screen.getByRole("button", { name: "Form mode" }));
    expect(screen.getByLabelText("Plate")).toHaveValue("");
  });

  it("a terminal user who typed on while the run was in flight keeps the new text", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/api/v1/queries`, async () => {
        await gate;
        return HttpResponse.json(ACK_202, { status: 202 });
      }),
    );
    const { user } = await openPanel();
    await user.click(screen.getByRole("button", { name: "Terminal mode" }));
    const input = screen.getByLabelText("Command");
    await user.type(input, ".ABC123{Enter}");
    await user.type(input, "9");
    release();
    await waitFor(() => expect(polite()).toHaveTextContent(/Vehicle query sent/));
    expect((input as HTMLInputElement).value).toContain("ABC1239");
  });

  it("the request row keeps the command it was sent with", async () => {
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001{Enter}");
    const region = await screen.findByRole("region", { name: "Requests this shift" });
    await waitFor(() => expect(screen.getByLabelText("Plate")).toHaveValue(""));
    expect(within(region).getByRole("listitem")).toHaveTextContent("ZZ-0001");
  });
});
