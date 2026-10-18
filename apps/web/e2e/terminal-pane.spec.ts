import type { Locator, Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

/**
 * FR-050, UX-014 (spec 6.2, 6.4): the terminal beside the results, chosen in the account menu.
 * Keyboard only: every control is reached with Tab or a shortcut, never `focus()` on the target
 * (the heading stands in for "focus is somewhere that is not a text field", which is where a
 * plain-key shortcut works). Mock data only: plates ZZ-####.
 */

const WIDE = { width: 1366, height: 768 };
const PREFERENCES = "/api/v1/me/preferences";

/** Presses Tab from wherever focus is until `target` has it; fails after `max` presses. */
async function tabTo(page: Page, target: Locator, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target, `Tab reaches it within ${max} presses`).toBeFocused();
}

const accountButton = (page: Page) => page.getByRole("banner").locator(".qm-account__button");
const pane = (page: Page) => page.getByRole("complementary", { name: "Terminal" });
const command = (page: Page) => pane(page).getByRole("textbox", { name: "Command" });
const plate = (page: Page) => page.getByLabel("Plate", { exact: true });
const toggle = (page: Page) => page.getByRole("button", { name: "Terminal mode" });

/** The stored layout, so a run leaves the shared e2e user as it found it (other specs run at 1280). */
async function storedLayout(page: Page): Promise<unknown> {
  const response = await page.request.get(PREFERENCES);
  return ((await response.json()) as { layout: unknown }).layout;
}

async function restoreLayout(page: Page, layout: unknown): Promise<void> {
  const current = await page.request.get(PREFERENCES);
  await page.request.put(PREFERENCES, {
    data: { ...((await current.json()) as object), layout },
    headers: { "X-Requested-With": "querymodule" },
  });
}

/** Opens the account menu and chooses a terminal layout by keyboard; waits for the save. */
async function chooseTerminal(page: Page, name: "In the panel" | "Beside results"): Promise<void> {
  await tabTo(page, accountButton(page));
  await page.keyboard.press("Enter");
  const group = page.getByRole("group", { name: "Terminal" });
  await expect(group).toBeVisible();
  const choice = group.getByRole("button", { name });
  await tabTo(page, choice);
  const saved = page.waitForResponse(
    (r) => r.url().includes(PREFERENCES) && r.request().method() === "PUT" && r.ok(),
  );
  await page.keyboard.press("Enter");
  await saved;
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(accountButton(page)).toBeFocused();
}

test.describe("[FR-050] terminal beside the results (UX-014)", () => {
  test.use({ viewport: WIDE });

  let original: unknown = null;

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    original = await storedLayout(page);
  });

  test.afterEach(async ({ page }) => {
    await restoreLayout(page, original);
  });

  test("the account menu offers In the panel and Beside results with the width hint", async ({
    page,
  }) => {
    await tabTo(page, accountButton(page));
    await page.keyboard.press("Enter");
    const group = page.getByRole("group", { name: "Terminal" });
    await expect(group.getByRole("button", { name: "In the panel" })).toBeVisible();
    await expect(group.getByRole("button", { name: "Beside results" })).toBeVisible();
    await expect(
      page.getByText("Beside results needs a window 1280 px wide or more."),
    ).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });

  test("Beside results puts the terminal on the right; one draft, edited from either side", async ({
    page,
  }) => {
    await chooseTerminal(page, "Beside results");
    await expect(pane(page)).toBeVisible();
    await expect(toggle(page)).toHaveCount(0);

    // Three columns at 1366: the form in its panel, the results in the middle, the terminal at 320.
    const form = await page.locator(".qm-panes__panel").boundingBox();
    const requests = await page.getByRole("region", { name: "Requests this shift" }).boundingBox();
    const terminal = await pane(page).boundingBox();
    expect(form && requests && terminal).toBeTruthy();
    if (form === null || requests === null || terminal === null) return;
    expect(form.x + form.width).toBeLessThanOrEqual(requests.x);
    expect(requests.x + requests.width).toBeLessThanOrEqual(terminal.x);
    expect(Math.round(terminal.width)).toBe(320);
    expect(form.width).toBeGreaterThanOrEqual(448);
    expect(form.width).toBeLessThanOrEqual(480 + 1);
    expect(requests.width).toBeGreaterThanOrEqual(384);
    expect(terminal.x + terminal.width).toBeLessThanOrEqual(WIDE.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      WIDE.width,
    );

    // A value typed in the form shows in the command.
    await tabTo(page, plate(page));
    await page.keyboard.type("ZZ-0021");
    await expect(command(page)).toHaveValue("VEH.ZZ-0021");

    // The toggle shortcut moves to the pane's input; a command typed there fills the form.
    await page.keyboard.press("Control+Backquote");
    await expect(command(page)).toBeFocused();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("VEH.ZZ-0022");
    await expect(plate(page)).toHaveValue("ZZ-0022");
    await expect(command(page)).toHaveValue("VEH.ZZ-0022");
    await expectNoSeriousAxeViolations(page);

    // The same shortcut goes back to the form.
    await page.keyboard.press("Control+Backquote");
    await expect(plate(page)).toBeFocused();
  });

  test("an unrecognized command lists its problem in the pane and sends nothing", async ({
    page,
  }) => {
    await chooseTerminal(page, "Beside results");
    let posts = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/v1/queries") && r.method() === "POST") posts++;
    });
    await tabTo(page, command(page));
    await page.keyboard.press("Control+A");
    await page.keyboard.type("XYZ.123");
    await page.keyboard.press("Enter");
    const errors = pane(page).getByRole("list", { name: "Command problems" });
    await expect(errors.getByRole("listitem")).toHaveText("Unrecognized command XYZ.");
    await expect(command(page)).toHaveAttribute("aria-invalid", "true");
    await expect(command(page)).toBeFocused();
    expect(posts).toBe(0);
    await expectNoSeriousAxeViolations(page);
  });

  test("the terminal shortcut focuses the pane's input; the preview's Edit does too", async ({
    page,
  }) => {
    await chooseTerminal(page, "Beside results");
    // A plain key types in a text field, so the shortcut is pressed from the page, not a field.
    await page.getByRole("heading", { name: "Query Module", level: 1 }).focus();
    await page.keyboard.press("Slash");
    await expect(command(page)).toBeFocused();
    await expect(toggle(page)).toHaveCount(0);

    await tabTo(page, plate(page));
    await page.keyboard.type("ZZ-0023");
    const edit = page.getByRole("button", { name: "Edit in terminal pane" });
    await tabTo(page, edit);
    await page.keyboard.press("Enter");
    await expect(command(page)).toBeFocused();
    await expect(command(page)).toHaveValue("VEH.ZZ-0023");
  });

  test("below 1280 px the toggle returns and the draft is kept", async ({ page }) => {
    await chooseTerminal(page, "Beside results");
    await tabTo(page, command(page));
    await page.keyboard.press("Control+A");
    await page.keyboard.type("VEH.ZZ-0024");
    await expect(plate(page)).toHaveValue("ZZ-0024");

    await page.setViewportSize({ width: 1279, height: 768 });
    await expect(pane(page)).toHaveCount(0);
    await expect(toggle(page)).toBeVisible();
    await expect(plate(page)).toHaveValue("ZZ-0024");
    await expectNoSeriousAxeViolations(page);

    // The command is there when the user turns the toggle on.
    await toggle(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Command" })).toHaveValue("VEH.ZZ-0024");

    // And back at 1280 the pane returns with the form and the command intact.
    await page.setViewportSize({ width: 1280, height: 768 });
    await expect(pane(page)).toBeVisible();
    await expect(toggle(page)).toHaveCount(0);
    await expect(plate(page)).toHaveValue("ZZ-0024");
    await expect(command(page)).toHaveValue("VEH.ZZ-0024");
  });

  test("In the panel puts the terminal back behind the toggle, at any width", async ({ page }) => {
    await chooseTerminal(page, "Beside results");
    await expect(pane(page)).toBeVisible();
    await chooseTerminal(page, "In the panel");
    await expect(pane(page)).toHaveCount(0);
    await expect(toggle(page)).toBeVisible();
  });
});
