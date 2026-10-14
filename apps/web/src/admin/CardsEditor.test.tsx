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
