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

  test("a page opened while the preferences load is still pending is not replaced by the panel", async ({
    page,
  }) => {
    let served = false;
    await page.route("**/api/v1/me/preferences*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
      served = true;
    });
    await signIn(page);
    await page.getByRole("link", { name: "Connection status" }).click();
    await expect(page).toHaveURL(/\/status$/);
    await expect.poll(() => served).toBe(true);
    // The sign-in continuation runs right after the response; give a late navigation time to land.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    await expect(page.getByRole("heading", { name: "Connection status" })).toBeVisible();
    await expect(page).toHaveURL(/\/status$/);
  });

  test("browser Back to the panel from /status puts focus on the panel heading", async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole("link", { name: "Connection status" }).click();
    // Wait for the status page itself: Back before it renders leaves the panel mounted, so no
    // navigation to the panel happens at all.
    await expect(page.getByRole("heading", { name: "Connection status" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Query Module", exact: true })).toBeFocused();
  });

  test("browser Back to the entry the page was loaded on (after a reload) also focuses the heading", async ({
    page,
  }) => {
    await signIn(page);
    // The reload makes "/" the entry AppShell first renders at, with nothing before it.
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();
    await page.getByRole("link", { name: "Connection status" }).click();
    // Wait for the status page itself: Back before it renders leaves the panel mounted, so no
    // navigation to the panel happens at all.
    await expect(page.getByRole("heading", { name: "Connection status" })).toBeVisible();
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
