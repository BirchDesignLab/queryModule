import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Evidence screenshots for the demo polish PR (focus ring, ghost alignment, part rule, toast, date
// hint, quick access row, builder Remove, rebuilt command). Skipped unless GAP_SHOTS_DIR is set;
// synthetic values only, nothing published. Day theme, 1x.
//   GAP_SHOTS_DIR=C:/git/queryModule/.dev/gap-shots/polish E2E_PORT=3000 pnpm e2e polish-shots.spec.ts

const DIR = process.env.GAP_SHOTS_DIR;

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.skip(DIR === undefined || DIR === "", "set GAP_SHOTS_DIR to take the screenshots");
test.use({ emptyQueryList: true, colorScheme: "light", reducedMotion: "reduce" });

async function save(page: Page, name: string): Promise<void> {
  const dir = DIR ?? "";
  mkdirSync(dir, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

async function startAs(page: Page, email: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.context().clearCookies();
  await signIn(page, seededUser(email));
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
}

const requests = (page: Page) =>
  page.getByRole("region", { name: /Requests this shift|Last request/ });

/** Runs a terminal command from the form page and returns with the toast showing. */
async function runCommand(page: Page, command: string): Promise<void> {
  await page.keyboard.press("Slash");
  const input = page.getByRole("textbox", { name: "Command" });
  await expect(input).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

for (const [who, email, width, height] of [
  ["dispatcher", "dispatcher@example.test", 1366, 768],
  ["dispatcher", "dispatcher@example.test", 1024, 768],
  ["officer", "officer@example.test", 1024, 768],
] as const) {
  test(`${who} ${width}x${height}: toast, ghost alignment, also-run rule`, async ({ page }) => {
    await startAs(page, email, width, height);
    await runCommand(page, "PER.EXAMPLESON.SAMPLE.01011901");
    const toast = page.getByTestId("ack-toast");
    await expect(toast).toBeVisible();
    await expect(requests(page).getByText("Acknowledged", { exact: true })).toBeVisible();
    await expect(page.getByText("NO WANTS OR WARRANTS")).toBeVisible({ timeout: 15_000 });
    await save(page, `${who}-${width}-01-toast-card`);
  });
}

for (const [who, email, width, height] of [
  ["dispatcher", "dispatcher@example.test", 1366, 768],
  ["dispatcher", "dispatcher@example.test", 1024, 768],
  ["officer", "officer@example.test", 1024, 768],
] as const) {
  test(`${who} ${width}x${height}: person form, date hint, quick access`, async ({ page }) => {
    await startAs(page, email, width, height);
    await page.getByRole("button", { name: "Person", exact: true }).click();
    await expect(page.getByLabel(/^Date of birth/)).toBeVisible();
    await page.getByLabel(/^Date of birth/).scrollIntoViewIfNeeded();
    await save(page, `${who}-${width}-02-person-date-hint`);
  });
}

// The focus ring in every theme, on a field, the primary button and a pressed quick-access button.
// The theme is set on the page only (data-theme), so nothing is saved to the account.
for (const mode of ["day", "night", "redShift"] as const) {
  test(`dispatcher 1366x768: focus ring, ${mode}`, async ({ page }) => {
    await startAs(page, "dispatcher@example.test", 1366, 768);
    await page.evaluate((m) => document.documentElement.setAttribute("data-theme", m), mode);
    await page.getByLabel("Plate", { exact: true }).focus();
    await save(page, `ring-${mode}-1-field`);
    await page.getByRole("button", { name: /^Run query/ }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await save(page, `ring-${mode}-2-primary`);
    await page.getByRole("button", { name: "Person", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await save(page, `ring-${mode}-3-quick-access`);
  });
}
