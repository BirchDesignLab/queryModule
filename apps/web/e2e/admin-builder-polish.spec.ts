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
      for (const th of await table.locator("thead th").all()) {
        expect(await lines(th), `heading "${await th.innerText()}"`).toBe(1);
        // One line is not enough: a heading wider than its column runs into the next one.
        const spill = await th.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(spill, `heading "${await th.innerText()}" runs past its column`).toBeLessThanOrEqual(
          1,
        );
      }
      // The new heading style adds no sideways scroll to the table or the pane around it.
      const overflow = await table.evaluate((el) => {
        const pane = el.closest(".qm-builder__editor") ?? el;
        return {
          table: el.scrollWidth - el.clientWidth,
          pane: pane.scrollWidth - pane.clientWidth,
        };
      });
      expect(overflow.table, "the table scrolls sideways").toBeLessThanOrEqual(1);
      expect(overflow.pane, "the editor scrolls sideways").toBeLessThanOrEqual(1);
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

    // (d): the controls of the toolbar are one row, as the mockup draws them; wrapping is a defect.
    test("[#698 (d)] the toolbar's controls share one row, and it names the version it publishes", async ({
      page,
    }) => {
      const bar = page.locator(".qm-builder__toolbar");
      const centers = await bar.evaluate((el) =>
        [...el.children]
          .filter((c) => c.matches("button, [role=tablist]") && c.getClientRects().length > 0)
          .map((c) => {
            const r = c.getBoundingClientRect();
            return Math.round(r.top + r.height / 2);
          }),
      );
      expect(centers.length, "toolbar controls").toBeGreaterThanOrEqual(6);
      expect(
        Math.max(...centers) - Math.min(...centers),
        `control centers ${centers}`,
      ).toBeLessThanOrEqual(4);
      // Nothing to publish yet: the line under the buttons says so. The version line is in a unit test.
      await expect(
        bar.getByRole("button", { name: "Review and publish" }),
      ).toHaveAccessibleDescription(
        /^(Nothing to publish|Publishes version \d+ to every open screen)/,
      );
    });

    // (g): nothing in the builder is cut off by an ellipsis (or clipped), at the two demo sizes.
    for (const [label, open] of [
      ["a card", (page: Page) => openCard(page, /^Wanted check cards/)],
      ["the keywords", (page: Page) => selectRow(page, /^Keywords and severity/)],
      ["a mock response", (page: Page) => selectRow(page, /^Vehicle VEH|^Mock response: Vehicle/)],
    ] as const)
      test(`[#698 (g)] no text is cut off by an ellipsis: ${label}`, async ({ page }) => {
        await open(page);
        const cut = await page
          .locator(".qm-builder__scope, .qm-builder")
          .first()
          .evaluate((root) => {
            const out: string[] = [];
            for (const el of root.querySelectorAll<HTMLElement>("*")) {
              const style = getComputedStyle(el);
              // A visually hidden or clipped-away helper (the skip links, the words for a screen
              // reader) is one pixel wide on purpose.
              if (style.display === "none" || el.clientWidth <= 2) continue;
              const clips = style.textOverflow === "ellipsis" || style.overflow === "hidden";
              if (!clips || el.scrollWidth <= el.clientWidth + 1) continue;
              const text = (el.textContent ?? "").trim();
              if (text !== "") out.push(`${el.className || el.tagName}: ${text.slice(0, 40)}`);
            }
            return out;
          });
        expect(cut, "cut off").toEqual([]);
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

for (const viewport of [
  { width: 1100, height: 800 },
  { width: 1024, height: 768 },
]) {
  test(`[#680 N2] at ${viewport.width}x${viewport.height} the editor keeps a usable height inside the section`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await signIn(page, ADMIN);
    await page.goto("/admin/config");
    await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");
    await openCard(page, /^Vehicle cards/);
    const editorEl = page.locator(".qm-builder__editor");
    const editor = await box(editorEl);
    // Not a pixel count that a font or a wrapped status line moves: the editor is usable and takes
    // the larger share of the column, which is the design (re-walk N2).
    const previewHeight = (await box(page.getByRole("region", { name: "Card preview" }))).height;
    expect(editor.height, "editor height").toBeGreaterThanOrEqual(270);
    expect(editor.height, "editor against the preview").toBeGreaterThan(previewHeight * 1.2);
    // The page does not scroll (the panes area does), and the editor is a bounded scroll area.
    const page_ = await page.evaluate(() => {
      const root = document.scrollingElement as Element;
      return root.scrollHeight - root.clientHeight;
    });
    expect(page_, "page scroll").toBeLessThanOrEqual(0);
    const scroll = await editorEl.evaluate((el) => ({
      content: el.scrollHeight,
      shown: el.clientHeight,
    }));
    expect(scroll.content, "the editor scrolls inside its pane").toBeGreaterThan(scroll.shown);
    // The preview sits under the editor, in the first screen (re-walk R15).
    const preview = await box(page.getByRole("region", { name: "Card preview" }));
    expect(preview.y, "preview top").toBeLessThan(viewport.height);
  });
}
