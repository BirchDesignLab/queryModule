import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// BW3 polish (#642, item 12): screenshots of the result cards builder for a visual comparison with
// the v5 mockup frames. Not a test of behaviour: it is skipped unless SHOTS_DIR is set, and it only
// looks (opening rows and typing into the previews' own state changes nothing in the draft; nothing
// is published). Run:
//   SHOTS_DIR=<dir> pnpm e2e visual-shots.spec.ts
// Files: app-<frame>-<width>.png, as the admin (dispatcher-sized controls) at 1366x768 and
// 1024x768, and the card preview as Officer at 1024x768. Synthetic data only (ZZ-0001).

const SHOTS_DIR = process.env.SHOTS_DIR;
const ADMIN = seededUser("admin@example.test");

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.skip(SHOTS_DIR === undefined || SHOTS_DIR === "", "set SHOTS_DIR to take the screenshots");
test.use({ emptyQueryList: true });

const WIDTHS = [1366, 1024] as const;

const tree = (page: Page) => page.getByRole("navigation", { name: "Configuration items" });
const editor = (page: Page) => page.getByTestId("form-tab");
const preview = (page: Page) => page.getByRole("region", { name: "Card preview" });

async function openBuilder(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 768 });
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Admin" }).press("Enter");
  await page.getByRole("link", { name: "Site configuration" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Site configuration", level: 2 })).toBeVisible();
}

async function selectRow(page: Page, name: RegExp): Promise<void> {
  const item = tree(page).getByRole("treeitem", { name }).first();
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(item).toHaveAttribute("aria-selected", "true");
}

/** The first card of a query type by the type row's name, opening the type row when needed. */
async function selectCard(page: Page, type: RegExp, card: RegExp): Promise<void> {
  await selectRow(page, type);
  if ((await tree(page).getByRole("treeitem", { name: card }).count()) === 0)
    await tree(page).getByRole("treeitem", { name: type }).first().press("ArrowRight");
  await selectRow(page, card);
}

async function shot(page: Page, frame: string, width: number, top = false): Promise<void> {
  // A pane keeps the scroll of the item before it: frames that show a pane from its start reset it.
  if (top)
    await page.evaluate(() => {
      for (const el of document.querySelectorAll("[role=tabpanel], .qm-builder__editor"))
        el.scrollTop = 0;
    });
  const dir = SHOTS_DIR ?? "";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `app-${frame}-${width}.png`) });
}

async function show(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
}

for (const width of WIDTHS) {
  test(`[#642] shots of the cards builder at ${width}`, async ({ page }) => {
    await openBuilder(page, width);

    // The card editor with its preview, on typed ZZ-0001 as the mockup frame shows.
    await selectCard(page, /^Vehicle cards/, /^1\. All results veh-summary/);
    await expect(
      editor(page).getByRole("heading", { level: 3, name: /^Vehicle: All results/ }),
    ).toBeVisible();
    await preview(page).getByRole("radio", { name: "Type values" }).check();
    await preview(page).getByLabel("Plate", { exact: true }).fill("ZZ-0001");
    await expect(
      preview(page).getByRole("region", { name: "State system: returned" }),
    ).toBeVisible();
    await shot(page, "card", width, true);

    // Which card wins.
    await show(editor(page).getByRole("table", { name: "Which card wins" }));
    await shot(page, "wins", width);

    // A table row opened (the Wanted check card's Warrants).
    await selectCard(page, /^Wanted check cards/, /^1\. All results wnt-summary/);
    await editor(page)
      .getByRole("button", { name: /^Edit\s?Warrants/ })
      .click();
    await show(editor(page).getByRole("table", { name: "Columns" }));
    await shot(page, "table", width);

    // Keywords and severity.
    await selectRow(page, /^Keywords and severity/);
    await expect(
      editor(page).getByRole("heading", { level: 3, name: /^Keywords and severity/ }),
    ).toBeVisible();
    await shot(page, "keywords", width, true);

    // Try a match on the state system's Vehicle response: the Result card and the Payload.
    const mockRow = tree(page).getByRole("treeitem", {
      name: /^Mock response: Vehicle, State system/,
    });
    if ((await mockRow.count()) === 0)
      await tree(page).getByRole("button", { name: "Mock responses" }).click();
    await selectRow(page, /^Mock response: Vehicle, State system/);
    const pane = page.getByRole("region", { name: "Try a match" });
    await pane.getByLabel("Plate", { exact: true }).fill("ZZ-0001");
    await expect(pane.getByRole("region", { name: "State system: returned" })).toBeVisible();
    await shot(page, "try-card", width, true);
    await pane.getByRole("button", { name: "Payload" }).click();
    await expect(pane.getByTestId("try-payload")).toBeVisible();
    await shot(page, "try-payload", width, true);
  });
}

test("[#642] shots of the card preview as Officer at 1024", async ({ page }) => {
  await openBuilder(page, 1024);
  await selectCard(page, /^Vehicle cards/, /^1\. All results veh-summary/);
  await preview(page).getByRole("button", { name: "Officer" }).click();
  await expect(preview(page).getByRole("button", { name: "Officer" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(preview(page).getByRole("region", { name: "State system: returned" })).toBeVisible();
  await show(preview(page).getByRole("region", { name: "State system: returned" }));
  await shot(page, "officer", 1024);
});
