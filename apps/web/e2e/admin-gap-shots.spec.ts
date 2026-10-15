import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { restoreShippedConfig, saveGapDraft } from "./admin-draft.js";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Admin and builder screenshots for the M2 demo dry-run gaps (W2: G3, G15 to G20, G22, G37 to G39).
// Not a test of behavior: skipped unless GAP_SHOTS_DIR is set. It signs in as the seeded admin,
// saves one draft through the API (a warning keyword TESTMAKE and Make moved to the summary),
// publishes it, rolls back, and photographs each screen at the two demo sizes. The last step puts
// the first version back, as the other admin specs expect the shipped config.
//   GAP_SHOTS_DIR=<dir> E2E_PORT=<port> pnpm e2e admin-gap-shots.spec.ts

const DIR = process.env.GAP_SHOTS_DIR;
const ADMIN = seededUser("admin@example.test");
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
] as const;

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.skip(DIR === undefined || DIR === "", "set GAP_SHOTS_DIR to take the screenshots");
test.use({ emptyQueryList: true, colorScheme: "light", reducedMotion: "reduce" });

test.afterAll(({ browser }) => restoreShippedConfig(browser));

async function save(target: Page | Locator, name: string, size: number): Promise<void> {
  const dir = DIR ?? "";
  mkdirSync(dir, { recursive: true });
  await target.screenshot({ path: join(dir, `${name}-${size}.png`) });
}

const tree = (page: Page) => page.getByRole("navigation", { name: "Configuration items" });

async function selectRow(page: Page, name: RegExp): Promise<void> {
  const item = tree(page).getByRole("treeitem", { name }).first();
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(item).toHaveAttribute("aria-selected", "true");
}

/** Opens the Vehicle query type's first card: its row, expanded, then the card. */
async function openFirstCard(page: Page): Promise<void> {
  const first = tree(page).getByRole("treeitem", { name: /^1\. All results/ });
  if ((await first.count()) === 0) {
    await selectRow(page, /^Vehicle cards/);
    if ((await first.count()) === 0)
      await tree(page)
        .getByRole("treeitem", { name: /^Vehicle cards/ })
        .press("ArrowRight");
  }
  await selectRow(page, /^1\. All results/);
}

for (const size of SIZES) {
  test(`admin shots at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await signIn(page, ADMIN);
    // A draft from an earlier size is the live version's again before this one starts.
    await saveGapDraft(page);
    await page.goto("/admin/config");
    const status = page.getByTestId("draft-status");
    await expect(status).toContainText("Draft, based on version");
    const w = size.width;

    // G15, G16, G37: the rail, the tree and its note.
    await save(page, "g15-builder-open", w);
    await tree(page).evaluate((el) => {
      const scroller = el.closest(".qm-tree, nav") ?? el;
      scroller.scrollTop = scroller.scrollHeight;
    });
    await save(tree(page), "g16-tree-note", w);

    // G18: the Changes view and the review dialog.
    await page.getByRole("tab", { name: "Changes" }).click();
    await expect(page.getByText(/TESTMAKE/).first()).toBeVisible();
    await save(page, "g18-changes", w);
    await page.getByRole("tab", { name: "Form" }).click();

    // G38, G22: the card preview wording, scenario copy and Try a match.
    await openFirstCard(page);
    await save(page, "g22-card-preview", w);
    await selectRow(page, /^Mock response: Vehicle, State system/);
    await save(page, "g38-mock-scenarios", w);
    const plate = page.getByLabel("Plate", { exact: true });
    await plate.fill("ZZ-0001");
    await save(page, "g22-try-a-match", w);

    // G18, G20, G39: review and publish, history, roll back.
    await page.getByRole("button", { name: "Review and publish" }).click();
    const dialog = page.getByRole("dialog", { name: "Review and publish" });
    await expect(dialog).toBeVisible();
    await save(page, "g18-review-dialog", w);
    const confirm = dialog.getByRole("button", { name: /^Publish version \d+$/ });
    const version = Number(/\d+/.exec(await confirm.innerText())?.[0]);
    await confirm.click();
    await expect(page.getByText(`Published version ${version}.`).first()).toBeVisible();
    await page.getByRole("button", { name: "History" }).click();
    const history = page.getByRole("region", { name: "Version history" });
    await expect(history).toBeVisible();
    await save(page, "g39-history", w);
    await history
      .getByRole("button", { name: /^Roll back to version \d+$/ })
      .last()
      .click();
    const confirmRollback = page.getByRole("dialog", { name: /^Roll back to version \d+\?$/ });
    await confirmRollback.getByRole("button", { name: /^Roll back to version \d+$/ }).click();
    await expect(page.getByText(/roll back of version/).first()).toBeVisible();
    await expect(status).toContainText("No unpublished changes.");
    await save(page, "g20-after-roll-back", w);

    // G39: Users and roles.
    await page.getByRole("link", { name: "Users and roles" }).click();
    await expect(page.getByRole("heading", { name: "Users and roles", level: 2 })).toBeVisible();
    await save(page, "g39-users", w);
  });
}

for (const size of SIZES) {
  test(`builder layout shots at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await signIn(page, ADMIN);
    await saveGapDraft(page);
    await page.goto("/admin/config");
    await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");
    const w = size.width;
    const editor = page.getByTestId("form-tab");

    // G37: the tree (labels one line, keys beside or under), the card editor's rows and the table.
    await tree(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    await openFirstCard(page);
    await save(page, "g37-tree-and-card", w);
    await page.getByRole("heading", { level: 4, name: "Rows" }).scrollIntoViewIfNeeded();
    await save(page, "g37-card-rows", w);
    await page.getByRole("heading", { level: 4, name: "Which card wins" }).scrollIntoViewIfNeeded();
    await save(page, "g37-which-card-wins", w);

    // G3, G17: Keywords and severity: Add keyword with no word; the style selects.
    await selectRow(page, /^Keywords and severity/);
    await page.getByRole("button", { name: "Add keyword" }).click();
    await page.getByRole("button", { name: "Add keyword" }).scrollIntoViewIfNeeded();
    await save(page, "g3-add-keyword-empty", w);
    await page.getByRole("heading", { level: 4, name: "Severity styles" }).scrollIntoViewIfNeeded();
    await page.getByRole("combobox", { name: "Background color" }).first().scrollIntoViewIfNeeded();
    await save(page, "g17-severity-styles", w);

    // G19: the mock editor's scenario list.
    await selectRow(page, /^Mock response: Vehicle, State system/);
    await page
      .getByRole("heading", { level: 4, name: /^Scenarios \(\d+\)$/ })
      .scrollIntoViewIfNeeded();
    await save(page, "g19-scenarios", w);

    // G22: the card preview opens on the first scenario that answers with a record.
    await openFirstCard(page);
    await expect(page.getByRole("combobox", { name: "Scenario" })).toHaveValue("0:0");
    await expect(editor).toBeVisible();
    await page.getByRole("region", { name: "Card preview" }).scrollIntoViewIfNeeded();
    await save(page, "g22-preview-opens-on-record", w);
  });
}
