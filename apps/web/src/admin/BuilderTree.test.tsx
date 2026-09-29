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
    expect(item(/^terminal$/)).toBeInTheDocument();
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
    const legend = await screen.findByText("Field plateType", { selector: "legend" });
    const box = legend.closest("fieldset") as HTMLElement;
    await waitFor(() => expect(box).toHaveAttribute("data-selected", "true"));
    expect(
      screen.getByText("Query type VEH", { selector: "summary" }).closest("details"),
    ).toHaveAttribute("open");
  });

  it("selecting a site item opens its section; another selection moves the mark", async () => {
    const t = await openBuilder();
    await t.user.click(item(/^Terminal commands/));
    const commands = screen.getByText("commands", { selector: "summary" }).closest("details");
    await waitFor(() => expect(commands).toHaveAttribute("open"));
    await waitFor(() => expect(commands).toHaveAttribute("data-selected", "true"));
    await t.user.click(item(/^terminal$/));
    const terminal = screen.getByText("terminal", { selector: "summary" }).closest("details");
    await waitFor(() => expect(terminal).toHaveAttribute("data-selected", "true"));
    expect(commands).not.toHaveAttribute("data-selected");
    expect(await screen.findByLabelText("terminal.delimiter")).toBeInTheDocument();
  });

  it("selecting an item from the Raw JSON view returns to the form", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    await t.user.click(item(/^Sources/));
    expect(screen.getByRole("tab", { name: "Form" })).toHaveAttribute("aria-selected", "true");
    const sources = screen.getByText("sources", { selector: "summary" }).closest("details");
    await waitFor(() => expect(sources).toHaveAttribute("open"));
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
    await waitFor(() => expect(item(/^Terminal commands, 1 error/)).toBeInTheDocument());
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
      screen.getByText("commands", { selector: "summary" }).closest("details"),
    ).toHaveAttribute("open");
  });
});
