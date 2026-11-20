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

/** Runs one command from the terminal, as the demo guide's stories do. */
async function runCommand(page: Page, command: string): Promise<void> {
  await page.mouse.click(5, 5);
  await page.keyboard.press("Slash");
  await expect(page.getByRole("textbox", { name: "Command" })).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

// The demo guide's stories (docs/demo.md, "Demo stories"), one request each, cropped to the
// request. `settled` is what the frame waits for; the timeout story is taken while the national
// system is still pending, which is the point of that story.
const STORIES = [
  { n: 1, command: "VEH.ZZ-0001..26", settled: /National system: returned/ },
  { n: 2, command: "VEH.ZZ-0010..26", settled: /National system: returned/ },
  { n: 3, command: "VEH.ABC123..26", settled: /National system: returned/ },
  { n: 4, command: "WNT.WANTED", settled: /National system: returned/ },
  { n: 5, command: "DL.ZZDLTEST", settled: /National system: returned/ },
  { n: 6, command: "PER.EXAMPLESON.SAMPLE.01011901", settled: /Wanted check/ },
  { n: 7, command: "VEH.FAIL1..26", settled: /National system: returned/ },
  { n: 8, command: "VEH.TIMEOUT..26", settled: /State system: returned/ },
] as const;

test("demo stories: one request per story", async ({ page }) => {
  await startAs(page, "dispatcher@example.test", 1366, 900);
  await chooseTheme(page, "day");
  for (const story of STORIES) {
    await runCommand(page, story.command);
    const item = requests(page).getByRole("listitem").first();
    await expect(item).toContainText(story.command.split(".")[1] ?? story.command, {
      timeout: 8000,
    });
    await expect(item).toContainText(story.settled, { timeout: 8000 });
    // Let the second source land too where it answers, so no frame catches a half-settled card.
    if (story.n !== 8) await expect(item).not.toContainText(/: pending/, { timeout: 8000 });
    await page.mouse.move(0, 0);
    await save(item, `story-${story.n}`);
  }
});

test("builder: keywords and severity, try a match", async ({ page }) => {
  await startAs(page, "admin@example.test", 1500, 940);
  await chooseTheme(page, "day");
  await openSiteConfiguration(page);

  await selectRow(page, /^Keywords and severity/);
  await expect(
    editor(page).getByRole("heading", { level: 3, name: /^Keywords and severity/ }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  await save(page, "builder-keywords");

  const mockRow = tree(page).getByRole("treeitem", {
    name: /^Mock response: Vehicle, State system/,
  });
  if ((await mockRow.count()) === 0)
    await tree(page).getByRole("button", { name: "Mock responses" }).click();
  await selectRow(page, /^Mock response: Vehicle, State system/);
  const pane = page.getByRole("region", { name: "Try a match" });
  await pane.getByLabel("Plate", { exact: true }).fill("ZZ-0001");
  await expect(card(pane, "State system")).toBeVisible();
  await page.mouse.move(0, 0);
  await save(page, "builder-try-a-match");
});

// docs/api.md "Try it with curl", call for call, so the walkthrough stays true. API only: a fresh
// request context with no browser cookies and no Origin header, as curl sends.
test("api walkthrough: the curl steps in docs/api.md", async ({ playwright, baseURL }) => {
  test.info().annotations.push({ type: "axe-skip", description: "API only; no page is opened" });
  const api = await playwright.request.newContext({ baseURL });
  try {
    const user = seededUser("dispatcher@example.test");
    const signIn = await api.post("/api/v1/auth/sign-in/email", {
      data: { email: user.email, password: user.password },
    });
    expect(signIn.status()).toBe(200);
    const meta = (await (await api.get("/api/v1/meta")).json()) as { configHash: string };
    expect(meta.configHash).toMatch(/^[0-9a-f]{64}$/);
    const submit = await api.post("/api/v1/queries", {
      headers: { "X-Requested-With": "querymodule", "Idempotency-Key": crypto.randomUUID() },
      data: {
        queryType: "VEH",
        values: { plate: "ZZ-0001", year: "26" },
        sourceIds: ["stateSource", "nationalSource"],
        mode: "normal",
        configHash: meta.configHash,
      },
    });
    expect(submit.status()).toBe(202);
    const { correlationId } = (await submit.json()) as { correlationId: string };
    await expect
      .poll(
        async () =>
          JSON.stringify(await (await api.get(`/api/v1/queries/${correlationId}`)).json()),
        { timeout: 8000 },
      )
      .toMatch(/STOLEN/);
  } finally {
    await api.dispose();
  }
});
