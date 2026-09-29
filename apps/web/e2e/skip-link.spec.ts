import { expect, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

const inMain = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.querySelector("main")?.contains(document.activeElement) ?? false);

test.describe("tab order and focus on the signed-in panel (spec 6.4)", () => {
  test("after sign-in focus is on the panel heading and the next Tab is the first quick access button", async ({
    page,
  }) => {
    await signIn(page);
    const nav = page.getByRole("navigation", { name: "Quick access" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("heading", { name: "Query Module", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(nav.getByRole("button").first()).toBeFocused();
  });

  test("browser Back to the panel from /status puts focus on the panel heading", async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole("link", { name: "Connection status" }).click();
    await expect(page).toHaveURL(/\/status$/);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Query Module", exact: true })).toBeFocused();
  });

  test("on a fresh load the first Tab is Skip to query; activating it moves focus into the panel", async ({
    page,
  }) => {
    await signIn(page);
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to query" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#qm-main")).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await inMain(page)).toBe(true);
  });
});
