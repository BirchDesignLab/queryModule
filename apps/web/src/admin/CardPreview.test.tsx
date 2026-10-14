import { screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import {
  API,
  adminConfigBody,
  CLIENT_CONFIG,
  RAW_MOCK,
  server,
  TEST_USER,
} from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

// Task 10 (#603; FR-060, UX-015; ADR-0011 decision 4): the card preview renders the production
// ResultCard from the draft's cards and the draft's mock, through the shared matcher. Synthetic
// fixtures only; typed values stay in the pane.

async function openVehicleCard() {
  const account = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user: account }),
    ),
    http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
    http.get(`${API}/api/v1/admin/config`, () =>
      HttpResponse.json(adminConfigBody({ mock: RAW_MOCK })),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  const nav = await screen.findByRole("navigation", { name: "Configuration items" });
  const tree = await within(nav).findByRole("tree", { name: "Result cards" });
  await t.user.click(within(tree).getByRole("treeitem", { name: /^Vehicle cards$/ }));
  await t.user.click(await within(tree).findByRole("treeitem", { name: /^1\. All results/ }));
  return t;
}
type Opened = Awaited<ReturnType<typeof openVehicleCard>>;

const pane = () => screen.getByRole("region", { name: "Card preview" });

async function typeValues(t: Opened, plate: string) {
  await t.user.click(within(pane()).getByRole("radio", { name: "Type values" }));
  const input = within(pane()).getByRole("textbox", { name: "Plate" });
  await t.user.clear(input);
  await t.user.type(input, plate);
}

describe("the card preview", () => {
  it("shows a scenario from the draft's mock by default, through the production card", async () => {
    const t = await openVehicleCard();
    expect(await screen.findByRole("region", { name: "Card preview" })).toBeInTheDocument();
    expect(within(pane()).getByRole("radio", { name: "Pick a scenario" })).toBeChecked();
    await t.user.selectOptions(within(pane()).getByRole("combobox", { name: "Scenario" }), "0:0");
    const card = await within(pane()).findByRole("region", { name: "State system: returned" });
    // The remarks row, its keyword marked (the mark splits the text).
    expect(within(card).getByText("Remarks")).toBeInTheDocument();
    expect(card.querySelectorAll("mark").length).toBeGreaterThan(0);
    expect(within(pane()).getByText(/This card/)).toBeInTheDocument();
  });

  it("typed plate ZZ-0001 picks the STOLEN scenario, ABC123 the no-record one", async () => {
    const t = await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    await typeValues(t, "ZZ-0001");
    expect(await within(pane()).findByText("Matched scenario 1")).toBeInTheDocument();
    expect(within(pane()).getAllByText("STOLEN").length).toBeGreaterThan(0);
    await typeValues(t, "ABC123");
    expect(await within(pane()).findByText("Matched scenario 2")).toBeInTheDocument();
    expect(within(pane()).getByText("NO RECORD")).toBeInTheDocument();
    // Typed values never reach the draft.
    expect(JSON.stringify(configDraftStore(t.services).getState().doc)).not.toContain("ABC123");
  });

  it("a behaviour scenario previews the status line, not a card", async () => {
    const t = await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    await typeValues(t, "FAIL1");
    expect(await within(pane()).findByText("State system: failed")).toBeInTheDocument();
    expect(within(pane()).queryByRole("region", { name: /returned/ })).toBeNull();
  });

  it("a summary row vehicle.make added in the editor shows in the preview for ZZ-0001", async () => {
    const t = await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    const editor = screen.getByTestId("form-tab");
    await t.user.click(within(editor).getByRole("button", { name: "Add row" }));
    await t.user.type(within(editor).getByRole("combobox", { name: "Path" }), "vehicle.make");
    await t.user.type(
      within(editor).getByRole("textbox", { name: "Label shown to users" }),
      "Make test",
    );
    await typeValues(t, "ZZ-0001");
    const card = await within(pane()).findByRole("region", { name: "State system: returned" });
    const term = await within(card).findByText("Make test");
    // In the summary, above the Show detail toggle: not hidden in the detail region.
    expect(term.closest(".qm-card__detail")).toBeNull();
    expect(within(card).getAllByText("TESTMAKE").length).toBeGreaterThan(0);
  });
});
