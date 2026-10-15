import type { Locator, Page } from "@playwright/test";
import { restoreShippedConfig, saveGapDraft } from "./admin-draft.js";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Builder layout checks from the M2 demo dry run (W2: G19, G37): measured in the real layout at
// the two demo sizes, so a clipped button or a wrapped label fails here and not in a screenshot.
// A saved draft with a second Vehicle card is the only setup; the last step puts the shipped
// config back, as the other admin specs expect it.

const ADMIN = seededUser("admin@example.test");
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
] as const;

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ emptyQueryList: true });
test.afterAll(({ browser }) => restoreShippedConfig(browser));

const tree = (page: Page) => page.getByRole("navigation", { name: "Configuration items" });

async function selectRow(page: Page, name: RegExp): Promise<void> {
  const item = tree(page).getByRole("treeitem", { name }).first();
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(item).toHaveAttribute("aria-selected", "true");
}

/** Lines of text a block shows: the distinct line tops of the text inside it. */
async function lines(target: Locator): Promise<number> {
  return target.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top / 4)));
    return tops.size;
  });
}

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size);
      await signIn(page, ADMIN);
      await saveGapDraft(page);
      await page.goto("/admin/config");
      await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");
    });

    test("[G37] tree labels do not break beside their keys, and a card's rows keep their buttons in one line", async ({
      page,
    }) => {
      await selectRow(page, /^Vehicle cards/);
      const card = tree(page).getByRole("treeitem", { name: /^1\. All results/ });
      if ((await card.count()) === 0)
        await tree(page)
          .getByRole("treeitem", { name: /^Vehicle cards/ })
          .press("ArrowRight");
      await selectRow(page, /^1\. All results/);
      // "1. All results", "Keywords and severity", "Training delegation" read on one line each:
      // the key drops under the label when both do not fit.
      for (const name of [/^1\. All results/, /^Keywords and severity/, /^Training delegation/]) {
        const label = tree(page).getByRole("treeitem", { name }).first().locator(".qm-tree__label");
        await label.scrollIntoViewIfNeeded();
        expect(await lines(label), `${name} on one line`).toBe(1);
      }
      // Each row's Edit, Move and Remove buttons are as tall as one another and share one line.
      const editor = page.getByTestId("form-tab");
      const tools = editor.locator(".qm-mock__scenario-tools--row");
      await tools.first().scrollIntoViewIfNeeded();
      const count = await tools.count();
      expect(count).toBeGreaterThan(2);
      const lefts: number[] = [];
      const removeLefts: number[] = [];
      for (let i = 0; i < count; i++) {
        const buttons = tools.nth(i).getByRole("button");
        const boxes = await buttons.evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return { top: r.top, left: r.left, height: r.height };
          }),
        );
        lefts.push(Math.round(boxes[0]?.left ?? 0));
        removeLefts.push(
          Math.round(
            await tools
              .nth(i)
              .getByRole("button", { name: /^Remove / })
              .evaluate((el) => el.getBoundingClientRect().left),
          ),
        );
        const heights = boxes.map((b) => Math.round(b.height));
        expect(new Set(heights).size, `row ${i} button heights ${heights}`).toBe(1);
        const tops = boxes.map((b) => Math.round(b.top));
        // One line, or two when the pane is narrow: never staggered by more than a button.
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual((heights[0] ?? 0) + 8);
      }
      // Move up and Move down are on every row (icon only, 36 px), disabled at the two ends.
      const ups = tools.getByRole("button", { name: /^Move .* up$/ });
      const downs = tools.getByRole("button", { name: /^Move .* down$/ });
      expect(await ups.count(), "a Move up on every row").toBe(count);
      expect(await downs.count(), "a Move down on every row").toBe(count);
      await expect(ups.first()).toHaveAttribute("aria-disabled", "true");
      await expect(downs.last()).toHaveAttribute("aria-disabled", "true");
      await expect(ups.last()).not.toHaveAttribute("aria-disabled", "true");
      const size = await ups.first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      expect(size.h, "Move up height").toBeGreaterThanOrEqual(36);
      expect(size.w, "Move up width").toBeGreaterThanOrEqual(36);
      const upLefts = await ups.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().left)),
      );
      expect(
        Math.max(...upLefts) - Math.min(...upLefts),
        `Move up left edges ${upLefts}`,
      ).toBeLessThanOrEqual(1);
      // Remove is icon only like the Moves, 36 px, named "Remove <row>" (demo polish 7).
      const removes = tools.getByRole("button", { name: /^Remove / });
      expect(await removes.count(), "a Remove on every row").toBe(count);
      expect((await removes.first().textContent())?.trim(), "Remove has no words").toBe("×");
      const removeSize = await removes.first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      expect(removeSize.h, "Remove height").toBeGreaterThanOrEqual(36);
      expect(removeSize.w, "Remove width").toBeGreaterThanOrEqual(36);
      // Remove too: a first row with no Move up keeps its slot, so the columns line up.
      expect(
        Math.max(...removeLefts) - Math.min(...removeLefts),
        `Remove row left edges ${removeLefts}`,
      ).toBeLessThanOrEqual(1);
      // Every row's first button (Edit) starts at the same left edge.
      expect(
        Math.max(...lefts) - Math.min(...lefts),
        `Edit left edges ${lefts}`,
      ).toBeLessThanOrEqual(1);
    });

    test("[G37] mock tree rows keep one line each, with the key under", async ({ page }) => {
      const mock = tree(page).getByRole("treeitem", {
        name: /^Mock response: Vehicle, State system/,
      });
      await mock.scrollIntoViewIfNeeded();
      const label = mock.locator(".qm-tree__label");
      await expect(label).toHaveText("Vehicle");
      expect(await lines(label), "mock row label lines").toBe(1);
      const source = tree(page).getByRole("treeitem", { name: /^Mock source: State system/ });
      expect(await lines(source.locator(".qm-tree__label")), "mock source label lines").toBe(1);
    });

    test("[G18] the review dialog's section heading is smaller than its title", async ({
      page,
    }) => {
      await page.getByRole("button", { name: "Review and publish" }).click();
      const dialog = page.getByRole("dialog", { name: "Review and publish" });
      await expect(dialog).toBeVisible();
      const size = (name: string, level: number) =>
        dialog
          .getByRole("heading", { name, level })
          .first()
          .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      const title = await dialog
        .locator("h1, h2")
        .first()
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      const section = await size("Changes from the live version", 3);
      expect(section).toBeLessThan(title);
    });

    test("[G37] the Which card wins cells stay within three lines", async ({ page }) => {
      await selectRow(page, /^Vehicle cards/);
      const card = tree(page).getByRole("treeitem", { name: /^1\. All results/ });
      if ((await card.count()) === 0)
        await tree(page)
          .getByRole("treeitem", { name: /^Vehicle cards/ })
          .press("ArrowRight");
      await selectRow(page, /^1\. All results/);
      const table = page.getByRole("table", { name: "Which card wins" });
      await table.scrollIntoViewIfNeeded();
      const cells = table.locator("tbody td");
      const n = await cells.count();
      expect(n).toBeGreaterThan(8);
      for (let i = 0; i < n; i++) {
        expect(
          await lines(cells.nth(i)),
          `cell ${i}: ${await cells.nth(i).innerText()}`,
        ).toBeLessThanOrEqual(3);
      }
    });

    test("[G17] the style color selects show their whole plain name", async ({ page }) => {
      await selectRow(page, /^Keywords and severity/);
      for (const name of ["Text color", "Background color"]) {
        const select = page.getByRole("combobox", { name }).first();
        await select.scrollIntoViewIfNeeded();
        const clipped = await select.evaluate((el) => {
          const box = el as HTMLSelectElement;
          const text = box.selectedOptions[0]?.textContent ?? "";
          const probe = document.createElement("span");
          const style = getComputedStyle(box);
          probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${style.font}`;
          probe.textContent = text;
          document.body.append(probe);
          const need = probe.getBoundingClientRect().width;
          probe.remove();
          // Room for the text: the select's width less its padding, border and arrow (about 30 px).
          return need > box.getBoundingClientRect().width - 30;
        });
        expect(clipped, `${name} select clips its text`).toBe(false);
      }
    });

    test("[G19] every scenario's tools end inside the editor pane", async ({ page }) => {
      await selectRow(page, /^Mock response: Vehicle, State system/);
      const editor = page.getByTestId("form-tab");
      const scenarios = editor.locator(".qm-mock__scenario");
      await scenarios.first().scrollIntoViewIfNeeded();
      const pane = await editor.evaluate((el) => el.getBoundingClientRect().right);
      const count = await scenarios.count();
      expect(count).toBeGreaterThan(1);
      for (let i = 0; i < count; i++) {
        const remove = scenarios.nth(i).getByRole("button", { name: /^Remove scenario/ });
        await expect(remove).toBeVisible();
        const right = await remove.evaluate((el) => el.getBoundingClientRect().right);
        expect(right, `scenario ${i + 1}'s Remove button right edge`).toBeLessThanOrEqual(pane);
      }
    });
  });
}
