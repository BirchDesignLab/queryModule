import { screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { axeViolations } from "../test/axe.js";
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

beforeAll(preloadAdminRoutes);

// axe in the unit suite (#644; T10-1, T11-1; UX-015): the card editor as the builder route renders
// it, through the public CardsEditor only, so a split of its internals leaves this file alone.
// color-contrast is the e2e suite's (jsdom has no layout). Synthetic fixtures only.

async function openVehicleCard() {
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
  const nav = screen.getByRole("navigation", { name: "Configuration items" });
  const tree = await within(nav).findByRole("tree", { name: "Result cards" });
  await t.user.click(within(tree).getByRole("treeitem", { name: /^Vehicle cards$/ }));
  await t.user.click(
    await within(tree).findByRole("treeitem", { name: /^1\. All results veh-summary/ }),
  );
  const editor = screen.getByTestId("form-tab");
  await within(editor).findByRole("heading", { level: 3, name: /^Vehicle: All results/ });
  return editor;
}

describe("the card editor passes axe (#644)", () => {
  it("has no axe violations with a vehicle card open", async () => {
    const editor = await openVehicleCard();
    expect(await axeViolations(editor)).toEqual([]);
  }, 30_000);
});
