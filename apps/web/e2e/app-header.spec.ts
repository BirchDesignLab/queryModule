import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { chooseTheme, openAccountMenu, signIn } from "./helpers.js";

// B1 app shell and header (docs/design/2026-09-29-visual-system.md, app shell): a 52 px bar with
// the Main nav and an account disclosure that holds the theme choice and sign out.
test.describe("B1 app header (dispatch layout)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("52 px bar, Queries is the current page, Status goes to /status and Queries back", async ({
    page,
  }) => {
    await signIn(page);
    const header = page.getByRole("banner");
    const box = await header.boundingBox();
    expect(Math.round(box?.height ?? 0)).toBe(52);
    const nav = header.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Queries" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await nav.getByRole("link", { name: "Status" }).click();
    await expect(page).toHaveURL(/\/status$/);
    await expect(nav.getByRole("link", { name: "Status" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Queries" }).click();
    await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });

  test("the account disclosure opens, passes axe, changes theme, and Esc returns focus", async ({
    page,
  }) => {
    await signIn(page);
    const button = page.getByRole("banner").locator(".qm-account__button");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    const panel = await openAccountMenu(page);
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("account-menu.png") });
    await expectNoSeriousAxeViolations(page);
    await chooseTheme(page, "night");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await openAccountMenu(page);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
    // A theme choice is a saved preference: put it back and wait for the PUT to land.
    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/v1/me/preferences") && r.request().method() === "PUT" && r.ok(),
    );
    await chooseTheme(page, "auto");
    await saved;
  });
});
