import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";

/** Opens the app at `path` with a live session for TEST_USER in the given role (Task 30). */
async function openAs(role: string, path: string) {
  const user = { ...TEST_USER, role };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
  );
  const t = renderRoot({ path });
  await screen.findByRole("banner");
  return t;
}

const adminLink = () => within(screen.getByRole("banner")).queryByRole("link", { name: "Admin" });

describe("ADR-0011 admin shell (Task 30, BR-001, FR-060)", () => {
  it("a user sees no Admin link", async () => {
    await openAs("user", "/");
    await screen.findByRole("heading", { name: /^Query Module$/ });
    expect(adminLink()).toBeNull();
  });

  it("the header links back to the query panel from /admin, and not on the panel itself", async () => {
    const t = await openAs("admin", "/admin/config");
    await screen.findByRole("heading", { name: "Site configuration", level: 2 });
    const back = within(screen.getByRole("banner")).getByRole("link", { name: "Query panel" });
    expect(back).toHaveAttribute("href", "/");
    await t.user.click(back);
    expect(await screen.findByRole("heading", { name: /^Query Module$/ })).toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).queryByRole("link", { name: "Query panel" }),
    ).toBeNull();
  });

  it("the rail links are the admin sections: the open one is aria-current", async () => {
    const t = await openAs("admin", "/admin/config");
    await screen.findByRole("heading", { name: "Site configuration", level: 2 });
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: "Site configuration" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Users and roles" })).not.toHaveAttribute(
      "aria-current",
    );
    await t.user.click(within(nav).getByRole("link", { name: "Users and roles" }));
    await screen.findByRole("heading", { name: "Users and roles", level: 2 });
    expect(within(nav).getByRole("link", { name: "Users and roles" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Site configuration" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("the rail leads with Back to queries, then the sections, then the audit log with its reason", async () => {
    const t = await openAs("admin", "/admin/config");
    await screen.findByRole("heading", { name: "Site configuration", level: 2 });
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    const items = [...nav.querySelectorAll("a, button")];
    expect(items.map((el) => el.textContent)).toEqual([
      "Back to queries",
      "Site configuration",
      "Users and roles",
      "Audit log",
    ]);
    expect(within(nav).getByText("Configure")).toBeInTheDocument();
    expect(within(nav).getByText("People")).toBeInTheDocument();
    const audit = within(nav).getByRole("button", { name: "Audit log" });
    expect(audit).toHaveAttribute("aria-disabled", "true");
    expect(audit).toHaveAccessibleDescription("Arrives in M2");
    audit.focus();
    expect(audit).toHaveFocus();
    await t.user.click(audit);
    expect(
      screen.getByRole("heading", { name: "Site configuration", level: 2 }),
    ).toBeInTheDocument();
    await t.user.click(within(nav).getByRole("link", { name: "Back to queries" }));
    expect(await screen.findByRole("heading", { name: /^Query Module$/ })).toBeInTheDocument();
  });

  it("an implementer's rail has no People group", async () => {
    await openAs("implementer", "/admin/config");
    await screen.findByRole("heading", { name: "Site configuration", level: 2 });
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).queryByText("People")).toBeNull();
    expect(within(nav).queryByRole("button", { name: "Audit log" })).toBeNull();
  });

  it("a user at /admin gets the query panel, as for any unknown path", async () => {
    await openAs("user", "/admin/config");
    expect(await screen.findByRole("heading", { name: /^Query Module$/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Admin" })).toBeNull();
  });

  it("an admin opens the console from the header; both sections are listed", async () => {
    const t = await openAs("admin", "/");
    const link = await waitFor(() => {
      const l = adminLink();
      expect(l).not.toBeNull();
      return l as HTMLElement;
    });
    expect(link).toHaveAttribute("href", "/admin");
    await t.user.click(link);
    // #388: /admin opens its Config section, whose heading takes focus (no h1/h2 race).
    expect(await screen.findByRole("heading", { name: "Admin", level: 1 })).toBeInTheDocument();
    const heading = await screen.findByRole("heading", { name: "Site configuration", level: 2 });
    await waitFor(() => expect(heading).toHaveFocus());
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: "Site configuration" })).toHaveAttribute(
      "href",
      "/admin/config",
    );
    expect(within(nav).getByRole("link", { name: "Users and roles" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
    expect(
      await screen.findByRole("heading", { name: "Site configuration", level: 2 }),
    ).toBeInTheDocument();
  });

  it("an implementer has the Admin link and Site configuration only; /admin/users goes there", async () => {
    await openAs("implementer", "/admin/users");
    expect(
      await screen.findByRole("heading", { name: "Site configuration", level: 2 }),
    ).toBeInTheDocument();
    expect(adminLink()).not.toBeNull();
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: "Site configuration" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Users and roles" })).toBeNull();
  });

  it("moving between sections focuses the section heading", async () => {
    const t = await openAs("admin", "/admin/config");
    await screen.findByRole("heading", { name: "Site configuration", level: 2 });
    await t.user.click(screen.getByRole("link", { name: "Users and roles" }));
    const users = await screen.findByRole("heading", { name: "Users and roles", level: 2 });
    await waitFor(() => expect(users).toHaveFocus());
  });
});
