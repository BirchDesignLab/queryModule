import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { findSetting } from "../test/builder-tree.js";
import { escapeRegExp } from "../test/escape-regexp.js";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

// A-D1 A2 (design target 09-29-26): the builder tree selects what the editor shows.

async function openBuilder() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}

type Opened = Awaited<ReturnType<typeof openBuilder>>;
const tree = () => screen.getByRole("navigation", { name: "Configuration items" });
const item = (name: string | RegExp) => within(tree()).getByRole("treeitem", { name });

describe("builder tree (A-D1 A2, FR-060, UX-004)", () => {
  it("lists query types with their sections and fields, then the site items", async () => {
    await openBuilder();
    const vehicle = item(/^Vehicle VEH/);
    const typeRow = vehicle.closest("li") as HTMLElement;
    expect(within(typeRow).getByRole("treeitem", { name: /^More details/ })).toBeInTheDocument();
    expect(
      within(typeRow).getByRole("treeitem", { name: /^Plate type plateType/ }),
    ).toBeInTheDocument();
    for (const name of [
      "Terminal commands",
      "Quick access",
      "Lists",
      "Sources",
      "Theme",
      "Labels and translations",
    ])
      expect(item(new RegExp(`^${escapeRegExp(name)}`))).toBeInTheDocument();
    // Every site item has a plain name with its key in mono; schemaVersion is not a setting.
    expect(item(/^Terminal settings terminal$/)).toBeInTheDocument();
    expect(item(/^Keyword styles keywordSeverityStyles$/)).toBeInTheDocument();
    expect(within(tree()).queryByRole("treeitem", { name: /schemaVersion/ })).toBeNull();
    expect(within(tree()).getByText(/^Server settings: available after/)).toBeInTheDocument();
  });

  it("only the selected query type is expanded; the others toggle with aria-expanded", async () => {
    const t = await openBuilder();
    const vehicle = item(/^Vehicle VEH/);
    const person = item(/^Person PER/);
    expect(vehicle).toHaveAttribute("aria-expanded", "true");
    expect(person).toHaveAttribute("aria-expanded", "false");
    expect(within(tree()).queryByRole("treeitem", { name: /^Last name last/ })).toBeNull();
    await t.user.click(person);
    expect(person).toHaveAttribute("aria-expanded", "true");
    expect(within(tree()).getAllByRole("treeitem", { name: /^Last name last/ })).toHaveLength(1);
  });

  it("the editor shows only the selected item: the first query type before any selection", async () => {
    await openBuilder();
    const form = screen.getByTestId("form-tab");
    expect(
      // A3: the heading is the type itself, under a Query types crumb.
      within(form).getByRole("heading", { name: /^Vehicle VEH/, level: 3 }),
    ).toBeInTheDocument();
    expect(within(form).getByText("Query type VEH", { selector: "legend" })).toBeInTheDocument();
    expect(within(form).queryByText("Query type PER", { selector: "legend" })).toBeNull();
    expect(form.querySelectorAll("h3")).toHaveLength(1);
    expect(item(/^Vehicle VEH/)).toHaveAttribute("aria-selected", "true");
  });

  it("comes before the editor in the DOM, so Tab from the tree reaches the editor", async () => {
    await openBuilder();
    const panel = screen.getByRole("tabpanel");
    expect(tree().compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("selecting a field keeps focus in the tree, opens its type and marks the field", async () => {
    const t = await openBuilder();
    const field = item(/^Plate type plateType/);
    await t.user.click(field);
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-selected", "true");
    const others = within(tree())
      .getAllByRole("treeitem")
      .filter((b) => b !== field && b.getAttribute("aria-selected") === "true");
    expect(others).toEqual([]);
    // A3: a field's legend is its label; the key follows in hidden text.
    const legend = await screen.findByText(
      (_, el) => el?.tagName === "LEGEND" && /field plateType$/.test(el.textContent ?? ""),
    );
    const box = legend.closest("fieldset") as HTMLElement;
    await waitFor(() => expect(box).toHaveAttribute("data-selected", "true"));
    expect(screen.getByText("Query type VEH", { selector: "legend" })).toBeInTheDocument();
  });

  it("selecting a site item shows just that section", async () => {
    const t = await openBuilder();
    await t.user.click(item(/^Terminal commands/));
    const heading = await screen.findByRole("heading", {
      name: /^Terminal commands commands/,
      level: 3,
    });
    // The editor shows only this item, so the item itself is not tinted (only a part inside is).
    expect(heading.closest("section")).not.toHaveAttribute("data-selected");
    await t.user.click(item(/^Terminal settings terminal/));
    expect(await findSetting("terminal.delimiter")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Terminal commands/, level: 3 })).toBeNull();
    expect(screen.queryByText("Query type VEH", { selector: "legend" })).toBeNull();
  });

  it("selecting an item from the Raw JSON view returns to the form", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    await t.user.click(item(/^Sources/));
    expect(screen.getByRole("tab", { name: "Form" })).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByRole("heading", { name: /^Sources sources/, level: 3 }),
    ).toBeInTheDocument();
  });

  it("search filters on label and key, keeps ancestors, and says when nothing matches", async () => {
    const t = await openBuilder();
    const search = within(tree()).getByRole("searchbox", { name: "Find a field or setting" });
    await t.user.type(search, "platety");
    expect(item(/^Plate type plateType/)).toBeInTheDocument();
    expect(item(/^Vehicle VEH/)).toBeInTheDocument();
    expect(within(tree()).queryByRole("treeitem", { name: /^Person PER/ })).toBeNull();
    expect(within(tree()).queryByRole("treeitem", { name: /^Terminal commands/ })).toBeNull();
    await t.user.clear(search);
    await t.user.type(search, "Plate col");
    expect(item(/^Plate color plateColor/)).toBeInTheDocument();
    await t.user.clear(search);
    await t.user.type(search, "zzqx");
    expect(within(tree()).getByText("No matches for “zzqx”")).toBeInTheDocument();
    await t.user.click(within(tree()).getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(item(/^Person PER/)).toBeInTheDocument();
  });

  it("issue marks: a number badge per row, the count in words for screen readers, rolled up", async () => {
    const t = await openBuilder();
    const summary = screen.getByTestId("draft-summary");
    await waitFor(() => expect(summary).toHaveTextContent(/Draft checks: \d+ errors/));
    const store = configDraftStore(t.services);
    const doc = store.getState().doc as { commands: { code: string }[] };
    const i = doc.commands.findIndex((c) => c.code === "VEH");
    act(() => store.getState().setPath(["commands", i, "code"], "V.EH"));
    await waitFor(() => expect(item(/^Terminal commands commands, 1 error/)).toBeInTheDocument());
    const badge = item(/^Terminal commands/).querySelector(".qm-tree__issues") as HTMLElement;
    expect(badge).toHaveTextContent(/^1$/);
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(badge).toHaveClass("qm-badge--critical");
    // The toolbar total is the sum of the top-level rows (types and site items).
    const [, errors, warnings] =
      /(\d+) errors, (\d+) warnings/.exec(summary.textContent ?? "") ?? [];
    const rows = [
      ...tree().querySelectorAll("[role=tree] > li > [role=treeitem]"),
    ] as HTMLElement[];
    const sum = rows.reduce(
      (n, b) => n + Number(b.querySelector(".qm-tree__issues")?.textContent ?? 0),
      0,
    );
    expect(sum).toBe(Number(errors) + Number(warnings));
  });

  it("the issue button goes to the first error: it opens the item and focuses its control", async () => {
    const t = await openBuilder();
    const summary = screen.getByTestId("draft-summary");
    await waitFor(() => expect(summary).toHaveTextContent(/Draft checks: 0 errors/));
    const store = configDraftStore(t.services);
    const doc = store.getState().doc as { commands: { code: string }[] };
    const i = doc.commands.findIndex((c) => c.code === "VEH");
    act(() => store.getState().setPath(["commands", i, "code"], "V.EH"));
    const button = await screen.findByRole("button", {
      name: /^1 error, \d+ warnings?\. Go to the first issue\.$/,
    });
    await t.user.click(button);
    await waitFor(() => expect(document.activeElement).toHaveValue("V.EH"));
    expect(document.activeElement).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByRole("heading", { name: /^Terminal commands commands/, level: 3 }),
    ).toBeInTheDocument();
  });

  it("a whole-config issue (a missing required key) is counted, listed, and the issue button focuses its message", async () => {
    const t = await openBuilder();
    const summary = screen.getByTestId("draft-summary");
    await waitFor(() => expect(summary).toHaveTextContent(/Draft checks: 0 errors/));
    const store = configDraftStore(t.services);
    act(() => {
      const d = structuredClone(store.getState().doc) as Record<string, unknown>;
      delete d.site;
      store.getState().setDoc(d as never);
    });
    await waitFor(() => expect(summary).toHaveTextContent(/Draft checks: [1-9]\d* errors/));
    // The tree lists whole-config issues, so its rows still add up to the total.
    const [, errors, warnings] =
      /(\d+) errors, (\d+) warnings/.exec(summary.textContent ?? "") ?? [];
    const rows = [...tree().querySelectorAll("[role=tree] > li > [role=treeitem], .qm-tree__root")];
    const sum = rows.reduce(
      (n, b) => n + Number(b.querySelector(".qm-tree__issues")?.textContent ?? 0),
      0,
    );
    expect(sum).toBe(Number(errors) + Number(warnings));
    await t.user.click(screen.getByRole("button", { name: /Go to the first issue\.$/ }));
    // The editor keeps its item; focus lands on the whole-config messages.
    expect(screen.getByText("Query type VEH", { selector: "legend" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-root-issues"));
    expect(document.activeElement?.querySelector('[data-issue-pointer="/site"]')).not.toBeNull();
  });

  it("a schemaVersion issue shows with the whole-config messages (the key is hidden)", async () => {
    const t = await openBuilder();
    const store = configDraftStore(t.services);
    act(() => store.getState().setPath(["schemaVersion"], 99));
    const root = await waitFor(() => {
      const el = document.querySelector("[data-root-issues]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await waitFor(() => expect(root.textContent).not.toBe(""));
  });

  it("a selection that no longer exists moves to what does, in the tree and the editor", async () => {
    const t = await openBuilder();
    await t.user.click(item(/^Wanted check WNT/));
    const store = configDraftStore(t.services);
    act(() => {
      const d = structuredClone(store.getState().doc) as { queryTypes: unknown[] };
      d.queryTypes.splice(3, 2);
      store.getState().setDoc(d as never);
    });
    await waitFor(() => expect(item(/^Property PRO/)).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByText("Query type PRO", { selector: "legend" })).toBeInTheDocument();
  });

  it("adding a query type selects it and focuses its code", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("button", { name: "Add query type" }));
    const legend = await screen.findByText(/^Query type\s*$/, { selector: "legend" });
    const code = within(legend.closest("fieldset") as HTMLElement).getByRole("textbox", {
      name: "Code",
    });
    await waitFor(() => expect(code).toHaveFocus());
    expect(
      within(tree())
        .getAllByRole("treeitem")
        .filter((b) => b.getAttribute("aria-selected") === "true"),
    ).toHaveLength(1);
  });
});

describe("builder tree keyboard (B1, WAI-ARIA tree pattern)", () => {
  /** The rows on screen in reading order, and the one after or before `el`. */
  const rows = () => within(tree()).getAllByRole("treeitem");
  const after = (el: HTMLElement) => rows()[rows().indexOf(el) + 1] as HTMLElement;
  const focusItem = (name: string | RegExp) => {
    const el = item(name);
    act(() => el.focus());
    return el;
  };

  it("is two trees of treeitems with levels, expansion and selection, and groups for children", async () => {
    await openBuilder();
    const trees = within(tree()).getAllByRole("tree");
    expect(trees.map((x) => x.getAttribute("aria-labelledby"))).toHaveLength(2);
    expect(within(tree()).getByRole("tree", { name: "Query types" })).toBeInTheDocument();
    expect(within(tree()).getByRole("tree", { name: "Site" })).toBeInTheDocument();
    const vehicle = item(/^Vehicle VEH/);
    expect(vehicle).toHaveAttribute("aria-level", "1");
    expect(vehicle).toHaveAttribute("aria-expanded", "true");
    expect(vehicle).toHaveAttribute("aria-selected", "true");
    const section = item(/^More details/);
    expect(section).toHaveAttribute("aria-level", "2");
    // A section cannot close, so it reports itself open.
    expect(section).toHaveAttribute("aria-expanded", "true");
    const field = item(/^Plate type plateType/);
    expect(field).toHaveAttribute("aria-level", "3");
    expect(field).not.toHaveAttribute("aria-expanded");
    expect(field).toHaveAttribute("aria-selected", "false");
    expect(item(/^Person PER/)).toHaveAttribute("aria-expanded", "false");
    expect(item(/^Sources/)).not.toHaveAttribute("aria-expanded");
    // A parent owns its group, and a row is named by its own text, not by the rows under it.
    const groupId = vehicle.getAttribute("aria-owns") as string;
    expect(document.getElementById(groupId)).toHaveAttribute("role", "group");
    expect(vehicle.getAttribute("aria-labelledby")).toMatch(/-name$/);
    expect(vehicle).toHaveAccessibleName(/^Vehicle VEH/);
    expect(vehicle.getAttribute("aria-label")).toBeNull();
  });

  it("one Tab stop for both trees: the selected row, so Tab re-enters where the selection is", async () => {
    const t = await openBuilder();
    const stops = () =>
      within(tree())
        .getAllByRole("treeitem")
        .filter((x) => x.getAttribute("tabindex") === "0");
    expect(stops()).toEqual([item(/^Vehicle VEH/)]);
    await t.user.click(within(tree()).getByRole("searchbox", { name: "Find a field or setting" }));
    await t.user.tab();
    expect(item(/^Vehicle VEH/)).toHaveFocus();
    // Browsing to another row does not move the stop; selecting does.
    focusItem(/^Sources/);
    expect(stops()).toEqual([item(/^Vehicle VEH/)]);
    await t.user.keyboard("{Enter}");
    expect(stops()).toEqual([item(/^Sources/)]);
    expect(stops()).toHaveLength(1);
  });

  it("a selection made outside the tree becomes the Tab stop", async () => {
    const t = await openBuilder();
    focusItem(/^Sources/);
    await t.user.click(screen.getByRole("button", { name: "Add query type" }));
    const stops = within(tree())
      .getAllByRole("treeitem")
      .filter((x) => x.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAttribute("aria-selected", "true");
    expect(item(/^Sources/)).toHaveAttribute("tabindex", "-1");
  });

  it("Down and Up move through the rows without selecting, across both trees", async () => {
    const t = await openBuilder();
    const vehicle = focusItem(/^Vehicle VEH/);
    const next = after(vehicle);
    await t.user.keyboard("{ArrowDown}");
    expect(next).toHaveFocus();
    await t.user.keyboard("{ArrowUp}");
    expect(vehicle).toHaveFocus();
    await t.user.keyboard("{ArrowUp}");
    expect(vehicle).toHaveFocus();
    // From the last query type, Down goes on to the first site item.
    const types = within(tree()).getByRole("tree", { name: "Query types" });
    const lastType = [...types.querySelectorAll<HTMLElement>('[role="treeitem"]')].at(
      -1,
    ) as HTMLElement;
    act(() => lastType.focus());
    await t.user.keyboard("{ArrowDown}");
    const site = within(tree()).getByRole("tree", { name: "Site" });
    expect(site.querySelector('[role="treeitem"]')).toHaveFocus();
    // Moving never selects: Vehicle is still the selected row.
    expect(item(/^Vehicle VEH/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Query type VEH", { selector: "legend" })).toBeInTheDocument();
  });

  it("Right opens a closed type then steps in; Left steps out then closes", async () => {
    const t = await openBuilder();
    const person = focusItem(/^Person PER/);
    await t.user.keyboard("{ArrowRight}");
    expect(person).toHaveAttribute("aria-expanded", "true");
    expect(person).toHaveFocus();
    const firstChild = after(person);
    expect(firstChild).toHaveAttribute("aria-level", "2");
    await t.user.keyboard("{ArrowRight}");
    expect(firstChild).toHaveFocus();
    await t.user.keyboard("{ArrowLeft}");
    expect(person).toHaveFocus();
    await t.user.keyboard("{ArrowLeft}");
    expect(person).toHaveAttribute("aria-expanded", "false");
    expect(within(tree()).queryByRole("treeitem", { name: /^Last name last/ })).toBeNull();
    // Opening and closing never select.
    expect(item(/^Vehicle VEH/)).toHaveAttribute("aria-selected", "true");
  });

  it("Left on a section goes to its type; Left on a top-level leaf does nothing", async () => {
    const t = await openBuilder();
    focusItem(/^More details/);
    await t.user.keyboard("{ArrowLeft}");
    expect(item(/^Vehicle VEH/)).toHaveFocus();
    const sources = focusItem(/^Sources/);
    await t.user.keyboard("{ArrowLeft}{ArrowRight}");
    expect(sources).toHaveFocus();
  });

  it("Home and End go to the first and last row of the tree they are in", async () => {
    const t = await openBuilder();
    focusItem(/^Plate type plateType/);
    await t.user.keyboard("{Home}");
    expect(item(/^Vehicle VEH/)).toHaveFocus();
    await t.user.keyboard("{End}");
    const types = within(tree()).getByRole("tree", { name: "Query types" });
    const last = [...types.querySelectorAll('[role="treeitem"]')].at(-1);
    expect(last).toHaveFocus();
    focusItem(/^Sources/);
    await t.user.keyboard("{End}");
    const site = within(tree()).getByRole("tree", { name: "Site" });
    expect([...site.querySelectorAll('[role="treeitem"]')].at(-1)).toHaveFocus();
    await t.user.keyboard("{Home}");
    expect([...site.querySelectorAll('[role="treeitem"]')][0]).toHaveFocus();
  });

  it("Enter and Space select the row, and focus stays on it", async () => {
    const t = await openBuilder();
    const sources = focusItem(/^Sources/);
    await t.user.keyboard("{Enter}");
    expect(sources).toHaveAttribute("aria-selected", "true");
    expect(sources).toHaveFocus();
    expect(
      await screen.findByRole("heading", { name: /^Sources sources/, level: 3 }),
    ).toBeInTheDocument();
    const theme = focusItem(/^Theme/);
    await t.user.keyboard(" ");
    expect(theme).toHaveAttribute("aria-selected", "true");
    expect(sources).toHaveAttribute("aria-selected", "false");
  });

  it("a letter jumps to the next row starting with it", async () => {
    const t = await openBuilder();
    focusItem(/^Vehicle VEH/);
    await t.user.keyboard("q");
    expect(item(/^Quick access/)).toHaveFocus();
    await t.user.keyboard("t");
    expect(item(/^Theme/)).toHaveFocus();
    const there = document.activeElement;
    // Ctrl+letter is not type-ahead.
    await t.user.keyboard("{Control>}q{/Control}");
    expect(document.activeElement).toBe(there);
  });

  /** Breaks a command code: an issue badge appears on the commands row, so rows re-render. */
  async function breakCommand(t: Opened) {
    const store = configDraftStore(t.services);
    const doc = store.getState().doc as { commands: { code: string }[] };
    const i = doc.commands.findIndex((c) => c.code === "VEH");
    act(() => store.getState().setPath(["commands", i, "code"], "V.EH"));
    await waitFor(() => expect(item(/^Terminal commands commands, 1 error/)).toBeInTheDocument());
  }

  it("focus stays on the row across a draft change that re-renders the rows", async () => {
    const t = await openBuilder();
    const field = focusItem(/^Plate type plateType/);
    await breakCommand(t);
    expect(item(/^Plate type plateType/)).toBe(field);
    expect(field).toHaveFocus();
  });

  it("a focused row that goes away hands focus to the row before it in its tree, not the top of the tree", async () => {
    const t = await openBuilder();
    // Wanted check and Driver's license are the last two types: remove them under the focus.
    focusItem(/^Wanted check WNT/);
    const store = configDraftStore(t.services);
    act(() => {
      const d = structuredClone(store.getState().doc) as { queryTypes: unknown[] };
      d.queryTypes.splice(3, 2);
      store.getState().setDoc(d as never);
    });
    await waitFor(() =>
      expect(within(tree()).queryByRole("treeitem", { name: /^Wanted/ })).toBeNull(),
    );
    await waitFor(() => expect(item(/^Property PRO/)).toHaveFocus());
  });

  it("with the last site item gone, the site item before it has focus", async () => {
    const t = await openBuilder();
    const site = within(tree()).getByRole("tree", { name: "Site" });
    const last = [...site.querySelectorAll<HTMLElement>('[role="treeitem"]')].at(-1) as HTMLElement;
    act(() => last.focus());
    const store = configDraftStore(t.services);
    act(() => {
      const d = structuredClone(store.getState().doc) as Record<string, unknown>;
      // Remove the last config key: its row (the one before Labels and translations) goes.
      const keys = Object.keys(d).filter((k) => k !== "queryTypes" && k !== "schemaVersion");
      delete d[keys.at(-1) as string];
      store.getState().setDoc(d as never);
    });
    await waitFor(() => expect(tree()).toContainElement(document.activeElement as HTMLElement));
    expect(document.activeElement).not.toBe(item(/^Vehicle VEH/));
    expect(site.contains(document.activeElement)).toBe(true);
  });

  it("a change never takes focus that is in the editor", async () => {
    const t = await openBuilder();
    const editor = screen.getByRole("tabpanel");
    const input = (await within(editor).findAllByRole("textbox"))[0] as HTMLElement;
    act(() => input.focus());
    await breakCommand(t);
    expect(input).toHaveFocus();
  });

  it("a mouse click on the + or - of a type opens or closes it without selecting; a click on the name selects", async () => {
    const t = await openBuilder();
    const person = item(/^Person PER/);
    await t.user.click(person.querySelector(".qm-tree__toggle") as HTMLElement);
    expect(person).toHaveAttribute("aria-expanded", "true");
    expect(person).toHaveAttribute("aria-selected", "false");
    await t.user.click(person.querySelector(".qm-tree__toggle") as HTMLElement);
    expect(person).toHaveAttribute("aria-expanded", "false");
    await t.user.click(person);
    expect(person).toHaveAttribute("aria-selected", "true");
    expect(person).toHaveAttribute("aria-expanded", "true");
  });

  it("a search holds every match open, so Left cannot close a type and Right does nothing new", async () => {
    const t = await openBuilder();
    await t.user.type(
      within(tree()).getByRole("searchbox", { name: "Find a field or setting" }),
      "plate",
    );
    const vehicle = focusItem(/^Vehicle VEH/);
    await t.user.keyboard("{ArrowLeft}");
    expect(vehicle).toHaveAttribute("aria-expanded", "true");
  });
});
