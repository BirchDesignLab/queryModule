import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Locator, Page } from "@playwright/test";
import { editor, openSiteConfiguration, preview, selectRow, tree } from "./builder-helpers.js";
import { expect, test } from "./fixtures.js";
import { chooseQueryType, chooseTheme, seededUser, signIn } from "./helpers.js";

// Screenshots and the terminal recording for the README and the reader docs (docs/assets/shots/).
// Not a test of behavior: skipped unless DOCS_SHOTS_DIR is set. Signs in as the seeded demo users,
// types synthetic values only (ZZ-0001, WANTED) and publishes nothing. Each screen is taken in the
// Day and Night themes so the README can follow the reader's GitHub theme (<picture>).
// Run through the wrapper, which also turns the recording into a GIF:
//   E2E_PORT=<port> node scripts/docs/shots.mjs

const DIR = process.env.DOCS_SHOTS_DIR ?? "";
type Theme = "day" | "night" | "redShift";
const SLUG: Record<Theme, string> = { day: "day", night: "night", redShift: "red-shift" };

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.skip(DIR === "", "set DOCS_SHOTS_DIR to take the screenshots");
test.use({ emptyQueryList: true, deviceScaleFactor: 2, reducedMotion: "reduce" });

async function save(target: Page | Locator, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await target.screenshot({ path: join(DIR, `${name}.png`) });
}

async function startAs(page: Page, email: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.context().clearCookies();
  await signIn(page, seededUser(email));
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
}

const card = (scope: Page | Locator, source: string) =>
  scope.getByRole("region", { name: `${source}: returned` });
const requests = (page: Page) => page.getByRole("region", { name: "Requests this shift" });

async function plateQuery(page: Page): Promise<void> {
  await page.getByLabel("Year", { exact: true }).fill("26");
  await page.getByLabel("Plate", { exact: true }).fill("ZZ-0001");
  await page.keyboard.press("Enter");
  await expect(card(page, "State system")).toBeVisible({ timeout: 8000 });
  await expect(card(page, "National system")).toBeVisible({ timeout: 8000 });
  await expect(
    card(page, "State system").locator("mark", { hasText: "STOLEN" }).first(),
  ).toBeVisible();
}

test("dispatcher: results in every theme, warrants detail", async ({ page }) => {
  await startAs(page, "dispatcher@example.test", 1440, 760);
  await chooseTheme(page, "day");
  await plateQuery(page);
  await page.mouse.move(0, 0);
  for (const theme of ["day", "night", "redShift"] as const) {
    await chooseTheme(page, theme);
    await page.mouse.move(0, 0);
    await save(page, `results-${SLUG[theme]}`);
  }

  await chooseTheme(page, "day");
  await chooseQueryType(page, "WNT");
  await page.getByLabel("Last name").fill("WANTED");
  await page.keyboard.press("Enter");
  const wanted = requests(page).getByRole("listitem").first();
  const national = wanted.getByRole("region", { name: "National system: returned" });
  await expect(national).toBeVisible({ timeout: 8000 });
  await national.getByRole("button", { name: / detail/ }).click();
  await expect(national.getByRole("region", { name: /Warrants/ }).getByRole("table")).toBeVisible();
  for (const theme of ["day", "night"] as const) {
    await chooseTheme(page, theme);
    await page.mouse.move(0, 0);
    await save(wanted, `warrants-${SLUG[theme]}`);
  }
  await chooseTheme(page, "day");
});

test("admin: card builder with live preview, audit log", async ({ page }) => {
  await startAs(page, "admin@example.test", 1500, 940);
  await chooseTheme(page, "day");
  // One request, so the audit log has a row of this run near the top.
  await page.getByLabel("Plate", { exact: true }).fill("ZZ-0001");
  await page.keyboard.press("Enter");
  await expect(card(page, "State system")).toBeVisible({ timeout: 8000 });

  await openSiteConfiguration(page);
  await selectRow(page, /^Vehicle cards/);
  const first = tree(page).getByRole("treeitem", { name: /^1\. All results veh-summary/ });
  if ((await first.count()) === 0)
    await tree(page)
      .getByRole("treeitem", { name: /^Vehicle cards/ })
      .first()
      .press("ArrowRight");
  await selectRow(page, /^1\. All results veh-summary/);
  await expect(
    editor(page).getByRole("heading", { level: 3, name: /^Vehicle: All results/ }),
  ).toBeVisible();
  await preview(page).getByRole("radio", { name: "Type values" }).check();
  await preview(page).getByLabel("Plate", { exact: true }).fill("ZZ-0001");
  await expect(card(preview(page), "State system")).toBeVisible();
  for (const theme of ["day", "night"] as const) {
    await chooseTheme(page, theme);
    await page.mouse.move(0, 0);
    await save(page, `builder-${SLUG[theme]}`);
  }

  await chooseTheme(page, "day");
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Audit log", level: 2 })).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  for (const theme of ["day", "night"] as const) {
    await chooseTheme(page, theme);
    await page.mouse.move(0, 0);
    await save(page, `audit-${SLUG[theme]}`);
  }
  await chooseTheme(page, "day");
});

/** A recorded context of its own: the fixtures' page cannot start recording after it exists. */
async function recordedPage(browser: Browser): Promise<{ page: Page; done: () => Promise<void> }> {
  const size = { width: 1280, height: 680 };
  const context = await browser.newContext({
    viewport: size,
    recordVideo: { dir: join(DIR, ".video"), size },
  });
  const page = await context.newPage();
  await page.route(
    (url) => url.pathname === "/api/v1/queries",
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: { requests: [], nextCursor: null } })
        : route.fallback(),
  );
  return {
    page,
    done: async () => {
      const video = page.video();
      await context.close();
      if (video === null) throw new Error("query-flow: no video was recorded");
      renameSync(await video.path(), join(DIR, "query-flow.webm"));
    },
  };
}

test("recording: a terminal command to returned cards", async ({ browser, page: plain }) => {
  const { page, done } = await recordedPage(browser);
  await signIn(page, seededUser("dispatcher@example.test"));
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  await chooseTheme(page, "night");
  await page.mouse.move(0, 0);
  await page.waitForTimeout(800);
  // The slash key focuses the terminal from anywhere outside a text input (spec 6.4).
  await page.keyboard.press("Slash");
  await expect(page.getByRole("textbox", { name: "Command" })).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("VEH.ZZ-0001..26", { delay: 110 });
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  await expect(card(page, "State system")).toBeVisible({ timeout: 8000 });
  await expect(card(page, "National system")).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(2500);
  await done();
  // Put the dispatcher back on Day outside the recording, so the GIF ends on the cards.
  await signIn(plain, seededUser("dispatcher@example.test"));
  await chooseTheme(plain, "day");
});
