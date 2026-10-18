import type { Page } from "@playwright/test";
import { expect } from "./fixtures.js";

// The locators and steps every builder spec uses (the shot specs, the layout specs): one copy, so a
// rename of the tree or the preview is fixed once (#651).

export const tree = (page: Page) => page.getByRole("navigation", { name: "Configuration items" });
export const editor = (page: Page) => page.getByTestId("form-tab");
export const preview = (page: Page) => page.getByRole("region", { name: "Card preview" });

/** From the signed-in admin's home to Site configuration, by keyboard as a user would. */
export async function openSiteConfiguration(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Admin" }).press("Enter");
  await page.getByRole("link", { name: "Site configuration" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Site configuration", level: 2 })).toBeVisible();
}

/** Selects a tree row by its name and waits until it is the selected one. */
export async function selectRow(page: Page, name: RegExp): Promise<void> {
  const item = tree(page).getByRole("treeitem", { name }).first();
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(item).toHaveAttribute("aria-selected", "true");
}

/** The first card of a query type by the type row's name, opening the type row when needed. */
export async function selectCard(page: Page, type: RegExp, card: RegExp): Promise<void> {
  await selectRow(page, type);
  if ((await tree(page).getByRole("treeitem", { name: card }).count()) === 0)
    await tree(page).getByRole("treeitem", { name: type }).first().press("ArrowRight");
  await selectRow(page, card);
}
