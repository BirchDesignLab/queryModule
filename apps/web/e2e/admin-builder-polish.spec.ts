import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// #698: the comparison of the cards builder with the v5 mockup at the two demo sizes found a few
// defects. Measured here, not pictured: the Which card wins headings read on one line and its score
// is set in the data face; a Columns path is set in the data face and the Mark box shares a line with
// Remove; the keyword sample keeps each badge on one line; the editor keeps a usable height at 1024
// (#680 N2). Nothing is saved: the shipped config is only read.

const ADMIN = seededUser("admin@example.test");
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
] as const;

test.use({ emptyQueryList: true, colorScheme: "light", reducedMotion: "reduce" });

const tree = (page: Page) => page.getByRole("navigation", { name: "Configuration items" });

async function selectRow(page: Page, name: RegExp): Promise<void> {
  const item = tree(page).getByRole("treeitem", { name }).first();
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(item).toHaveAttribute("aria-selected", "true");
}

/** The first card of a query type (rows named like "Wanted check cards"). */
async function openCard(page: Page, type: RegExp): Promise<void> {
  await selectRow(page, type);
  const card = tree(page).getByRole("treeitem", { name: /^1\. All results/ });
  if ((await card.count()) === 0)
    await tree(page).getByRole("treeitem", { name: type }).press("ArrowRight");
  await selectRow(page, /^1\. All results/);
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("the element has no box: it is not on screen");
  return b;
}

/** Lines of text a block shows: the distinct line tops of the text inside it. */
async function lines(target: Locator): Promise<number> {
  return target.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top / 4))).size;
  });
}

const family = (target: Locator) => target.evaluate((el) => getComputedStyle(el).fontFamily);

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size);
      await signIn(page, ADMIN);
      await page.goto("/admin/config");
      await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");
    });

    test("[#698] Which card wins: headings on one line, the score in the data face", async ({
      page,
    }) => {
      await openCard(page, /^Vehicle cards/);
      const table = page.getByRole("table", { name: "Which card wins" });
      await table.scrollIntoViewIfNeeded();
      for (const th of await table.locator("thead th").all())
        expect(await lines(th), `heading "${await th.innerText()}"`).toBe(1);
      const score = table.locator("tbody .qm-wins__score").first();
      await expect(score).toHaveText(/^score \d+$/);
      expect(await family(score)).toMatch(/mono/i);
    });

    test("[#698] Columns: the path is in the data face, Mark and Remove share a line", async ({
      page,
    }) => {
      await openCard(page, /^Wanted check cards/);
      const form = page.getByTestId("form-tab");
      await form
        .locator("li.qm-mock__scenario")
        .filter({ hasText: "Warrants" })
        .getByRole("button", { name: /^Edit/ })
        .click();
      const table = page.getByRole("table", { name: "Columns" });
      await table.scrollIntoViewIfNeeded();
      expect(await family(table.getByLabel("Path of column 1"))).toMatch(/mono/i);
      const mark = await box(table.getByLabel("Mark keywords in column 1"));
      const remove = await box(table.getByRole("button", { name: /Remove column/ }).first());
      const centers = [mark.y + mark.height / 2, remove.y + remove.height / 2];
      expect(
        Math.abs((centers[0] ?? 0) - (centers[1] ?? 0)),
        "Mark and Remove centers",
      ).toBeLessThanOrEqual(4);
    });

    test("[#698] Keywords: each sample badge stays on one line", async ({ page }) => {
      await selectRow(page, /^Keywords and severity/);
      const sample = page.locator(".qm-kw__sample");
      await sample.scrollIntoViewIfNeeded();
      const marks = sample.locator("mark");
      expect(await marks.count()).toBeGreaterThan(3);
      // A badge that wraps inside itself is taller than one that does not.
      const heights = await marks.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().height),
      );
      expect(
        Math.max(...heights) - Math.min(...heights),
        `badge heights ${heights}`,
      ).toBeLessThanOrEqual(2);
    });
  });
}

test("[#680 N2] at 1024 the editor pane keeps a usable height", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signIn(page, ADMIN);
  await page.goto("/admin/config");
  await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");
  await openCard(page, /^Vehicle cards/);
  const editor = await box(page.locator(".qm-builder__editor"));
  expect(editor.height, "editor height").toBeGreaterThanOrEqual(300);
});
