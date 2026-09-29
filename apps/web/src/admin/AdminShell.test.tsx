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

  it("the header Queries link goes back to the query panel from /admin; it is the current page on the panel", async () => {
    const t = await openAs("admin", "/admin/config");
    await screen.findByRole("heading", { name: "Site config", level: 2 });
    const back = within(screen.getByRole("banner")).getByRole("link", { name: "Queries" });
    expect(back).toHaveAttribute("href", "/");
    expect(back).not.toHaveAttribute("aria-current");
    await t.user.click(back);
    expect(await screen.findByRole("heading", { name: /^Query Module$/ })).toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).getByRole("link", { name: "Queries" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("the Config and Users links are a nav bar: the open section is aria-current", async () => {
    const t = await openAs("admin", "/admin/config");
    await screen.findByRole("heading", { name: "Site config", level: 2 });
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: "Config" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Users" })).not.toHaveAttribute("aria-current");
    await t.user.click(within(nav).getByRole("link", { name: "Users" }));
    await screen.findByRole("heading", { name: "Users", level: 2 });
    expect(within(nav).getByRole("link", { name: "Users" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Config" })).not.toHaveAttribute("aria-current");
  });

  it("a user at /admin gets the query panel, as for any unknown path", async () => {
    await openAs("user", "/admin/config");
    expect(await screen.findByRole("heading", { name: /^Query Module$/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Admin" })).toBeNull();
  });

  it("an admin opens the console from the header; Config and Users are listed", async () => {
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
    const heading = await screen.findByRole("heading", { name: "Site config", level: 2 });
    await waitFor(() => expect(heading).toHaveFocus());
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: "Config" })).toHaveAttribute(
      "href",
      "/admin/config",
    );
    expect(within(nav).getByRole("link", { name: "Users" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
    expect(
      await screen.findByRole("heading", { name: "Site config", level: 2 }),
    ).toBeInTheDocument();
  });

  it("an implementer has the Admin link and Config only; /admin/users goes to Config", async () => {
    await openAs("implementer", "/admin/users");
    expect(
      await screen.findByRole("heading", { name: "Site config", level: 2 }),
    ).toBeInTheDocument();
    expect(adminLink()).not.toBeNull();
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: "Config" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Users" })).toBeNull();
  });

  it("moving between sections focuses the section heading", async () => {
    const t = await openAs("admin", "/admin/config");
    await screen.findByRole("heading", { name: "Site config", level: 2 });
    await t.user.click(screen.getByRole("link", { name: "Users" }));
    const users = await screen.findByRole("heading", { name: "Users", level: 2 });
    await waitFor(() => expect(users).toHaveFocus());
  });
});
