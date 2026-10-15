import { act, screen, within } from "@testing-library/react";
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
import type { JsonObject } from "./draft.js";

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
    expect(within(pane()).getByText(/the card you are editing/)).toBeInTheDocument();
  });

  it("typed plate ZZ-0001 picks the STOLEN scenario, ABC123 the no-record one", async () => {
    const t = await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    await typeValues(t, "ZZ-0001");
    expect(await within(pane()).findByText("Scenario 1 matches")).toBeInTheDocument();
    expect(within(pane()).getAllByText("STOLEN").length).toBeGreaterThan(0);
    await typeValues(t, "ABC123");
    expect(await within(pane()).findByText("Scenario 2 matches")).toBeInTheDocument();
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

  // BW3 polish (#642, CRITIC-M1): with a query type's row or Keywords and severity selected there is
  // no "this card", so the Card used line names the card and says nothing about "another" one.
  it("on a type row and on Keywords and severity the Card used line has no 'Another card'", async () => {
    const t = await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    const nav = screen.getByRole("navigation", { name: "Configuration items" });
    const tree = within(nav).getByRole("tree", { name: "Result cards" });
    await t.user.click(within(tree).getByRole("treeitem", { name: /^Vehicle cards$/ }));
    expect(
      await within(pane()).findByText(/^Card shown to dispatchers: [^,]*\.$/),
    ).toBeInTheDocument();
    expect(within(pane()).queryByText(/a different card/)).toBeNull();
    expect(within(pane()).queryByText(/the card you are editing/)).toBeNull();
    await t.user.click(within(tree).getByRole("treeitem", { name: /^Keywords and severity/ }));
    expect(
      await within(pane()).findByText(/^Card shown to dispatchers: [^,]*\.$/),
    ).toBeInTheDocument();
    expect(within(pane()).queryByText(/a different card/)).toBeNull();
  });

  // BW3 polish (#642, T10-C3): a card narrowed by a rule wins in pick mode for the scenario whose
  // own trigger satisfies the rule, and not for the default answer.
  it("a rule-narrowed card wins in pick mode for the scenario that triggers its rule, not the default", async () => {
    const t = await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    const store = configDraftStore(t.services).getState();
    const mappings = (store.doc as { responseMappings: Record<string, unknown>[] })
      .responseMappings;
    act(() =>
      store.setPath(
        ["responseMappings"],
        [
          ...mappings,
          {
            id: "veh-plate",
            queryType: "VEH",
            when: { field: "plate", op: "eq", value: "ZZ-0001" },
            elements: [{ kind: "value", path: "plate", labelKey: "field.plate", view: "summary" }],
          },
        ],
      ),
    );
    const scenario = within(pane()).getByRole("combobox", { name: "Scenario" });
    await t.user.selectOptions(scenario, "0:0");
    expect(await within(pane()).findByText(/, a different card\.$/)).toBeInTheDocument();
    await t.user.selectOptions(scenario, "0:d");
    expect(await within(pane()).findByText(/, the card you are editing\.$/)).toBeInTheDocument();
  });
});

// BW3 polish round 1 (C1): a typed response answers only a query carrying its type values, so pick
// mode hands part 0 those type values with the scenario's own trigger. A card ruled on the type
// field wins for the typed response's default and for its scenarios.
describe("the card preview: typed responses", () => {
  it("a card ruled on the type field wins in pick mode for a typed PRO response, default and scenario", async () => {
    const t = await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    const store = configDraftStore(t.services).getState();
    const element = { kind: "value", path: "note", labelKey: "field.plate", view: "summary" };
    act(() =>
      store.setPath(
        ["responseMappings"],
        [
          ...(store.doc as { responseMappings: Record<string, unknown>[] }).responseMappings,
          { id: "pro-base", queryType: "PRO", elements: [element] },
          {
            id: "pro-firearm",
            queryType: "PRO",
            when: { field: "propertyType", op: "eq", value: "FIREARM" },
            elements: [element],
          },
        ],
      ),
    );
    const mock = structuredClone(store.mock) as unknown as {
      sources: Record<string, { responses: Record<string, unknown>[] }>;
    };
    mock.sources.stateSource?.responses.push({
      queryType: "PRO",
      types: { propertyType: "FIREARM" },
      default: { status: "NO RECORD", note: "firearm entry" },
      scenarios: [{ when: { serial: "ZZ-0001" }, respond: { status: "STOLEN", note: "hit" } }],
    });
    act(() => store.setMock(mock as unknown as JsonObject));
    const nav = screen.getByRole("navigation", { name: "Configuration items" });
    const tree = within(nav).getByRole("tree", { name: "Result cards" });
    await t.user.click(within(tree).getByRole("treeitem", { name: /^Property cards$/ }));
    const scenario = within(pane()).getByRole("combobox", { name: "Scenario" });
    const last = within(scenario).getAllByRole("option").length;
    expect(last).toBeGreaterThan(1);
    const options = within(scenario).getAllByRole("option") as HTMLOptionElement[];
    for (const o of options.slice(-2)) {
      await t.user.selectOptions(scenario, o.value);
      expect(await within(pane()).findByText(/^Card shown to dispatchers: /)).toBeInTheDocument();
    }
  });
});

// Mockup gaps (#642, FR-060, UX-015): "Values" is a segmented control beside "Result from", one
// row; the outcome is one badge row (badge, then which entry matched), as the mockup's outcome head.
describe("the card preview: the Values segmented control and the outcome row", () => {
  it("Values is a group of two radios beside Result from, Pick a scenario on", async () => {
    await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    const group = within(pane()).getByRole("group", { name: "Values" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")?.textContent)).toEqual([
      "Pick a scenario",
      "Type values",
    ]);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
    // The same row as Result from: one parent holds both fields.
    const source = within(pane()).getByLabelText("Result from");
    expect(source.parentElement?.parentElement).toBe(group.parentElement);
  });

  it("arrow keys move and select, Home and End jump, focus follows, and only the on option is a Tab stop", async () => {
    const t = await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    const group = within(pane()).getByRole("group", { name: "Values" });
    const [pick, type] = within(group).getAllByRole("radio") as [HTMLElement, HTMLElement];
    pick.focus();
    await t.user.keyboard("{ArrowRight}");
    expect(type).toBeChecked();
    expect(type).toHaveFocus();
    expect(within(pane()).getByRole("textbox", { name: "Plate" })).toBeInTheDocument();
    await t.user.keyboard("{ArrowDown}");
    expect(pick).toBeChecked();
    expect(pick).toHaveFocus();
    await t.user.keyboard("{End}");
    expect(type).toBeChecked();
    await t.user.keyboard("{Home}");
    expect(pick).toBeChecked();
    await t.user.keyboard("{ArrowLeft}");
    expect(type).toBeChecked();
    expect(type).toHaveFocus();
    await t.user.keyboard("{ArrowUp}");
    expect(pick).toBeChecked();
    // Tab leaves the group.
    await t.user.tab();
    expect(group.contains(document.activeElement)).toBe(false);
  });

  it("clicking an option keeps focus on it", async () => {
    const t = await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    const type = within(pane()).getByRole("radio", { name: "Type values" });
    await t.user.click(type);
    expect(type).toBeChecked();
    expect(type).toHaveFocus();
  });

  it("the outcome is one row: the badge with the result words, then which entry matched", async () => {
    const t = await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    await typeValues(t, "ZZ-0001");
    const head = await within(pane()).findByTestId("outcome-head");
    expect(head).toHaveTextContent("Returns a record");
    expect(head).toHaveTextContent("Scenario 1 matches");
    expect(head.querySelector(".qm-badge")).toHaveTextContent("Returns a record");
    await typeValues(t, "ABC123");
    expect(await within(pane()).findByTestId("outcome-head")).toHaveTextContent("No record");
    await typeValues(t, "FAIL1");
    const failed = await within(pane()).findByTestId("outcome-head");
    expect(failed).toHaveTextContent("Source error");
    expect(failed.querySelector(".qm-badge")).toHaveTextContent("Source error");
    expect(within(pane()).queryByText(/^Matched scenario/)).toBeNull();
  });

  it("the default answer says no scenario matches", async () => {
    await openVehicleCard();
    await screen.findByRole("region", { name: "Card preview" });
    expect(await within(pane()).findByTestId("outcome-head")).toHaveTextContent(
      "No scenario matches, so the default answers",
    );
  });
});
