import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// BW3 polish (#642; ruling of 10-17-26): a card row's Columns table stacks where the editor pane is
// narrow (under 720 px, the toolbar breakpoint: the 1366 and 1024 layouts), and Show in is a
// segmented control. Measured, not pictured: nothing scrolls sideways, the inputs keep a usable
// width, Path and Label share a line, Format sits under them, and the three Show in segments share
// one line. Nothing is saved: the row is added to the draft in the page only. With
// COLUMNS_SHOTS_DIR set it also writes the screenshots.
//   COLUMNS_SHOTS_DIR=<dir> E2E_PORT=<port> pnpm e2e admin-columns-layout.spec.ts

const ADMIN = seededUser("admin@example.test");
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
] as const;
const DIR = process.env.COLUMNS_SHOTS_DIR;
/** The width at which the Columns table stacks (shell.css, @container qm-columns). */
const STACK_AT = 720;

test.use({ emptyQueryList: true, colorScheme: "light", reducedMotion: "reduce" });

const tree = (page: Page) => page.getByRole("navigation", { name: "Configuration items" });

async function selectRow(page: Page, name: RegExp): Promise<void> {
  const item = tree(page).getByRole("treeitem", { name }).first();
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(item).toHaveAttribute("aria-selected", "true");
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("the control has no box: it is not on screen");
  return b;
}

for (const size of SIZES) {
  test(`[#642] Columns stack in a narrow pane and Show in is one line at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await signIn(page, ADMIN);
    await page.goto("/admin/config");
    await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");
    const first = tree(page).getByRole("treeitem", { name: /^1\. All results/ });
    if ((await first.count()) === 0) {
      await selectRow(page, /^Vehicle cards/);
      if ((await first.count()) === 0)
        await tree(page)
          .getByRole("treeitem", { name: /^Vehicle cards/ })
          .press("ArrowRight");
    }
    await selectRow(page, /^1\. All results/);

    const form = page.getByTestId("form-tab");
    await form.getByRole("button", { name: "Add row" }).click();
    await form.getByRole("radio", { name: "Table" }).check();
    const table = form.getByRole("table", { name: "Columns" });
    await expect(table).toBeVisible();
    const wrap = form
      .locator("div.qm-columns")
      .filter({ has: page.getByRole("table", { name: "Columns" }) });
    await wrap.scrollIntoViewIfNeeded();
    const wrapBox = await box(wrap);

    if (DIR !== undefined && DIR !== "") {
      mkdirSync(DIR, { recursive: true });
      await wrap.screenshot({ path: join(DIR, `columns-${size.width}.png`) });
      await form.getByRole("group", { name: "Show in" }).screenshot({
        path: join(DIR, `show-in-${size.width}.png`),
      });
    }
    // Both demo sizes are narrow panes: the table must stack there. Taken from the measurement, a
    // wider pane would quietly check the table layout and still pass.
    expect(wrapBox.width, "the pane is under the stack width at this size").toBeLessThanOrEqual(
      STACK_AT,
    );

    // Nothing scrolls sideways, in the table's wrapper or the pane around it.
    const overflow = await wrap.evaluate((el) => {
      const pane = el.closest('[role="tabpanel"]') ?? el;
      return {
        wrap: el.scrollWidth - el.clientWidth,
        pane: pane.scrollWidth - pane.clientWidth,
      };
    });
    expect(overflow.wrap, "the Columns wrapper scrolls sideways").toBeLessThanOrEqual(1);
    expect(overflow.pane, "the editor pane scrolls sideways").toBeLessThanOrEqual(1);

    const path = table.getByLabel("Path of column 1");
    const label = table.getByLabel("Label of column 1");
    const format = table.getByLabel("Format of column 1");
    const [p, l, f] = [await box(path), await box(label), await box(format)];
    // The inputs keep room for a path or a format name ("As sent"): no truncation to a few letters.
    for (const [name, b] of [
      ["path", p],
      ["label", l],
      ["format", f],
    ] as const)
      expect(b.width, `${name} input is too narrow`).toBeGreaterThanOrEqual(110);
    // Path and Label on one line, Format on the next, nothing overlapping.
    expect(Math.abs(p.y - l.y)).toBeLessThanOrEqual(2);
    expect(l.x).toBeGreaterThanOrEqual(p.x + p.width - 1);
    expect(f.y).toBeGreaterThanOrEqual(p.y + p.height - 1);
    // The caption of each cell is drawn above its control: the CSS half of the markup's data-label.
    const firstCell = table.locator("tbody td").first();
    await expect(firstCell).toHaveAttribute("data-label", "Path");
    expect(await firstCell.evaluate((el) => getComputedStyle(el, "::before").content)).toContain(
      "Path",
    );

    // Show in: three segments of one control on one line, inside the pane.
    const show = form.getByRole("group", { name: "Show in" });
    const segments = show.locator("label.qm-seg__option");
    await expect(segments).toHaveCount(3);
    const boxes = [
      await box(segments.nth(0)),
      await box(segments.nth(1)),
      await box(segments.nth(2)),
    ];
    for (const b of boxes) expect(Math.abs(b.y - (boxes[0]?.y ?? 0))).toBeLessThanOrEqual(2);
    const paneBox = await box(form);
    const last = boxes[2] ?? wrapBox;
    expect(last.x + last.width).toBeLessThanOrEqual(paneBox.x + paneBox.width + 1);
  });
}
