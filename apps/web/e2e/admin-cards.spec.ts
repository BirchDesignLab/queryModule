import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Task 10 fix round 1 (S2; spec 10.6, UX-015): the Result cards editor and the card preview under
// axe. The scan runs on each state of the editor (type row, card with an open row, the Which card
// wins table, the preview) and again after every scenario (fixtures.ts). Nothing is published or
// saved, so the shipped config stays as the other specs expect. Synthetic data only.

const ADMIN = seededUser("admin@example.test");

test.use({ viewport: { width: 1600, height: 1000 } });

async function openBuilder(page: Page): Promise<void> {
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Admin" }).press("Enter");
  await page.getByRole("link", { name: "Site configuration" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Site configuration", level: 2 })).toBeVisible();
  await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");
}

test("the cards editor and the card preview have no serious axe violations", async ({ page }) => {
  await openBuilder(page);
  const nav = page.getByRole("navigation", { name: "Configuration items" });
  const cards = nav.getByRole("tree", { name: "Result cards" });
  await expect(cards).toBeVisible();

  // A query type's cards row.
  await cards.getByRole("treeitem", { name: /^Vehicle cards$/ }).click();
  const editor = page.getByTestId("form-tab");
  await expect(editor.getByRole("heading", { level: 3, name: /^Vehicle cards/ })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  // A card: its rows, the Which card wins table and the live preview beside it.
  await cards.getByRole("treeitem", { name: /^1\. All results veh-summary/ }).click();
  await expect(
    editor.getByRole("heading", { level: 3, name: /^Vehicle: All results/ }),
  ).toBeVisible();
  await expect(editor.getByRole("table", { name: "Which card wins" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Card preview" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  // A new row open on its path, with the empty-path error shown at the control.
  await editor.getByRole("button", { name: "Add row" }).click();
  const path = editor.getByRole("combobox", { name: "Path" });
  await expect(path).toBeFocused();
  await expect(editor.locator('[data-issue-pointer$="/path"]')).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("the keywords editor has no serious axe violations, and a low-contrast style shows its diagnostic", async ({
  page,
}) => {
  await openBuilder(page);
  const nav = page.getByRole("navigation", { name: "Configuration items" });
  const cards = nav.getByRole("tree", { name: "Result cards" });
  await cards.getByRole("treeitem", { name: /^Keywords and severity keywords/ }).click();
  const editor = page.getByTestId("form-tab");
  await expect(
    editor.getByRole("heading", { level: 3, name: /^Keywords and severity/ }),
  ).toBeVisible();
  // The card preview beside it shows a card of the first type.
  await expect(page.getByRole("heading", { name: "Card preview" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  // A new keyword with an exception that holds no keyword: the error is shown at the exception.
  await editor.getByRole("textbox", { name: "New keyword" }).fill("TESTMAKE");
  await editor.getByRole("textbox", { name: "New keyword" }).press("Enter");
  await expect(editor.getByRole("textbox", { name: "New keyword" })).toBeFocused();
  const exception = editor.getByRole("textbox", { name: /^New exception for keyword 7$/ });
  await exception.fill("SOMETHING ELSE");
  await exception.press("Enter");
  await expect(editor.locator('[data-issue-pointer$="/except/0"]')).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  // A style whose text and background are one color: the contrast diagnostic sits at the style.
  const critical = editor.getByRole("group", { name: "Critical style" });
  await critical
    .getByRole("combobox", { name: "Text color" })
    .selectOption("color.severity.critical.bg");
  await expect(critical.getByText(/lacks enough contrast in day mode/)).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});
