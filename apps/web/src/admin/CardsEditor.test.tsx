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

beforeAll(preloadAdminRoutes);

// Task 10 (#603; FR-060, UX-015, UX-016; spec 4.5; ADR-0011 decision 4): the Result cards group,
// the card editor and its Review lines. Synthetic fixtures only (ZZ-####, TESTMAKE).

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
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

const nav = () => screen.getByRole("navigation", { name: "Configuration items" });
const cardsTree = () => within(nav()).getByRole("tree", { name: "Result cards" });
const editor = () => screen.getByTestId("form-tab");
const cards = (t: Opened) =>
  (configDraftStore(t.services).getState().doc as { responseMappings: { id: string }[] })
    .responseMappings;

async function openVehicleCard(t: Opened) {
  await screen.findByRole("tree", { name: "Result cards" });
  await t.user.click(within(cardsTree()).getByRole("treeitem", { name: /^Vehicle cards$/ }));
  await t.user.click(
    await within(cardsTree()).findByRole("treeitem", { name: /^1\. All results veh-summary/ }),
  );
  return within(editor()).findByRole("heading", { level: 3, name: /^Vehicle: All results/ });
}

async function addMakeRow(t: Opened) {
  await t.user.click(within(editor()).getByRole("button", { name: "Add row" }));
  const path = await within(editor()).findByRole("combobox", { name: "Path" });
  expect(path).toHaveFocus();
  await t.user.type(path, "vehicle.make");
  const label = within(editor()).getByRole("textbox", { name: "Label shown to users" });
  await t.user.type(label, "Make test");
  return { path, label };
}

describe("the Result cards group", () => {
  it("sits between Query types and Site, lists each type's cards and Keywords and severity", async () => {
    await openBuilder();
    await screen.findByRole("tree", { name: "Result cards" });
    const headers = within(nav())
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(headers.slice(0, 3)).toEqual(["Query types", "Result cards", "Site"]);
    expect(
      within(cardsTree()).getByRole("treeitem", { name: /^Keywords and severity keywords/ }),
    ).toBeInTheDocument();
    // The cards left the Site group.
    const site = within(nav()).getByRole("tree", { name: "Site" });
    expect(within(site).queryByRole("treeitem", { name: /responseMappings/ })).toBeNull();
  });

  it("opens the card editor with its key, position and the camel-cased label key prefix", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    expect(within(editor()).getByText("1 of 1 Vehicle cards")).toBeInTheDocument();
    expect(within(editor()).getByText("mapping.vehSummary.*")).toBeInTheDocument();
  });
});

describe("the card editor", () => {
  it("adds a summary row vehicle.make with its label, as one card edit", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    await addMakeRow(t);
    const veh = cards(t)[0] as unknown as { elements: Record<string, unknown>[] };
    expect(veh.elements.at(-1)).toMatchObject({
      kind: "value",
      path: "vehicle.make",
      view: "summary",
      labelKey: "mapping.vehSummary.label1",
    });
    expect(configDraftStore(t.services).getState().labels.en?.["mapping.vehSummary.label1"]).toBe(
      "Make test",
    );
    expect(within(editor()).getByRole("group", { name: /^Make test/ })).toBeInTheDocument();
  });

  it("warns at the row when no mock payload carries the path", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    const { path } = await addMakeRow(t);
    await t.user.clear(path);
    await t.user.type(path, "vehicle.colour");
    expect(
      await within(editor()).findByText(/A real source may still send it/),
    ).toBeInTheDocument();
  });

  it("a second card with the same narrowing shows config.duplicateMapping inline", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    await t.user.click(within(editor()).getByRole("button", { name: "Add Vehicle card" }));
    await within(editor()).findByRole("heading", {
      level: 3,
      name: /^Vehicle: All results veh-card/,
    });
    expect(cards(t).map((c) => c.id)).toContain("veh-card");
    expect(
      await within(editor()).findByText(/Response mapping veh-card is defined more than once/),
    ).toBeInTheDocument();
    // The other card is one button away.
    await t.user.click(within(editor()).getByRole("button", { name: /^Open 1\. All results/ }));
    expect(
      await within(editor()).findByRole("heading", { level: 3, name: /veh-summary/ }),
    ).toBeInTheDocument();
  });

  it("removes a card and focus goes to its type's heading, never body", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    await t.user.click(within(editor()).getByRole("button", { name: "Add Vehicle card" }));
    await within(editor()).findByRole("heading", { level: 3, name: /veh-card/ });
    await t.user.click(within(editor()).getByRole("button", { name: /^Remove card/ }));
    const heading = await within(editor()).findByRole("heading", {
      level: 3,
      name: /^Vehicle cards/,
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(cards(t).map((c) => c.id)).not.toContain("veh-card");
  });

  it("works by keyboard alone: tree row, Enter, then Add row from the keyboard", async () => {
    const t = await openBuilder();
    await screen.findByRole("tree", { name: "Result cards" });
    const typeRow = within(cardsTree()).getByRole("treeitem", { name: /^Vehicle cards$/ });
    act(() => typeRow.focus());
    await t.user.keyboard("{ArrowRight}{ArrowRight}");
    const cardRow = within(cardsTree()).getByRole("treeitem", { name: /^1\. All results/ });
    expect(cardRow).toHaveFocus();
    await t.user.keyboard("{Enter}");
    await within(editor()).findByRole("heading", { level: 3, name: /^Vehicle: All results/ });
    const add = within(editor()).getByRole("button", { name: "Add row" });
    act(() => add.focus());
    await t.user.keyboard("{Enter}");
    expect(await within(editor()).findByRole("combobox", { name: "Path" })).toHaveFocus();
    await t.user.keyboard("vehicle.make");
    expect(within(editor()).getByRole("combobox", { name: "Path" })).toHaveValue("vehicle.make");
  });
});

describe("issues", () => {
  it("jump-to opens a closed Result cards group first, then the card with the issue", async () => {
    const t = await openBuilder();
    await screen.findByRole("tree", { name: "Result cards" });
    const header = within(nav()).getByRole("button", { name: "Result cards" });
    await t.user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    const store = configDraftStore(t.services);
    const list = cards(t);
    act(() =>
      store.getState().setPath(["responseMappings"], [...list, { ...list[0], id: "veh-copy" }]),
    );
    await t.user.click(
      await screen.findByRole("button", { name: /^1 error.*Go to the first issue\.$/ }),
    );
    await waitFor(() => expect(header).toHaveAttribute("aria-expanded", "true"));
    expect(
      await within(editor()).findByText(/Response mapping veh-copy is defined more than once/),
    ).toBeInTheDocument();
  });
});

describe("issues inside a card (round 1, C1)", () => {
  it("shows a new row's empty-path error at the row, and Go to the first issue opens it and focuses the path", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    await t.user.click(within(editor()).getByRole("button", { name: "Add row" }));
    const path = await within(editor()).findByRole("combobox", { name: "Path" });
    await waitFor(() => expect(path).toHaveAttribute("aria-describedby"));
    const message = editor().querySelector<HTMLElement>('[data-issue-pointer$="/path"]');
    expect(message).not.toBeNull();
    expect(message).toBeVisible();
    // Close the row, then use the issue button: the row opens and the path takes focus.
    await t.user.click(within(editor()).getByRole("button", { name: /^Close/ }));
    expect(within(editor()).queryByRole("combobox", { name: "Path" })).toBeNull();
    await t.user.click(
      await screen.findByRole("button", { name: /^\d+ errors?.*Go to the first issue\.$/ }),
    );
    const again = await within(editor()).findByRole("combobox", { name: "Path" });
    await waitFor(() => expect(again).toHaveFocus());
    expect(
      document.getElementById(again.getAttribute("aria-describedby") ?? "")?.textContent ?? "",
    ).not.toBe("");
  });

  it("shows an issue of a table column at the column's own control", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    await t.user.click(within(editor()).getByRole("button", { name: "Add row" }));
    await within(editor()).findByRole("combobox", { name: "Path" });
    await t.user.click(within(editor()).getByRole("radio", { name: "Table" }));
    const column = await within(editor()).findByRole("textbox", { name: "Path of column 1" });
    await waitFor(() => expect(column).toHaveAttribute("aria-describedby"));
    expect(editor().querySelector('[data-issue-pointer$="/columns/0/path"]')).not.toBeNull();
  });
});

describe("a selection the cards no longer have (round 1, C2)", () => {
  it("shows the type's cards after Add card is undone, never a blank editor", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    await t.user.click(within(editor()).getByRole("button", { name: "Add Vehicle card" }));
    await within(editor()).findByRole("heading", { level: 3, name: /veh-card/ });
    await t.user.click(screen.getByRole("button", { name: /^Undo/ }));
    expect(
      await within(editor()).findByRole("heading", {
        level: 3,
        name: /^Vehicle cards|veh-summary/,
      }),
    ).toBeInTheDocument();
    expect(cards(t).map((c) => c.id)).not.toContain("veh-card");
  });
});

describe("the approved card editor items (round 1, S1)", () => {
  it("lists which card wins for each source and persona, tagging this card", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    const table = await within(editor()).findByRole("table", { name: "Which card wins" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(within(row).getByText("This card")).toBeInTheDocument();
      expect(within(row).getByText(/only card that fits/)).toBeInTheDocument();
    }
  });

  it("names the score when a second card narrows by source", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    await t.user.click(within(editor()).getByRole("button", { name: "Add Vehicle card" }));
    await within(editor()).findByRole("heading", { level: 3, name: /veh-card/ });
    const source = within(editor()).getByRole("combobox", { name: "Source" });
    const first = within(source).getAllByRole("option")[1] as HTMLOptionElement;
    await t.user.selectOptions(source, first.value);
    const table = await within(editor()).findByRole("table", { name: "Which card wins" });
    expect(within(table).getAllByText(/source \+2/).length).toBeGreaterThanOrEqual(1);
  });

  it("makes the card key read-only once the live config has it, and shows the pointer", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    await t.user.click(within(editor()).getByText("Advanced settings"));
    expect(within(editor()).getByRole("textbox", { name: "Card key" })).toHaveAttribute("readonly");
    const advanced = within(editor())
      .getByText("Advanced settings")
      .closest("details") as HTMLElement;
    expect(within(advanced).getByText("/responseMappings/0")).toBeInTheDocument();
    await t.user.click(within(editor()).getByRole("button", { name: "Add Vehicle card" }));
    await within(editor()).findByRole("heading", { level: 3, name: /veh-card/ });
    await t.user.click(within(editor()).getByText("Advanced settings"));
    expect(within(editor()).getByRole("textbox", { name: "Card key" })).not.toHaveAttribute(
      "readonly",
    );
  });

  it("offers Template, and a Format for each table column", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    await t.user.click(within(editor()).getByRole("button", { name: "Add row" }));
    const format = await within(editor()).findByRole("combobox", { name: "Format" });
    await t.user.selectOptions(format, "Template");
    const template = await within(editor()).findByRole("textbox", { name: "Template" });
    await t.user.clear(template);
    await t.user.type(template, "Plate {{value}");
    const veh = cards(t)[0] as unknown as { elements: Record<string, unknown>[] };
    expect(veh.elements.at(-1)?.format).toEqual({ type: "template", template: "Plate {value}" });
    await t.user.click(within(editor()).getByRole("radio", { name: "Table" }));
    const col = await within(editor()).findByRole("combobox", { name: "Format of column 1" });
    await t.user.selectOptions(col, "Upper case");
    const table = (
      cards(t)[0] as unknown as { elements: { columns?: { format?: unknown }[] }[] }
    ).elements.at(-1);
    expect(table?.columns?.[0]?.format).toEqual({ type: "upper" });
  });
});

describe("Review lines", () => {
  it("the Changes view lists the added row under Result cards by card id", async () => {
    const t = await openBuilder();
    await openVehicleCard(t);
    await addMakeRow(t);
    await t.user.click(screen.getByRole("tab", { name: "Changes" }));
    const heading = await screen.findByRole("heading", { level: 4, name: /^Result cards/ });
    const group = heading.closest("section") as HTMLElement;
    expect(within(group).getByText(/Vehicle, card veh-summary/)).toBeInTheDocument();
    expect(within(group).getByText(/Row Make test \(vehicle\.make\)/)).toBeInTheDocument();
  });
});
