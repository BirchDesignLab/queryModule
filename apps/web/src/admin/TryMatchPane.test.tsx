import { act, screen, waitFor, within } from "@testing-library/react";
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
import { moveScenario, parseMock } from "./mock-model.js";

beforeAll(preloadAdminRoutes);

// Task 12 (#565; FR-043, FR-044; spec 5.4; CFG-2): the Try a match pane beside the mock editor. The
// admin picks a source and a query type, types values, and sees which scenario of the draft's mock
// the shared matcher picks. Typed values stay in the pane's state: never the draft, Review or storage.
// Synthetic values only (ZZ-####).

async function openBuilder() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
    http.get(`${API}/api/v1/admin/config`, () =>
      HttpResponse.json(adminConfigBody({ mock: RAW_MOCK })),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  const nav = await screen.findByRole("navigation", { name: "Configuration items" });
  const tree = within(nav).getByRole("tree", { name: "Mock responses" });
  await t.user.click(within(tree).getByRole("treeitem", { name: /^Coverage/ }));
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

const pane = () => screen.getByRole("region", { name: "Try a match" });

async function tryVehicle(t: Opened, plate: string) {
  const p = within(await screen.findByRole("region", { name: "Try a match" }));
  await t.user.selectOptions(p.getByLabelText("Source"), "stateSource");
  await t.user.selectOptions(p.getByLabelText("Query type"), "VEH");
  const input = p.getByLabelText("Plate");
  await t.user.clear(input);
  await t.user.type(input, plate);
}

describe("Try a match", () => {
  it("typed ZZ-0001 on the state system's Vehicle shows scenario 1 and its STOLEN record", async () => {
    const t = await openBuilder();
    await tryVehicle(t, "ZZ-0001");
    const p = within(pane());
    expect(p.getByText(/^Scenario 1 matches/)).toBeInTheDocument();
    expect(p.getByText(/Plate is ZZ-0001/)).toBeInTheDocument();
    expect(p.getByText("Result: Returns a record")).toBeInTheDocument();
    await t.user.click(p.getByRole("button", { name: "Payload" }));
    expect(p.getByTestId("try-payload").textContent).toContain('"status": "STOLEN"');
  });

  it("an unmatched plate shows the default answer", async () => {
    const t = await openBuilder();
    await tryVehicle(t, "ZZ-0099");
    const p = within(pane());
    expect(p.getByText("No scenario matches: the default answers.")).toBeInTheDocument();
    expect(p.getByText("Result: No record")).toBeInTheDocument();
  });

  it("a behaviour scenario shows the behaviour, not a payload", async () => {
    const t = await openBuilder();
    await tryVehicle(t, "FAIL1");
    const p = within(pane());
    expect(p.getByText(/^Scenario 3 matches/)).toBeInTheDocument();
    expect(p.getByText("Result: Source error")).toBeInTheDocument();
    await t.user.click(p.getByRole("button", { name: "Payload" }));
    expect(p.queryByTestId("try-payload")).not.toBeInTheDocument();
  });

  it("follows the draft: reordering the scenarios changes the match", async () => {
    const t = await openBuilder();
    await tryVehicle(t, "ZZ-0001");
    expect(within(pane()).getByText(/^Scenario 1 matches/)).toBeInTheDocument();
    const store = configDraftStore(t.services).getState();
    act(() => {
      const parsed = parseMock(store.mock);
      if (!parsed.ok) throw new Error("no mock");
      store.setMock(
        moveScenario(
          parsed.mock,
          { sourceId: "stateSource", response: 0, scenario: 0 },
          2,
        ) as unknown as JsonObject,
      );
    });
    expect(within(pane()).getByText(/^Scenario 3 matches/)).toBeInTheDocument();
  });

  it("typed values never reach the draft, Review or storage", async () => {
    const t = await openBuilder();
    const store = configDraftStore(t.services);
    const before = JSON.stringify([store.getState().doc, store.getState().mock]);
    await tryVehicle(t, "ZZ-0042");
    expect(JSON.stringify([store.getState().doc, store.getState().mock])).toBe(before);
    expect(store.getState().undoCount).toBe(0);
    const stored = [localStorage, sessionStorage].flatMap((s) =>
      Object.keys(s).map((k) => `${k}=${s.getItem(k)}`),
    );
    expect(stored.join("\n")).not.toContain("ZZ-0042");
    await t.user.click(screen.getByRole("tab", { name: /^Changes/ }));
    expect(document.body.textContent).not.toMatch(/ZZ-0042/);
  });
});

const draftMock = (t: Opened) =>
  structuredClone(configDraftStore(t.services).getState().mock) as unknown as {
    sources: Record<string, { latencyMs: number[]; responses: Record<string, unknown>[] }>;
  };
const setMock = (t: Opened, mock: object) =>
  act(() =>
    configDraftStore(t.services)
      .getState()
      .setMock(mock as unknown as JsonObject),
  );

// BW3 polish (#642, CRITIC-M3; design "Try a match (refines v4)"): the answer as the production
// Result card or as the Payload, the wait, and a debounced announcement of the outcome kind.
describe("Try a match: the answer, the wait and the announcement", () => {
  it("shows the Result card by default, the Payload on request, and the card again after", async () => {
    const t = await openBuilder();
    await tryVehicle(t, "ZZ-0001");
    const p = within(pane());
    const card = p.getByRole("button", { name: "Result card" });
    const payload = p.getByRole("button", { name: "Payload" });
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(payload).toHaveAttribute("aria-pressed", "false");
    const production = await p.findByRole("region", { name: "State system: returned" });
    expect(within(production).getAllByText("STOLEN").length).toBeGreaterThan(0);
    expect(p.queryByTestId("try-payload")).not.toBeInTheDocument();
    await t.user.click(payload);
    expect(payload).toHaveAttribute("aria-pressed", "true");
    expect(p.getByTestId("try-payload").textContent).toContain('"status": "STOLEN"');
    expect(p.queryByRole("region", { name: "State system: returned" })).not.toBeInTheDocument();
    await t.user.click(card);
    expect(await p.findByRole("region", { name: "State system: returned" })).toBeInTheDocument();
  });

  it("a behaviour outcome shows its status line in both views and never a card", async () => {
    const t = await openBuilder();
    await tryVehicle(t, "FAIL1");
    const p = within(pane());
    expect(await p.findByText("State system: failed")).toBeInTheDocument();
    expect(p.queryByRole("region", { name: /returned/ })).not.toBeInTheDocument();
    await t.user.click(p.getByRole("button", { name: "Payload" }));
    expect(p.getByText("State system: failed")).toBeInTheDocument();
    expect(p.queryByTestId("try-payload")).not.toBeInTheDocument();
  });

  it("names the wait from the source's latency: a range, one value, or nothing", async () => {
    const t = await openBuilder();
    await tryVehicle(t, "ZZ-0001");
    expect(within(pane()).getByText("Answers after 50 to 400 ms.")).toBeInTheDocument();
    const same = draftMock(t);
    (same.sources.stateSource as { latencyMs: number[] }).latencyMs = [120, 120];
    setMock(t, same);
    expect(await within(pane()).findByText("Answers after 120 ms.")).toBeInTheDocument();
    const none = draftMock(t);
    (none.sources.stateSource as { latencyMs: number[] }).latencyMs = [0, 0];
    setMock(t, none);
    await waitFor(() => expect(within(pane()).queryByText(/^Answers after/)).toBeNull());
  });

  it("announces the outcome kind once typing pauses, never a typed value or the payload", async () => {
    const t = await openBuilder();
    const p = within(await screen.findByRole("region", { name: "Try a match" }));
    await t.user.selectOptions(p.getByLabelText("Source"), "stateSource");
    await t.user.selectOptions(p.getByLabelText("Query type"), "VEH");
    const live = p.getByRole("status");
    expect(live).toHaveTextContent("");
    await t.user.type(p.getByLabelText("Plate"), "ZZ-0001");
    // Typing takes a few milliseconds: nothing has been said yet.
    expect(live).toHaveTextContent("");
    await waitFor(() => expect(live).toHaveTextContent("Returns a record. Scenario 1 of Vehicle."));
    expect(live.textContent).not.toMatch(/ZZ-0001|STOLEN/);
    await t.user.clear(p.getByLabelText("Plate"));
    await t.user.type(p.getByLabelText("Plate"), "ZZ-0099");
    await waitFor(() =>
      expect(live).toHaveTextContent("No record. No scenario matches, the default answers."),
    );
    expect(live.textContent).not.toMatch(/ZZ-0099/);
  });
});

// BW3 polish (#642, T12-C2, T12-C3, T12-C4).
describe("Try a match: selection, sources and type picklists", () => {
  const row = async (name: RegExp) =>
    within(
      within(await screen.findByRole("navigation", { name: "Configuration items" })).getByRole(
        "tree",
        { name: "Mock responses" },
      ),
    ).getAllByRole("treeitem", { name })[0] as HTMLElement;

  it("follows the tree to another response even after the admin changed Source and Query type", async () => {
    const t = await openBuilder();
    const p = within(await screen.findByRole("region", { name: "Try a match" }));
    await t.user.click(await row(/^Mock response: Vehicle, State system/));
    expect(p.getByLabelText("Source")).toHaveValue("stateSource");
    expect(p.getByLabelText("Query type")).toHaveValue("VEH");
    // The admin's own choice holds ...
    await t.user.selectOptions(p.getByLabelText("Source"), "nationalSource");
    await t.user.selectOptions(p.getByLabelText("Query type"), "PRO");
    expect(p.getByLabelText("Query type")).toHaveValue("PRO");
    // ... until the selection changes again: then the pane follows the tree.
    await t.user.click(await row(/^Mock response: Property, National system/));
    expect(p.getByLabelText("Source")).toHaveValue("nationalSource");
    expect(p.getByLabelText("Query type")).toHaveValue("PRO");
    await t.user.selectOptions(p.getByLabelText("Source"), "stateSource");
    await t.user.click(await row(/^Mock response: Vehicle, State system/));
    expect(p.getByLabelText("Source")).toHaveValue("stateSource");
    expect(p.getByLabelText("Query type")).toHaveValue("VEH");
  });

  it("offers only sources whose kind is mock", async () => {
    const t = await openBuilder();
    const store = configDraftStore(t.services).getState();
    const doc = store.doc as { sources: Record<string, unknown>[] };
    act(() =>
      store.setPath(
        ["sources"],
        doc.sources.map((s) => (s.id === "nationalSource" ? { ...s, kind: "http" } : s)),
      ),
    );
    const p = within(await screen.findByRole("region", { name: "Try a match" }));
    const options = within(p.getByLabelText("Source")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["State system"]);
  });

  it("a type-role picklist field is a select over the picklist and picking a code matches the typed response", async () => {
    const t = await openBuilder();
    const mock = draftMock(t);
    (mock.sources.stateSource as { responses: Record<string, unknown>[] }).responses.push({
      queryType: "PRO",
      types: { propertyType: "FIREARM" },
      default: { status: "NO RECORD", note: "firearm entry" },
      scenarios: [],
    });
    setMock(t, mock);
    const p = within(await screen.findByRole("region", { name: "Try a match" }));
    await t.user.selectOptions(p.getByLabelText("Source"), "stateSource");
    await t.user.selectOptions(p.getByLabelText("Query type"), "PRO");
    const type = p.getByRole("combobox", { name: "Property type" });
    expect(
      within(type)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["No type chosen", "Firearm", "Boat", "Article", "Electronics", "Vehicle"]);
    // The other fields stay free text.
    expect(p.getByRole("textbox", { name: "Serial number" })).toBeInTheDocument();
    expect(p.getByText("Answered by response 3 of this source.")).toBeInTheDocument();
    await t.user.selectOptions(type, "FIREARM");
    expect(await p.findByText("Answered by response 5 of this source.")).toBeInTheDocument();
  });
});
