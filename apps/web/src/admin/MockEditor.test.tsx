import { act, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import {
  API,
  adminConfigBody,
  CLIENT_CONFIG,
  RAW_MOCK,
  RAW_SITE,
  server,
  TEST_USER,
} from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";
import { parseMock, payloadKeyOptions } from "./mock-model.js";

beforeAll(preloadAdminRoutes);

// Task 3a (#549, CFG-2; spec 5.4, 6.6): the mock responses editor in the builder. Synthetic
// fixtures only (ZZ-####, Testerson, Sampleworth); no payload value goes into a name or an announcement.

async function openBuilder(mock: Record<string, unknown> = RAW_MOCK) {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
    http.get(`${API}/api/v1/admin/config`, () => HttpResponse.json(adminConfigBody({ mock }))),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

const nav = () => screen.findByRole("navigation", { name: "Configuration items" });
const draftMock = (t: Opened) => {
  const raw = configDraftStore(t.services).getState().mock;
  const parsed = parseMock(raw);
  if (!parsed.ok) throw new Error("the draft's mock is not a mock file");
  return parsed.mock;
};
/** The Mock responses tree: the query types have rows of the same names in their own tree. */
const mockTree = async () => within(await nav()).getByRole("tree", { name: "Mock responses" });
/** A tree row of the Mock responses group; `nth` picks among rows of the same name (one per source). */
async function selectRow(user: UserEvent, name: RegExp, nth = 0) {
  const rows = within(await mockTree()).getAllByRole("treeitem", { name });
  const row = rows[nth];
  if (row === undefined) throw new Error(`no tree row ${String(name)}`);
  await user.click(row);
  return row;
}
const scenarioCard = (n: number) => screen.getByRole("group", { name: `Scenario ${n}` });
const polite = () => document.querySelector('[aria-live="polite"][role="status"], [role="status"]');

describe("the tree and the coverage grid", () => {
  it("lists Coverage, each mock source and its responses under Mock responses", async () => {
    await openBuilder();
    const tree = within(await mockTree());
    expect(tree.getByRole("treeitem", { name: /^Coverage/ })).toBeInTheDocument();
    expect(tree.getByRole("treeitem", { name: /^State system/ })).toBeInTheDocument();
    expect(tree.getByRole("treeitem", { name: /^National system/ })).toBeInTheDocument();
    expect(tree.getAllByRole("treeitem", { name: /^Vehicle VEH/ })).toHaveLength(2);
  });

  it("the Coverage item is a table of query types by mock source, with Not asked cells explained", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Coverage/);
    const table = await screen.findByRole("table", {
      name: "Mock response coverage: query types by mock source",
    });
    expect(within(table).getByRole("columnheader", { name: /State system/ })).toBeInTheDocument();
    const wanted = within(table).getByRole("row", { name: /Wanted check/ });
    expect(within(wanted).getByText(/Not asked/)).toBeInTheDocument();
  });

  it("a gap is Missing with an Add mock response button that names the source and the type", async () => {
    const t = await openBuilder();
    const mock = structuredClone(RAW_MOCK) as {
      sources: Record<string, { responses: { queryType: string }[] }>;
    };
    const state = mock.sources.stateSource;
    if (state === undefined) throw new Error("fixture");
    state.responses = state.responses.filter((r) => r.queryType !== "DL");
    act(() => configDraftStore(t.services).getState().setMock(mock));
    await selectRow(t.user, /^Coverage/);
    expect(await screen.findByText("Missing")).toBeInTheDocument();
    const add = screen.getByRole("button", {
      name: /Add mock response for State system, Driver's license/,
    });
    await t.user.click(add);
    expect(draftMock(t).sources.stateSource?.responses.some((r) => r.queryType === "DL")).toBe(
      true,
    );
    // The new response opens, with its heading focused (focus never drops to the page).
    expect(await screen.findByRole("heading", { name: /Driver's license/ })).toHaveFocus();
    expect(screen.queryByText("Missing")).not.toBeInTheDocument();
  });
});

describe("a source", () => {
  it("shows its response time as two numeric inputs and its responses", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^State system/);
    expect(await screen.findByLabelText("Shortest wait")).toHaveValue("50");
    expect(screen.getByLabelText("Longest wait")).toHaveValue("400");
    expect(screen.getByRole("button", { name: /Vehicle/ })).toBeInTheDocument();
  });

  it("a change to the response time goes to the draft, one undo step", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^State system/);
    const shortest = await screen.findByLabelText("Shortest wait");
    await t.user.clear(shortest);
    await t.user.type(shortest, "10");
    // Leaving the field commits it: a half-typed value never reaches the draft.
    expect(draftMock(t).sources.stateSource?.latencyMs).toEqual([50, 400]);
    await t.user.tab();
    expect(draftMock(t).sources.stateSource?.latencyMs).toEqual([10, 400]);
  });

  it("a shortest wait longer than the longest is flagged and not written", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^State system/);
    const shortest = await screen.findByLabelText("Shortest wait");
    await t.user.clear(shortest);
    await t.user.type(shortest, "900");
    expect(shortest).toHaveAttribute("aria-invalid", "true");
    await t.user.tab();
    expect(
      screen.getByText("Enter both waits, the shortest no longer than the longest."),
    ).toBeInTheDocument();
    // Nothing was written, not even the valid prefixes typed on the way to it.
    expect(draftMock(t).sources.stateSource?.latencyMs).toEqual([50, 400]);
  });

  it("Add mock response adds a second response for a type with a type field, and refuses a duplicate", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^National system/);
    await t.user.selectOptions(await screen.findByLabelText("Query type"), "PRO");
    await t.user.selectOptions(screen.getByLabelText("Property type"), "FIREARM");
    await t.user.click(screen.getByRole("button", { name: "Add mock response" }));
    const responses = draftMock(t).sources.nationalSource?.responses ?? [];
    expect(responses.at(-1)).toMatchObject({
      queryType: "PRO",
      types: { propertyType: "FIREARM" },
    });
    // The same one again: the button says why it cannot, and offers the existing response.
    await selectRow(t.user, /^National system/);
    await t.user.selectOptions(await screen.findByLabelText("Query type"), "PRO");
    await t.user.selectOptions(screen.getByLabelText("Property type"), "FIREARM");
    const add = screen.getByRole("button", { name: "Add mock response" });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/already has this response/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open it" })).toBeInTheDocument();
  });
});

describe("a response", () => {
  it("shows the query type read-only, the default and the scenarios in order", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 1); // National system
    const type = await screen.findByLabelText("Query type");
    expect(type).toHaveAttribute("readonly");
    expect(type).toHaveValue("Vehicle (VEH)");
    expect(screen.getByRole("radio", { name: /No record/ })).toBeChecked();
    expect(scenarioCard(1)).toBeInTheDocument();
    expect(scenarioCard(2)).toBeInTheDocument();
  });

  it("adds a scenario with a trigger and a record payload, and writes them to the draft", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 1);
    await t.user.click(await screen.findByRole("button", { name: "Add scenario" }));
    const card = scenarioCard(3);
    // The new scenario opens, with focus on its first trigger value.
    const value = within(card).getByLabelText("Value for trigger field 1");
    expect(value).toHaveFocus();
    await t.user.type(value, "ZZ-0002");
    expect(within(card).getByRole("radio", { name: /Returns a record/ })).toBeChecked();
    const status = within(card).getByLabelText(/^Value for status/);
    await t.user.clear(status);
    await t.user.type(status, "STOLEN");
    await waitFor(() => {
      const added = draftMock(t).sources.nationalSource?.responses[0]?.scenarios[2];
      expect(added).toEqual({ when: { plate: "ZZ-0002" }, respond: { status: "STOLEN" } });
    });
  });

  it("the key picker offers exactly the fixture allowlist", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 1);
    await t.user.click(await screen.findByRole("button", { name: "Edit scenario 1" }));
    const key = within(scenarioCard(1)).getByLabelText(/^Key, row 1$/);
    const list = document.getElementById(key.getAttribute("list") ?? "");
    const offered = [...(list?.querySelectorAll("option") ?? [])].map((o) =>
      o.getAttribute("value"),
    );
    expect(offered).toEqual(payloadKeyOptions().map((o) => o.key));
  });

  it("a non-synthetic name shows the diagnostic at the row, without the value", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 0); // State system: scenario 1 has an owner group
    await t.user.click(await screen.findByRole("button", { name: "Edit scenario 1" }));
    const last = within(scenarioCard(1)).getByLabelText(/^Value for last/);
    await t.user.clear(last);
    await t.user.type(last, "SMITH");
    await waitFor(() => expect(last).toHaveAttribute("aria-invalid", "true"));
    const message = await screen.findByText(/Mock names may use only synthetic names/);
    expect(last.getAttribute("aria-describedby")).toContain(message.closest("[id]")?.id);
    expect(message.textContent).not.toContain("SMITH");
    // The fix button replaces the value with a synthetic one.
    await t.user.click(within(scenarioCard(1)).getByRole("button", { name: "Use TESTERSON" }));
    await waitFor(() => expect(last).toHaveValue("TESTERSON"));
    expect(last).not.toHaveAttribute("aria-invalid", "true");
  });

  it("moving a scenario changes the order and announces it without values; undo restores it", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 1);
    await t.user.click(await screen.findByRole("button", { name: "Move scenario 1 down" }));
    expect(
      draftMock(t).sources.nationalSource?.responses[0]?.scenarios.map((s) => s.when.plate),
    ).toEqual(["TIMEOUT", "ZZ-0001"]);
    await waitFor(() =>
      expect(document.body.textContent).toContain("Scenario 1 moved to position 2"),
    );
    expect(polite()?.textContent ?? "").not.toContain("ZZ-0001");
    await t.user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      draftMock(t).sources.nationalSource?.responses[0]?.scenarios.map((s) => s.when.plate),
    ).toEqual(["ZZ-0001", "TIMEOUT"]);
  });

  it("the first Move up and the last Move down stay focusable with aria-disabled", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 1);
    expect(await screen.findByRole("button", { name: "Move scenario 1 up" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Move scenario 2 down" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("removing a scenario moves focus to the next scenario's Edit, and the last one to Add scenario", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 1);
    await t.user.click(await screen.findByRole("button", { name: "Remove scenario 1" }));
    expect(draftMock(t).sources.nationalSource?.responses[0]?.scenarios).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Edit scenario 1" })).toHaveFocus();
    await t.user.click(screen.getByRole("button", { name: "Remove scenario 1" }));
    expect(screen.getByRole("button", { name: "Add scenario" })).toHaveFocus();
  });

  it("the result radios change a scenario to a behavior and back", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 1);
    await t.user.click(await screen.findByRole("button", { name: "Edit scenario 1" }));
    await t.user.click(within(scenarioCard(1)).getByRole("radio", { name: /Source error/ }));
    expect(draftMock(t).sources.nationalSource?.responses[0]?.scenarios[0]).toEqual({
      when: { plate: "ZZ-0001" },
      behavior: "error",
    });
  });

  it("a scenario needs a trigger value: blank is an error at the control", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 1);
    await t.user.click(await screen.findByRole("button", { name: "Add scenario" }));
    const value = within(scenarioCard(3)).getByLabelText("Value for trigger field 1");
    await waitFor(() => expect(value).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText("Enter the value that triggers this scenario.")).toBeInTheDocument();
  });

  it("Edit and Close toggle a scenario (aria-expanded), and Escape closes it to its Edit button", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 1);
    const edit = await screen.findByRole("button", { name: "Edit scenario 1" });
    expect(edit).toHaveAttribute("aria-expanded", "false");
    await t.user.click(edit);
    expect(screen.getByRole("button", { name: "Close scenario 1" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await t.user.keyboard("{Tab}{Escape}");
    expect(screen.getByRole("button", { name: "Edit scenario 1" })).toHaveFocus();
  });

  it("the type field of a response with one can be set, and the query type cannot", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Property PRO/, 0); // State system
    const select = await screen.findByLabelText("Property type");
    await t.user.selectOptions(select, "FIREARM");
    expect(
      draftMock(t).sources.stateSource?.responses.find((r) => r.queryType === "PRO")?.types,
    ).toEqual({
      propertyType: "FIREARM",
    });
    expect(screen.getByLabelText("Query type")).toHaveAttribute("readonly");
  });
});

describe("focus and counts (critic round 1)", () => {
  it("a moved scenario keeps focus on its own Move button, so a second press moves it again", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 0); // State system: three scenarios
    await t.user.click(await screen.findByRole("button", { name: "Move scenario 3 up" }));
    expect(screen.getByRole("button", { name: "Move scenario 2 up" })).toHaveFocus();
    await t.user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Move scenario 1 up" })).toHaveFocus();
    expect(
      draftMock(t).sources.stateSource?.responses[0]?.scenarios.map((s) => s.when.plate),
    ).toEqual(["FAIL1", "ZZ-0001", "ABC123"]);
  });

  it("a fix keeps focus on the row, and removing a row goes to Add field", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 0);
    await t.user.click(await screen.findByRole("button", { name: "Edit scenario 1" }));
    const card = scenarioCard(1);
    const last = within(card).getByLabelText(/^Value for last/);
    await t.user.clear(last);
    await t.user.type(last, "SMITH");
    await t.user.click(within(card).getByRole("button", { name: "Use TESTERSON" }));
    await waitFor(() => expect(within(card).getByLabelText(/^Value for last/)).toHaveFocus());
    await t.user.click(within(card).getByRole("button", { name: "Remove last" }));
    expect(within(card).getByRole("button", { name: "Add field" })).toHaveFocus();
  });

  it("removing a trigger field goes to Add trigger field", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Vehicle VEH/, 1);
    await t.user.click(await screen.findByRole("button", { name: "Edit scenario 1" }));
    const card = scenarioCard(1);
    await t.user.click(within(card).getByRole("button", { name: "Add trigger field" }));
    await t.user.click(within(card).getByRole("button", { name: "Remove trigger field 2" }));
    expect(within(card).getByRole("button", { name: "Add trigger field" })).toHaveFocus();
  });

  it("a source row counts the errors of its responses once", async () => {
    const t = await openBuilder();
    act(() => {
      const store = configDraftStore(t.services).getState();
      const parsed = parseMock(store.mock);
      if (!parsed.ok) throw new Error("fixture");
      const mock = structuredClone(parsed.mock);
      const first = mock.sources.stateSource?.responses[0];
      if (first !== undefined) first.default = { status: "STOLEN", plate: "REALPLATE1" };
      store.setMock(mock as Record<string, unknown>);
    });
    const tree = within(await mockTree());
    await waitFor(() =>
      expect(tree.getByRole("treeitem", { name: /^State system.*, 1 error$/ })).toBeInTheDocument(),
    );
    expect(tree.queryByText(/2 errors/)).not.toBeInTheDocument();
  });

  it("a site source with no mock data is explained, with a fix that adds a response per query type", async () => {
    const site = structuredClone(RAW_SITE) as {
      sources: Record<string, unknown>[];
      queryTypes: { code: string; sources: { sourceId: string; selectedByDefault: boolean }[] }[];
    };
    site.sources.push({
      id: "extraSource",
      labelKey: "source.stateSource",
      scope: "state",
      kind: "mock",
      timeoutMs: 10000,
      maxConcurrent: 4,
      requiresCredentials: false,
    });
    site.queryTypes
      .find((q) => q.code === "PER")
      ?.sources.push({ sourceId: "extraSource", selectedByDefault: false });
    const user = { ...TEST_USER, role: "implementer" };
    server.use(
      http.get(`${API}/api/v1/auth/get-session`, () =>
        HttpResponse.json({ session: { id: "s1" }, user }),
      ),
      http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
      http.get(`${API}/api/v1/admin/config`, () =>
        HttpResponse.json(adminConfigBody({ mock: RAW_MOCK, siteConfig: site })),
      ),
    );
    const t = renderRoot({ path: "/admin/config" });
    await screen.findByRole("tab", { name: "Form" });
    await selectRow(t.user, /^Coverage/);
    expect(await screen.findByText(/has no mock data/)).toBeInTheDocument();
    await t.user.click(screen.getByRole("button", { name: /Add a no-record response/ }));
    const added = draftMock(t).sources.extraSource?.responses.map((r) => r.queryType);
    expect(added).toEqual(["PER"]);
    expect(screen.queryByText(/has no mock data/)).not.toBeInTheDocument();
  });
});

describe("the right pane on mock items", () => {
  it("is a static Select a response note: no preview, no matcher", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Coverage/);
    expect(await screen.findByText("Select a response to edit its answers.")).toBeInTheDocument();
    expect(screen.queryByText("Try a match")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "As officer" })).not.toBeInTheDocument();
  });
});
