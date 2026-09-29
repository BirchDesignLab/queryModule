import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

test.describe("keyboard shortcuts on the query panel (FR-006, FR-007, UX-004)", () => {
  test("Alt+2 selects PER and Ctrl+Enter with Last empty focuses Last and announces", async ({
    page,
  }) => {
    await signIn(page);
    // The panel renders after GET /api/v1/config; keys sent earlier reach no handler.
    await expect(page.getByLabel("Query type")).toBeVisible();
    await page.keyboard.press("Alt+Digit2");
    await expect(page.getByLabel("Query type")).toHaveValue("PER");

    await page.getByLabel("First name").focus();
    await page.keyboard.press("Control+Enter");

    const last = page.getByLabel("Last name");
    await expect(last).toHaveAttribute("aria-invalid", "true");
    await expect(last).toBeFocused();
    await expect(page.getByTestId("announcer-polite")).toHaveText(/1 field needs attention\./);
  });

  test("a slash typed into First name is text, not a shortcut", async ({ page }) => {
    await signIn(page);
    // The panel renders after GET /api/v1/config; keys sent earlier reach no handler.
    await expect(page.getByLabel("Query type")).toBeVisible();
    await page.keyboard.press("Alt+Digit2");
    const first = page.getByLabel("First name");
    await first.focus();
    await page.keyboard.press("Slash");
    await page.keyboard.press("Shift+Slash");
    await expect(first).toHaveValue("/?");
    await expect(first).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Shift+/ opens the sheet, axe passes, Escape closes it and focus returns", async ({
    page,
  }) => {
    await signIn(page);
    // The panel renders after GET /api/v1/config; keys sent earlier reach no handler.
    await expect(page.getByLabel("Query type")).toBeVisible();
    await page.getByRole("heading", { name: "Query Module" }).focus();
    await page.keyboard.press("Shift+Slash");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expectNoSeriousAxeViolations(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Query Module" })).toBeFocused();
  });

  test("G then Q outside inputs focuses the query-type select", async ({ page }) => {
    await signIn(page);
    // The panel renders after GET /api/v1/config; keys sent earlier reach no handler.
    await expect(page.getByLabel("Query type")).toBeVisible();
    await page.getByRole("heading", { name: "Query Module" }).focus();
    await page.keyboard.press("g");
    await page.keyboard.press("q");
    await expect(page.getByLabel("Query type")).toBeFocused();
  });
});
