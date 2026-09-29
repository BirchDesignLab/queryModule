import { ClientSiteConfigSchema } from "@querymodule/core/config";
import { screen, waitFor, within } from "@testing-library/react";
import { delay, HttpResponse, http } from "msw";
import { Outlet } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { API, CLIENT_CONFIG, server, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";

const SUBMIT_HINT = "Ready to submit. Sending queries arrives in the next release.";

function renderPanel() {
  const services = testServices();
  services.authStore.getState().setSignedIn(TEST_USER);
  // The routes read client support from context; Root provides it in the app.
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

async function openPanel() {
  const view = renderPanel();
  await screen.findByLabelText("Plate");
  return view;
}

const polite = () => screen.getByTestId("announcer-polite");

afterEach(() => {
  server.events.removeAllListeners();
});

function serveConfig(quickAccess: string[]) {
  server.use(
    http.get(`${API}/api/v1/config`, () => HttpResponse.json({ ...CLIENT_CONFIG, quickAccess })),
  );
}

describe("BR-001 config-driven query panel (spec 6.2)", () => {
  it("fetches GET /api/v1/config through the API and renders from the parsed ClientSiteConfig", async () => {
    const urls: string[] = [];
    server.events.on("request:start", ({ request }) => urls.push(new URL(request.url).pathname));
    const { services } = await openPanel();
    expect(urls.filter((u) => u === "/api/v1/config")).toHaveLength(1);
    const cached = services.queryClient.getQueryData(["config"]);
    expect(cached).toEqual(ClientSiteConfigSchema.parse(CLIENT_CONFIG));
    expect(cached).toMatchObject({
      site: { id: "default" },
      quickAccess: ["VEH", "PER", "PRO", "WNT"],
    });
  });

  it("shows a status message while the config loads", async () => {
    server.use(
      http.get(`${API}/api/v1/config`, async () => {
        await delay(30);
        return HttpResponse.json(CLIENT_CONFIG);
      }),
    );
    renderPanel();
    expect(screen.getByText("Checking connection")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Query Module" })).toBeInTheDocument();
    await screen.findByLabelText("Plate");
    expect(screen.queryByText("Checking connection")).not.toBeInTheDocument();
  });

  it("a config fetch error shows the error text, keeps the chrome usable and can retry", async () => {
    server.use(
      http.get(`${API}/api/v1/config`, () => new HttpResponse(null, { status: 503 }), {
        once: true,
      }),
    );
    const { user } = renderPanel();
    expect(
      await screen.findByText("The service is unavailable. Try again.", { selector: "p" }),
    ).toBeInTheDocument();
    // Spec 6.6: one announcer, polite; no assertive role="alert" of the panel's own.
    expect(
      screen.getByText("The service is unavailable. Try again.", { selector: "p" }),
    ).not.toHaveAttribute("role");
    expect(screen.getByTestId("announcer-assertive")).toHaveTextContent("");
    await waitFor(() =>
      expect(polite()).toHaveTextContent("The service is unavailable. Try again."),
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Plate")).toBeInTheDocument();
    expect(
      screen.queryByText("The service is unavailable. Try again.", { selector: "p" }),
    ).not.toBeInTheDocument();
  });

  it("Retry keeps keyboard focus off body when the retry succeeds (spec 6.4)", async () => {
    server.use(
      http.get(`${API}/api/v1/config`, () => new HttpResponse(null, { status: 503 }), {
        once: true,
      }),
    );
    const { user } = renderPanel();
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByLabelText("Plate");
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole("heading", { name: "Query Module" })).toHaveFocus();
  });

  it("Retry keeps keyboard focus off body when the retry fails again (spec 6.4)", async () => {
    server.use(http.get(`${API}/api/v1/config`, () => new HttpResponse(null, { status: 503 })));
    const { user } = renderPanel();
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Retry" });
    expect(document.body).not.toHaveFocus();
  });

  it("[A1] VEH opens with Plate, State (TX, default tag), Year, VIN and no Plate type", async () => {
    await openPanel();
    expect(screen.getByRole("button", { name: "Vehicle" })).toHaveAttribute("aria-pressed", "true");
    for (const label of ["Plate", "Year", "VIN"]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
    const state = screen.getByLabelText("State");
    expect(state).toHaveValue("TX");
    expect(state).toHaveAccessibleDescription("default");
    expect(screen.queryByLabelText(/Plate type/)).not.toBeInTheDocument();
  });

  it("[A2] a non-default State reveals Plate type as required and announces it; the default hides it", async () => {
    const { user } = await openPanel();
    await user.selectOptions(screen.getByLabelText("State"), "OK");
    const plateType = screen.getByLabelText(/Plate type/);
    expect(plateType).toHaveAttribute("aria-required", "true");
    expect(polite()).toHaveTextContent("Plate type is now shown and required.");
    // Focus stays where the user was (spec 6.2 A2).
    expect(screen.getByLabelText("State")).toHaveFocus();
    await user.selectOptions(screen.getByLabelText("State"), "TX");
    expect(screen.queryByLabelText(/Plate type/)).not.toBeInTheDocument();
  });

  it("[A3] a blocked submit marks the first invalid field, describes it, focuses it and announces the count", async () => {
    const { user } = await openPanel();
    await user.click(screen.getByRole("button", { name: "Person" }));
    const last = screen.getByLabelText(/Last name/);
    expect(last).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(last).toHaveAttribute("aria-invalid", "true");
    expect(last).toHaveAccessibleDescription("Last name is required.");
    expect(last).toHaveFocus();
    expect(polite()).toHaveTextContent("1 field needs attention.");
  });

  it("a blocked submit focuses the first invalid field in render order and counts every one", async () => {
    const { user } = await openPanel();
    await user.click(screen.getByRole("button", { name: "Person" }));
    await user.type(screen.getByLabelText(/Date of birth/), "not-a-date");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByLabelText(/Last name/)).toHaveFocus();
    expect(screen.getByLabelText(/Date of birth/)).toHaveAttribute("aria-invalid", "true");
    expect(polite()).toHaveTextContent("2 fields need attention.");
  });

  it("a revealed required field that is empty is the focus target of a blocked submit", async () => {
    const { user } = await openPanel();
    await user.selectOptions(screen.getByLabelText("State"), "OK");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByLabelText(/Plate type/)).toHaveFocus();
    expect(polite()).toHaveTextContent("1 field needs attention.");
  });

  it("a cleared required field is stored as an empty string and counts as empty", async () => {
    const { user, services } = await openPanel();
    await user.click(screen.getByRole("button", { name: "Person" }));
    const last = screen.getByLabelText(/Last name/);
    await user.type(last, "Z");
    await user.clear(last);
    expect(services.drafts.getState().drafts.PER?.values.last).toBe("");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(last).toHaveAttribute("aria-invalid", "true");
    expect(last).toHaveFocus();
  });

  it("errors stay hidden until a blocked submit, and a new query type starts clean", async () => {
    const { user } = await openPanel();
    await user.click(screen.getByRole("button", { name: "Person" }));
    expect(screen.getByLabelText(/Last name/)).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByLabelText(/Last name/)).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Property" }));
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  });

  it("FR-007 quick access marks the current type and keeps the other type's draft", async () => {
    const { user } = await openPanel();
    const nav = screen.getByRole("navigation", { name: "Quick access" });
    expect(within(nav).getByRole("button", { name: "Vehicle" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.type(screen.getByLabelText("Plate"), "ZZ-1234");
    await user.click(within(nav).getByRole("button", { name: "Person" }));
    expect(within(nav).getByRole("button", { name: "Person" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByLabelText("Plate")).not.toBeInTheDocument();
    await user.click(within(nav).getByRole("button", { name: "Vehicle" }));
    expect(screen.getByLabelText("Plate")).toHaveValue("ZZ-1234");
  });

  it("spec 6.2 both default sources are checked; unchecking one updates the draft", async () => {
    const { user, services } = await openPanel();
    const group = screen.getByRole("group", { name: "Sources" });
    expect(within(group).getByRole("checkbox", { name: "State system" })).toBeChecked();
    expect(within(group).getByRole("checkbox", { name: "National system" })).toBeChecked();
    await user.click(within(group).getByRole("checkbox", { name: "State system" }));
    expect(within(group).getByRole("checkbox", { name: "State system" })).not.toBeChecked();
    expect(within(group).getByRole("checkbox", { name: "National system" })).toBeChecked();
    expect(services.drafts.getState().drafts.VEH?.sources).toEqual(["nationalSource"]);
  });

  it("[D-B3] a valid submit announces readiness and sends no query request", async () => {
    const urls: string[] = [];
    server.events.on("request:start", ({ request }) => urls.push(new URL(request.url).pathname));
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-1234");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(polite()).toHaveTextContent(SUBMIT_HINT);
    expect(urls.some((u) => u.startsWith("/api/v1/queries"))).toBe(false);
  });

  it("FR-006 Enter in a text field submits the form once", async () => {
    const { user, services } = await openPanel();
    const announce = vi.spyOn(services.announcer, "announce");
    await user.type(screen.getByLabelText("Plate"), "ZZ-1234{Enter}");
    const ready = announce.mock.calls.filter(([text]) => text === SUBMIT_HINT);
    expect(ready).toHaveLength(1);
  });

  it("SEC-006 the draft is gone after sign-out", async () => {
    const { user, services, router } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-1234");
    expect(services.drafts.getState().drafts.VEH?.values.plate).toBe("ZZ-1234");
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(services.drafts.getState()).toMatchObject({ queryType: null, drafts: {} });
  });

  it("SEC-006 keeps drafts out of browser storage", async () => {
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-1234");
    expect(JSON.stringify({ ...localStorage })).not.toContain("ZZ-1234");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("ZZ-1234");
    expect(document.cookie).not.toContain("ZZ-1234");
  });

  describe("ADR-0010 quick access picks the type; type fields are the subtype control", () => {
    it("the default site shows four buttons and no query type control", async () => {
      await openPanel();
      const nav = screen.getByRole("navigation", { name: "Quick access" });
      expect(
        within(nav)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(["Vehicle", "Person", "Property", "Wanted check"]);
      expect(screen.queryByLabelText("Query type")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Other query types")).not.toBeInTheDocument();
    });

    it("Alt+4 selects Wanted check", async () => {
      const { user } = await openPanel();
      await user.keyboard("{Alt>}4{/Alt}");
      expect(screen.getByRole("button", { name: "Wanted check" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("types left off quickAccess are chosen in an Other query types select", async () => {
      serveConfig(["VEH", "PER", "PRO"]);
      const { user } = await openPanel();
      const select = screen.getByLabelText("Other query types");
      expect(
        within(select)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["", "Wanted check"]);
      expect(select).toHaveValue("");
      await user.selectOptions(select, "WNT");
      expect(await screen.findByLabelText(/Last name/)).toBeInTheDocument();
      for (const button of within(
        screen.getByRole("navigation", { name: "Quick access" }),
      ).getAllByRole("button")) {
        expect(button).toHaveAttribute("aria-pressed", "false");
      }
      expect(select).toHaveValue("WNT");
    });

    it("a quick access button clears the Other query types choice", async () => {
      serveConfig(["VEH", "PER", "PRO"]);
      const { user } = await openPanel();
      await user.selectOptions(screen.getByLabelText("Other query types"), "WNT");
      await user.click(screen.getByRole("button", { name: "Vehicle" }));
      expect(screen.getByLabelText("Other query types")).toHaveValue("");
    });

    it("an empty quickAccess lists every type in a select labelled Query type", async () => {
      serveConfig([]);
      const { user } = await openPanel();
      const select = screen.getByLabelText("Query type");
      expect(
        within(select)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Vehicle", "Person", "Property", "Wanted check"]);
      await user.selectOptions(select, "PER");
      expect(await screen.findByLabelText(/Last name/)).toBeInTheDocument();
    });

    it("Property shows Property type in the type bar, before the form and not in a section", async () => {
      const { user } = await openPanel();
      await user.click(screen.getByRole("button", { name: "Property" }));
      const control = await screen.findByLabelText(/Property type/);
      const form = document.querySelector("form") as HTMLFormElement;
      expect(form.contains(control)).toBe(false);
      expect(control.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(control.closest("fieldset")).toBeNull();
    });

    it("choosing a property type changes required fields as the form did", async () => {
      const { user } = await openPanel();
      await user.click(screen.getByRole("button", { name: "Property" }));
      await user.selectOptions(await screen.findByLabelText(/Property type/), "BOAT");
      expect(screen.getByLabelText(/Property type/)).toHaveValue("BOAT");
      await user.click(screen.getByRole("button", { name: "Submit" }));
      expect(screen.getByLabelText(/Property type/)).not.toHaveAttribute("aria-invalid");
    });

    it("a blocked submit marks an empty Property type and focuses it", async () => {
      const { user } = await openPanel();
      await user.click(screen.getByRole("button", { name: "Property" }));
      await user.click(screen.getByRole("button", { name: "Submit" }));
      const control = screen.getByLabelText(/Property type/);
      expect(control).toHaveAttribute("aria-invalid", "true");
      expect(control).toHaveFocus();
    });

    it("Vehicle shows no type bar", async () => {
      await openPanel();
      expect(screen.queryByLabelText(/Property type/)).not.toBeInTheDocument();
      expect(document.querySelector(".qm-type-fields")).toBeNull();
    });
  });
});
