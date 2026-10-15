import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { chooseQueryType, chooseTheme, seededUser, signIn } from "./helpers.js";

// Product screenshots for the M2 P1 design brief (docs/briefs/, #615). Not a test of behavior: it
// is skipped unless BRIEF_SHOTS_DIR is set, signs in as the seeded demo users, types synthetic
// values only (ZZ-0001, WANTED) and publishes nothing. Day theme, 2x pixel ratio, plain names.
//   BRIEF_SHOTS_DIR=docs/briefs/shots E2E_PORT=<port> pnpm e2e brief-shots.spec.ts
// The shots are described in docs/briefs/query-module-2-design-brief-m2p1.html (`shots/NAME.png`).

const DIR = process.env.BRIEF_SHOTS_DIR;

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.skip(DIR === undefined || DIR === "", "set BRIEF_SHOTS_DIR to take the screenshots");
test.use({
  emptyQueryList: true,
  colorScheme: "light",
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});

async function save(target: Page | Locator, name: string, clipHeight?: number): Promise<void> {
  const dir = DIR ?? "";
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.png`);
  // A page frame can keep the top of the screen only, so the shot is not mostly empty background.
  if (clipHeight !== undefined && "viewportSize" in target) {
    const width = target.viewportSize()?.width ?? 0;
    await target.screenshot({ path, clip: { x: 0, y: 0, width, height: clipHeight } });
    return;
  }
  await target.screenshot({ path });
}

/**
 * A crop of the builder's editor and its side pane (the card preview or Try a match), so the brief
 * can print it at full page width with text that reads. The editor's own box is its whole scrolled
 * content, so the rows come from the side pane, which fills the visible pane height: the shot is
 * the two panes' width and at most `maxHeight` CSS pixels from the top of that row.
 */
async function saveCrop(
  page: Page,
  name: string,
  editorPane: Locator,
  sidePane: Locator,
  maxHeight: number,
): Promise<void> {
  const left = await editorPane.boundingBox();
  const side = await sidePane.boundingBox();
  if (left === null || side === null) throw new Error(`${name}: a pane has no box`);
  const dir = DIR ?? "";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: join(dir, `${name}.png`),
    clip: {
      x: left.x,
      y: side.y,
      width: side.x + side.width - left.x,
      height: Math.min(side.height, maxHeight),
    },
  });
}

/**
 * A crop of one builder pane: the pane's own width, from the top row of the side pane down to at
 * most `maxHeight` CSS pixels, so two crops can print side by side with text that reads.
 */
async function savePane(
  page: Page,
  name: string,
  pane: Locator,
  topRow: Locator,
  maxHeight: number,
): Promise<void> {
  const box = await pane.boundingBox();
  const top = await topRow.boundingBox();
  if (box === null || top === null) throw new Error(`${name}: a pane has no box`);
  const dir = DIR ?? "";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: join(dir, `${name}.png`),
    clip: { x: box.x, y: top.y, width: box.width, height: Math.min(top.height, maxHeight) },
  });
}

async function startAs(page: Page, email: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.context().clearCookies();
  await signIn(page, seededUser(email));
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  await chooseTheme(page, "day");
}

const card = (page: Page, source: string) =>
  page.getByRole("region", { name: `${source}: returned` });
const requests = (page: Page) => page.getByRole("region", { name: "Requests this shift" });

test("dispatcher shots: query panel, request status, critical card, detail table", async ({
  page,
}) => {
  // Hold the national system's status back, so the request is shown with one source settled.
  let holding = true;
  const held: string[] = [];
  let release: (() => void) | undefined;
  await page.routeWebSocket("**/api/v1/ws", (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      if (
        holding &&
        typeof message === "string" &&
        /"type":\s*"sourceStatus"/.test(message) &&
        message.includes("nationalSource")
      ) {
        held.push(message);
        return;
      }
      ws.send(message);
    });
    release = () => {
      for (const m of held.splice(0)) ws.send(m);
    };
    ws.onMessage((message) => server.send(message));
    ws.onClose((code, reason) => void server.close({ code, reason }));
    server.onClose((code, reason) => void ws.close({ code, reason }));
  });

  // The detail read the client makes once the state system settles would also report the national
  // system as returned if that source has answered by then. While holding, show that source as
  // pending in it, so the frame shows the request between the two answers.
  await page.route(/\/api\/v1\/queries\/[0-9a-f-]+$/, async (route) => {
    const response = await route.fetch();
    if (!holding || route.request().method() !== "GET") return route.fulfill({ response });
    const body: unknown = await response.json();
    const hold = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(hold);
        return;
      }
      if (typeof node !== "object" || node === null) return;
      const record = node as Record<string, unknown>;
      if (record.sourceId === "nationalSource") {
        record.status = "pending";
        delete record.payload;
      }
      for (const value of Object.values(record)) hold(value);
    };
    hold(body);
    return route.fulfill({ response, json: body });
  });
  await startAs(page, "dispatcher@example.test", 1366, 1000);
  const year = page.getByLabel("Year", { exact: true });
  await year.fill("26");
  await page.getByLabel("Plate", { exact: true }).fill("ZZ-0001");
  await expect(page.getByRole("group", { name: "Command preview" })).toContainText("ZZ-0001");
  await page.mouse.move(0, 0);
  await save(page, "query-panel", 820);

  // Submit: the acknowledgment row, the state system settled, the national system still pending.
  await page.keyboard.press("Enter");
  await expect(card(page, "State system")).toBeVisible({ timeout: 8000 });
  await expect(requests(page)).toContainText(/pending/i);
  await save(page, "requests-status", 820);

  holding = false;
  release?.();
  await expect(card(page, "National system")).toBeVisible({ timeout: 8000 });
  const item = requests(page).getByRole("listitem").first();
  await expect(
    card(page, "State system").locator("mark", { hasText: "STOLEN" }).first(),
  ).toBeVisible();
  await save(item, "card-critical");

  // A wanted check: the warrants table in the national system's detail.
  await chooseQueryType(page, "WNT");
  await page.getByLabel("Last name").fill("WANTED");
  await page.keyboard.press("Enter");
  const wanted = requests(page).getByRole("listitem").first();
  const national = wanted.getByRole("region", { name: "National system: returned" });
  await expect(national).toBeVisible({ timeout: 8000 });
  await national.getByRole("button", { name: / detail/ }).click();
  await expect(national.getByRole("region", { name: /Warrants/ }).getByRole("table")).toBeVisible();
  await page.mouse.move(0, 0);
  await save(wanted, "card-detail-table");
});

test("officer shot: a critical card at 1024x768", async ({ page }) => {
  await startAs(page, "officer@example.test", 1024, 768);
  await page.getByLabel("Year", { exact: true }).fill("26");
  const plate = page.getByLabel("Plate", { exact: true });
  await plate.focus();
  await page.keyboard.type("ZZ-0001");
  await page.keyboard.press("Enter");
  await expect(card(page, "State system")).toBeVisible({ timeout: 8000 });
  await expect(card(page, "National system")).toBeVisible({ timeout: 8000 });
  // The cards sit below the form at this size: bring the Last request region (its heading and the
  // entry) into view, then keep the frame from that heading down, so no half of the form's action
  // bar shows above it.
  const last = page.getByRole("region", { name: "Last request" });
  await last.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.mouse.move(0, 0);
  const box = await last.boundingBox();
  if (box === null) throw new Error("officer-card: the Last request region has no box");
  const top = Math.max(0, Math.floor(box.y) - 8);
  await page.screenshot({
    path: join(DIR ?? "", "officer-card.png"),
    clip: { x: 0, y: top, width: 1024, height: 768 - top },
  });
});

const tree = (page: Page) => page.getByRole("navigation", { name: "Configuration items" });
const editor = (page: Page) => page.getByTestId("form-tab");
const preview = (page: Page) => page.getByRole("region", { name: "Card preview" });

async function selectRow(page: Page, name: RegExp): Promise<void> {
  const row = tree(page).getByRole("treeitem", { name }).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

async function openBuilder(page: Page): Promise<void> {
  await startAs(page, "admin@example.test", 1500, 1000);
  await page.getByRole("link", { name: "Admin" }).press("Enter");
  await page.getByRole("link", { name: "Site configuration" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Site configuration", level: 2 })).toBeVisible();
}

test("builder shots: cards, keywords, try a match", async ({ page }) => {
  await openBuilder(page);

  // The card editor with Which card wins and the preview, on typed ZZ-0001.
  await selectRow(page, /^Vehicle cards/);
  if (
    (await tree(page)
      .getByRole("treeitem", { name: /^1\. All results veh-summary/ })
      .count()) === 0
  )
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
  await expect(preview(page).getByRole("region", { name: "State system: returned" })).toBeVisible();
  // Applies to at the top of the editor, so the crop holds it and the start of Which card wins.
  await editor(page)
    .getByText("Applies to", { exact: true })
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.mouse.move(0, 0);
  await saveCrop(page, "builder-cards", editor(page), preview(page), 650);

  // Keywords and severity with the contrast per theme.
  await selectRow(page, /^Keywords and severity/);
  await expect(
    editor(page).getByRole("heading", { level: 3, name: /^Keywords and severity/ }),
  ).toBeVisible();
  // The editor opens on the sample and keywords; the styles with their contrast per theme follow.
  await editor(page)
    .getByText(/^Severity styles$/)
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.mouse.move(0, 0);
  await savePane(page, "builder-keywords", editor(page), preview(page), 665);

  // Try a match on the state system's Vehicle response.
  const mockRow = tree(page).getByRole("treeitem", {
    name: /^Mock response: Vehicle, State system/,
  });
  if ((await mockRow.count()) === 0)
    await tree(page).getByRole("button", { name: "Mock responses" }).click();
  await selectRow(page, /^Mock response: Vehicle, State system/);
  const pane = page.getByRole("region", { name: "Try a match" });
  await pane.getByLabel("Plate", { exact: true }).fill("ZZ-0001");
  await expect(pane.getByRole("region", { name: "State system: returned" })).toBeVisible();
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[role=tabpanel], .qm-builder__editor"))
      el.scrollTop = 0;
  });
  await page.mouse.move(0, 0);
  await savePane(page, "try-a-match", pane, pane, 672);
});
