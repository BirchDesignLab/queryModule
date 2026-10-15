import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Evidence screenshots for the demo-dry-run web gaps (M2 demo gaps W1). Not a test of behavior: it
// is skipped unless GAP_SHOTS_DIR is set, signs in as seeded demo users, types synthetic values
// only (ZZ-0001, WANTED) and publishes nothing. Day theme, 1x, one file per gap and viewport.
//   GAP_SHOTS_DIR=.dev/gap-shots/w1 E2E_PORT=3000 pnpm e2e gap-shots.spec.ts
// The shots are compared with mockup v5 (docs/design/2026-09-29-visual-system.md) by a critic agent.

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

/** Types a terminal command and runs it; leaves the form mode as it found it. */
async function runCommand(page: Page, command: string): Promise<void> {
  await page.keyboard.press("Slash");
  const input = page.getByRole("textbox", { name: "Command" });
  await expect(input).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

const requests = (page: Page) =>
  page.getByRole("region", { name: /Requests this shift|Last request/ });

for (const [width, height] of [
  [1366, 768],
  [1024, 768],
] as const) {
  test(`dispatcher ${width}x${height}: entries, cards, toast, long form`, async ({ page }) => {
    await startAs(page, "dispatcher@example.test", width, height);
    await save(page, `dispatcher-${width}-01-empty`);

    await runCommand(page, "VEH.ZZ-0001..26");
    await expect(page.getByRole("region", { name: "State system: returned" })).toBeVisible({
      timeout: 15_000,
    });
    await save(page, `dispatcher-${width}-02-veh-settled-and-toast`);

    await runCommand(page, "WNT.WANTED");
    const national = requests(page).getByRole("region", { name: "National system: returned" });
    await expect(national.first()).toBeVisible({ timeout: 15_000 });
    await national
      .first()
      .getByRole("button", { name: / detail/ })
      .click();
    await save(page, `dispatcher-${width}-03-wanted-detail`);

    await runCommand(page, "PER.TESTERSON.SAMPLE.01011901");
    await expect(requests(page).getByRole("listitem").first()).toContainText("Wanted check", {
      timeout: 15_000,
    });
    await save(page, `dispatcher-${width}-04-person-also-run`);

    // A long form with errors: Property, Firearm, nothing typed but the serial number.
    await page.getByRole("button", { name: "Form mode" }).click();
    await page.getByRole("button", { name: /Property/ }).click();
    await page.getByRole("radio", { name: "Firearm" }).check({ force: true, timeout: 10_000 });
    await page.getByLabel("Serial number").fill("ZZ123");
    await page.getByRole("button", { name: /Run query/ }).click();
    await save(page, `dispatcher-${width}-05-long-form-errors`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await save(page, `dispatcher-${width}-06-long-form-errors-scrolled`);
  });
}

test("officer 1024x768: run query, last request in view, card headings", async ({ page }) => {
  await startAs(page, "officer@example.test", 1024, 768);
  await save(page, "officer-1024-01-empty");
  await page.getByLabel("Year", { exact: true }).fill("26");
  const plate = page.getByLabel("Plate", { exact: true });
  await plate.focus();
  await page.keyboard.type("ZZ-0001");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "State system: returned" })).toBeVisible({
    timeout: 15_000,
  });
  await save(page, "officer-1024-02-after-run");
  // G11: after Run query the last request is brought to the top half of the screen.
  const top = await page
    .getByRole("heading", { name: "Last request" })
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeLessThan(384);
  for (const [button, name] of [
    ["Night", "03-night"],
    ["Red shift", "04-red-shift"],
  ] as const) {
    await page.getByRole("button", { name: button }).click();
    await page.getByRole("heading", { name: "Last request" }).evaluate((el) => el.scrollIntoView());
    await save(page, `officer-1024-${name}-results`);
  }
});
