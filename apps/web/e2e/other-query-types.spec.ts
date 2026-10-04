import { expect, test } from "./fixtures.js";
import { chooseQueryType, liveResponse, signIn } from "./helpers.js";

// C5 (#382): chooseQueryType has two branches, the quick-access button and the "Other query types"
// select (ADR-0010). Every shipped site lists its types in quick access, so this serves the live
// config with only VEH there, which leaves PER to the select.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/config", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await liveResponse(route);
    const live = (await response.json()) as Record<string, unknown>;
    return route.fulfill({ json: { ...live, quickAccess: ["VEH"] } });
  });
});

test("a type outside quick access is picked from the Other query types select (ADR-0010)", async ({
  page,
}) => {
  await signIn(page);
  const nav = page.getByRole("group", { name: "Quick access" });
  await expect(nav.getByRole("button", { name: "Person" })).toHaveCount(0);
  await chooseQueryType(page, "PER");
  await expect(page.getByLabel("Last name")).toBeVisible();
  // The select holds the pick and no quick-access button is pressed for it.
  await expect(page.getByLabel("Other query types")).toHaveValue("PER");
  await expect(nav.getByRole("button", { name: "Vehicle" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
