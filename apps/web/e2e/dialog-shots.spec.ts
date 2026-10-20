import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { restoreShippedConfig, saveGapDraft } from "./admin-draft.js";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Screenshots of every dialog on the shared dialog frame (#835, BW3b: 560 px, header and footer
// dividers, ghost Cancel beside a main action) for the mockup v6 comparison, at the two demo sizes,
// plus the publish dialog and the account menu in the night theme (the captions and dividers must
// read in both). Not a test of behavior: skipped unless DIALOG_SHOTS_DIR is set. Every dialog is
// closed with its safe choice; the published version is put back afterwards.
//   DIALOG_SHOTS_DIR=<dir> E2E_PORT=<port> pnpm e2e dialog-shots.spec.ts --project=chromium

const DIR = process.env.DIALOG_SHOTS_DIR;
const ADMIN = seededUser("admin@example.test");
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
] as const;

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.skip(DIR === undefined || DIR === "", "set DIALOG_SHOTS_DIR to take the screenshots");
test.use({ emptyQueryList: true, reducedMotion: "reduce" });

test.afterAll(({ browser }) => restoreShippedConfig(browser));

async function save(page: Page, name: string): Promise<void> {
  const dir = DIR ?? "";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

/** Opens the review dialog over the saved gap draft. */
async function openPublish(page: Page) {
  await saveGapDraft(page);
  await page.goto("/admin/config");
  await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");
  await page.getByRole("button", { name: "Review and publish" }).click();
  const dialog = page.getByRole("dialog", { name: /^Publish version \d+$/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const size of SIZES) {
  const w = size.width;
  test.describe(`light at ${w}`, () => {
    test.use({ colorScheme: "light" });

    test(`publish and roll back at ${w}`, async ({ page, browser }) => {
      await restoreShippedConfig(browser);
      await page.setViewportSize(size);
      await signIn(page, ADMIN);
      const publish = await openPublish(page);
      await save(page, `dialog-publish-${w}`);
      await publish.getByRole("button", { name: /^Publish version \d+$/ }).click();
      await expect(page.getByText(/^Published version \d+\./).first()).toBeVisible();
      await page.getByRole("button", { name: "History" }).click();
      const drawer = page.getByRole("region", { name: "Version history" });
      await drawer
        .getByRole("button", { name: /^Roll back to version \d+$/ })
        .first()
        .click();
      const rollback = page.getByRole("dialog", { name: /^Roll back to version \d+\?$/ });
      await expect(rollback).toBeVisible();
      await save(page, `dialog-rollback-${w}`);
      await rollback.getByRole("button", { name: "Cancel" }).click();
    });

    test(`sign out with unsaved edits at ${w}`, async ({ page }) => {
      await page.setViewportSize(size);
      await signIn(page, ADMIN);
      await page.goto("/admin/config");
      const tree = page.getByRole("navigation", { name: "Configuration items" });
      await tree.getByRole("treeitem", { name: /^Terminal settings/ }).click();
      await page.getByRole("textbox", { name: "Delimiter", exact: true }).fill("~");
      await page.getByRole("button", { name: "admin@example.test" }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Sign out with unsaved edits?" });
      await expect(dialog).toBeVisible();
      await save(page, `dialog-leave-${w}`);
      await dialog.getByRole("button", { name: "Stay signed in" }).click();
    });

    test(`users: create and disable at ${w}`, async ({ page }) => {
      await page.setViewportSize(size);
      await signIn(page, ADMIN);
      await page.goto("/admin/users");
      await page.getByRole("button", { name: "Create user" }).click();
      const create = page.getByRole("dialog", { name: "Create user" });
      await expect(create).toBeVisible();
      await save(page, `dialog-create-user-${w}`);
      await create.getByRole("button", { name: "Cancel" }).click();
      await expect(create).toBeHidden();
      const disable = page.getByRole("button", { name: /^Disable / }).first();
      await disable.click();
      const confirm = page.getByRole("dialog", { name: /^Disable .+\?$/ });
      await expect(confirm).toBeVisible();
      await save(page, `dialog-disable-user-${w}`);
      await confirm.getByRole("button", { name: "Cancel" }).click();
    });
  });
}

test.describe("night theme at 1366", () => {
  test.use({ colorScheme: "dark" });

  test("publish dialog and account menu in the night theme", async ({ page, browser }) => {
    await restoreShippedConfig(browser);
    await page.setViewportSize(SIZES[0]);
    await signIn(page, ADMIN);
    const publish = await openPublish(page);
    await save(page, "dialog-publish-night-1366");
    await publish.getByRole("button", { name: "Cancel" }).click();
    await page.goto("/");
    await expect(page.getByLabel("Plate", { exact: true })).toBeVisible();
    await page.getByRole("banner").locator(".qm-account__button").click();
    await expect(page.getByRole("group", { name: "Theme" })).toBeVisible();
    await save(page, "account-menu-night-1366");
  });
});
