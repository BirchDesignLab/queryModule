import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
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

const tree = () => screen.getByRole("navigation", { name: "Configuration items" });
const item = (name: string | RegExp) => within(tree()).getByRole("button", { name });

describe("builder tree (A-D1 A2, FR-060, UX-004)", () => {
  it("lists query types with their sections and fields, then the site items", async () => {
    await openBuilder();
    const vehicle = item(/^Vehicle VEH/);
    const typeRow = vehicle.closest("li") as HTMLElement;
    expect(within(typeRow).getByRole("button", { name: /^More details/ })).toBeInTheDocument();
    expect(
      within(typeRow).getByRole("button", { name: /^Plate type plateType/ }),
    ).toBeInTheDocument();
    for (const name of [
      "Terminal commands",
      "Quick access",
      "Lists",
      "Sources",
      "Theme",
      "Labels and translations",
    ])
      expect(item(new RegExp(`^${name}`))).toBeInTheDocument();
    // Every site item has a plain name with its key in mono; schemaVersion is not a setting.
    expect(item(/^Terminal settings terminal$/)).toBeInTheDocument();
    expect(item(/^Keyword styles keywordSeverityStyles$/)).toBeInTheDocument();
    expect(within(tree()).queryByRole("button", { name: /schemaVersion/ })).toBeNull();
    expect(within(tree()).getByText(/^Server settings: available after/)).toBeInTheDocument();
  });

  it("only the selected query type is expanded; the others toggle with aria-expanded", async () => {
    const t = await openBuilder();
    const vehicle = within(tree()).getByRole("button", { name: "Vehicle sections and fields" });
    const person = within(tree()).getByRole("button", { name: "Person sections and fields" });
    expect(vehicle).toHaveAttribute("aria-expanded", "true");
    expect(person).toHaveAttribute("aria-expanded", "false");
    expect(within(tree()).queryByRole("button", { name: /^Last name last/ })).toBeNull();
    await t.user.click(person);
    expect(person).toHaveAttribute("aria-expanded", "true");
    expect(within(tree()).getAllByRole("button", { name: /^Last name last/ })).toHaveLength(1);
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
    expect(item(/^Vehicle VEH/)).toHaveAttribute("aria-current", "true");
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
    expect(field).toHaveAttribute("aria-current", "true");
    const others = within(tree())
      .getAllByRole("button")
      .filter((b) => b !== field && b.getAttribute("aria-current") === "true");
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
    expect(await screen.findByLabelText(/ terminal\.delimiter$/)).toBeInTheDocument();
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
    expect(within(tree()).queryByRole("button", { name: /^Person PER/ })).toBeNull();
    expect(within(tree()).queryByRole("button", { name: /^Terminal commands/ })).toBeNull();
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
    const rows = [...tree().querySelectorAll("ul[aria-labelledby] > li > button")] as HTMLElement[];
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
    const rows = [...tree().querySelectorAll("ul[aria-labelledby] > li > button, .qm-tree__root")];
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
    await waitFor(() => expect(item(/^Property PRO/)).toHaveAttribute("aria-current", "true"));
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
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-current") === "true"),
    ).toHaveLength(1);
  });
});
