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

// PR2: failed reason (G5), command kept after a reload (G7), 4-digit birth year (G26), info mark (G27),
// mid-sentence "not run" reason (G33).
for (const [email, width, height, who] of [
  ["dispatcher@example.test", 1366, 768, "dispatcher"],
  ["dispatcher@example.test", 1024, 768, "dispatcher"],
  ["officer@example.test", 1024, 768, "officer"],
] as const) {
  test(`${who} ${width}x${height}: failed reason, birth date, info mark, reload`, async ({
    page,
  }) => {
    await startAs(page, email, width, height);
    const tag = `${who}-${width}`;
    await runCommand(page, "VEH.FAIL1..26");
    await expect(requests(page)).toContainText("the source reported an error", { timeout: 15_000 });
    await save(page, `pr2-${tag}-01-failed-reason`);

    await runCommand(page, "VEH.ABC123..26");
    await expect(
      requests(page).getByRole("region", { name: "State system: returned" }).first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    await save(page, `pr2-${tag}-02-info-badge`);

    await runCommand(page, "WNT.WANTED");
    const national = requests(page).getByRole("region", { name: "National system: returned" });
    await expect(national.first()).toBeVisible({ timeout: 15_000 });
    const toggle = national.first().getByRole("button", { name: / detail/ });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(national.first()).toContainText(/01-01-(19)?01/);
    await save(page, `pr2-${tag}-03-birth-date`);

    await runCommand(page, "DL.ZZDLTEST");
    await expect(requests(page)).toContainText("needs last name", { timeout: 15_000 });
    await save(page, `pr2-${tag}-04-also-run-not-run`);

    // The fixture answers the list empty; the reload must see the real one (G7).
    await page.route(
      (url) => url.pathname === "/api/v1/queries",
      (route) => route.continue(),
    );
    await page.reload();
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    await expect(requests(page)).toContainText("DL.ZZDLTEST", { timeout: 15_000 });
    await requests(page).evaluate((el) => el.scrollIntoView());
    await save(page, `pr2-${tag}-05-after-reload`);
  });
}

// PR3: chrome, shortcuts and copy (G8, G9, G24, G28 to G31, G35, G40).
for (const [email, width, height, who] of [
  ["dispatcher@example.test", 1366, 768, "dispatcher"],
  ["dispatcher@example.test", 1024, 768, "dispatcher"],
  ["officer@example.test", 1024, 768, "officer"],
] as const) {
  test(`${who} ${width}x${height}: header, empty list, shortcuts, status`, async ({ page }) => {
    await startAs(page, email, width, height);
    const tag = `${who}-${width}`;
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await save(page, `pr3-${tag}-01-header-empty-list`);

    // Person form: the date hint stays whole (G30); terminal heading follows the command (G31).
    if (who === "dispatcher") {
      await page
        .getByRole("button", { name: /Person/ })
        .first()
        .click();
      await page.getByRole("button", { name: "Form mode" }).click();
      await save(page, `pr3-${tag}-02-person-form`);
      await page.getByRole("button", { name: "Terminal mode" }).click();
      await page.keyboard.press("Slash");
      await page.keyboard.press("Control+A");
      await page.keyboard.type("PRO.ZZ123.FIREARM");
      await save(page, `pr3-${tag}-03-terminal-heading`);
      await page.keyboard.press("Control+A");
      await page.keyboard.type("NAM.TESTERSON.SAMPLE");
      await page.keyboard.press("Enter");
      await expect(requests(page)).toContainText("NAM.TESTERSON.SAMPLE", { timeout: 15_000 });
      await save(page, `pr3-${tag}-04-typed-nam`);
    }

    // The shortcuts dialog from the bare page, then Escape: focus must not end on the body (G9).
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await page.keyboard.press("Shift+Slash");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await save(page, `pr3-${tag}-05-shortcuts`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? "none");
    expect(focused).not.toBe("BODY");

    await page.getByRole("link", { name: "Status" }).click();
    await expect(page.getByRole("heading", { name: "Status", level: 1 })).toBeVisible();
    await expect(page.getByText("Settings version")).toBeVisible();
    await save(page, `pr3-${tag}-06-status`);
  });
}

test("implementer 1366x768: the header offers no Queries link (G40)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.context().clearCookies();
  await signIn(page, seededUser("implementer@example.test"));
  await expect(page.getByRole("link", { name: "Status" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Queries" })).toHaveCount(0);
  await save(page, "pr3-implementer-1366-01-header");
});
