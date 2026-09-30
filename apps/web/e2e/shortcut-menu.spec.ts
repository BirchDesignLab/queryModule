import { expect, test } from "./fixtures.js";
import { openAccountMenu, seededUser, signIn } from "./helpers.js";

// The account menu's "Keyboard shortcuts" opens the panel's sheet (visual system, app shell): by
// the user's choice only; focus goes into the sheet and back to the account button on close.
test("Keyboard shortcuts in the account menu opens the sheet; Escape returns focus to the account button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, seededUser("dispatcher@example.test"));
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();

  const account = page.getByRole("banner").locator(".qm-account__button");
  const panel = await openAccountMenu(page);
  await panel.getByRole("button", { name: "Keyboard shortcuts" }).click();
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet).toBeVisible();
  await expect(panel).toBeHidden();
  // showModal moves focus into the sheet.
  expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(account).toBeFocused();
  await expect(account).toHaveAttribute("aria-expanded", "false");
});

test("officer: the item is a 48 px, 16 px target in the compact bar's menu and focus returns to the account button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signIn(page, seededUser("officer@example.test"));
  await expect(page.locator(".qm-layout--mobile-unit")).toHaveCount(1);
  const account = page.getByRole("banner").locator(".qm-account__button");
  const panel = await openAccountMenu(page);
  const item = panel.getByRole("button", { name: "Keyboard shortcuts" });
  const look = await item.evaluate((el) => ({
    h: el.getBoundingClientRect().height,
    size: getComputedStyle(el).fontSize,
  }));
  expect(look.h).toBeGreaterThanOrEqual(47.5);
  expect(look.size).toBe("16px");
  await item.click();
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await expect(account).toBeFocused();
});
