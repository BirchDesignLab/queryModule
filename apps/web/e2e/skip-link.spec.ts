import { expect, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

test.describe("tab order and focus on the signed-in panel (spec 6.4)", () => {
  test("after sign-in focus is on the panel heading and the next Tab enters the panel", async ({
    page,
  }) => {
    await signIn(page);
    await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Query Module", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    const inMain = await page.evaluate(
      () => document.querySelector("main")?.contains(document.activeElement) ?? false,
    );
    expect(inMain).toBe(true);
  });

  test("Skip to query is the first Tab stop and moves focus to the panel", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();
    // Start from the top of the document, as a fresh page load would.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to query" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#qm-main")).toBeFocused();
    await page.keyboard.press("Tab");
    const inMain = await page.evaluate(
      () => document.querySelector("main")?.contains(document.activeElement) ?? false,
    );
    expect(inMain).toBe(true);
  });
});
