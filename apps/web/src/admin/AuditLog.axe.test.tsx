import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { axeViolations } from "../test/axe.js";
import { API, auditPage, CLIENT_CONFIG, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";

beforeAll(preloadAdminRoutes);

// axe in the unit suite (#644; UX-015) over the audit log as the route renders it: the table, its
// filters and paging, in each theme. color-contrast is the e2e suite's (jsdom has no layout).

describe("audit log accessibility", () => {
  it.each(["day", "night", "red-shift"])("has no axe violations in the %s theme", async (theme) => {
    document.documentElement.dataset.theme = theme;
    const user = { ...TEST_USER, role: "admin" };
    server.use(
      http.get(`${API}/api/v1/auth/get-session`, () =>
        HttpResponse.json({ session: { id: "s1" }, user }),
      ),
      http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
      http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json({ users: [] })),
      http.get(`${API}/api/v1/admin/audit`, () => HttpResponse.json(auditPage(3, "next"))),
    );
    renderRoot({ path: "/admin/audit" });
    const table = await screen.findByRole("table", {}, { timeout: 5000 });
    expect(table).toBeInTheDocument();
    expect(await axeViolations(screen.getByRole("main"))).toEqual([]);
  });
});
