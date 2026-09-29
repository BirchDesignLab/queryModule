import { expect, test } from "./fixtures.js";
import { e2eUser } from "./helpers.js";

test("keyboard-only sign-in and sign-out (spec 2, 6.4)", async ({ page }) => {
  const user = e2eUser();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.type(user.email);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.type(user.password);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Query Module", exact: true })).toBeFocused();
  // The header (nav, account button) precedes the panel in reading order (D-B4), so the last
  // control before the heading is the account button; Sign out is inside its disclosure.
  await page.keyboard.press("Shift+Tab");
  const account = page.getByRole("banner").locator(".qm-account__button");
  await expect(account).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(account).toHaveAttribute("aria-expanded", "true");
  // Four theme buttons, then Sign out: the fifth Tab.
  for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
