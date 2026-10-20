import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { restoreShippedConfig, saveGapDraft } from "./admin-draft.js";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Screenshots of the M2 P2 audit screens for the v6 mockup comparison (BW5 Task 9): the audit log,
// the admin request view, the history drawer with a publish note and the publisher name, and the
// terminal beside the results, at the two demo sizes. Not a test of behavior: skipped unless
// AUDIT_SHOTS_DIR is set. The purged card has no end-to-end path (no retention sweep runs in the
// e2e server and a result cannot be purged from the client), so its frame is covered by the
// ResultCard unit render and not photographed here.
//   AUDIT_SHOTS_DIR=<dir> E2E_PORT=<port> pnpm e2e audit-shots.spec.ts --project=chromium

const DIR = process.env.AUDIT_SHOTS_DIR;
const ADMIN = seededUser("admin@example.test");
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
] as const;
const PREFERENCES = "/api/v1/me/preferences";
const API_HEADERS = { "X-Requested-With": "querymodule" };

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.skip(DIR === undefined || DIR === "", "set AUDIT_SHOTS_DIR to take the screenshots");
test.use({ emptyQueryList: true, colorScheme: "light", reducedMotion: "reduce" });

test.afterAll(({ browser }) => restoreShippedConfig(browser));

async function save(page: Page, name: string, width: number): Promise<void> {
  const dir = DIR ?? "";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}-${width}.png`) });
}

/** Sends one plate query as the admin so the audit log has a request row to open. */
async function submitOneQuery(page: Page): Promise<void> {
  const field = page.getByLabel("Plate", { exact: true });
  await field.fill("ZZ-0001");
  await field.press("Enter");
  await expect(page.getByTestId("announcer-polite")).not.toHaveText("");
}

for (const size of SIZES) {
  test(`audit log and request view at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await signIn(page, ADMIN);
    await expect(page.getByLabel("Plate", { exact: true })).toBeVisible();
    await submitOneQuery(page);
    const w = size.width;

    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: "Audit log", level: 2 })).toBeVisible();
    await expect(page.getByRole("table").first()).toBeVisible();
    await save(page, "audit-log", w);

    const open = page.getByRole("link", { name: /open this request/ }).first();
    await open.click();
    await expect(page.getByText("This view is recorded in the audit log.")).toBeVisible();
    await expect(page.getByText("Loading request.")).toBeHidden();
    await save(page, "request-view", w);
  });
}

for (const size of SIZES) {
  test(`history drawer with a note at ${size.width}x${size.height}`, async ({ page, browser }) => {
    // The first size publishes the gap draft; reset so the second size starts from the shipped version.
    await restoreShippedConfig(browser);
    await page.setViewportSize(size);
    await signIn(page, ADMIN);
    await saveGapDraft(page);
    await page.goto("/admin/config");
    await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");
    const w = size.width;

    await page.getByRole("button", { name: "Review and publish" }).click();
    const dialog = page.getByRole("dialog", { name: /^Publish version \d+$/ });
    await expect(dialog).toBeVisible();
    const note = dialog.getByRole("textbox", { name: /note/i });
    // The note field needs the client-side build of Task 5; a missing one fails the spec loudly.
    await note.fill("Moved Make to the summary and added the TESTMAKE keyword.");
    await save(page, "publish-note", w);
    await dialog.getByRole("button", { name: /^Publish version \d+$/ }).click();
    await expect(page.getByText(/^Published version \d+\./).first()).toBeVisible();
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("region", { name: "Version history" })).toBeVisible();
    await save(page, "history-note", w);
  });
}

for (const size of SIZES) {
  test(`terminal pane at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await signIn(page, ADMIN);
    const before = (await (await page.request.get(PREFERENCES)).json()) as { layout: unknown };
    try {
      await page.request.put(PREFERENCES, {
        data: { ...before, layout: { orientation: "horizontal", terminal: "pane" } },
        headers: API_HEADERS,
      });
      await page.goto("/");
      await expect(page.getByLabel("Plate", { exact: true })).toBeVisible();
      await page.getByLabel("Plate", { exact: true }).fill("ZZ-0001");
      await save(page, "terminal-pane", size.width);
    } finally {
      await page.request.put(PREFERENCES, {
        data: { ...before, layout: before.layout },
        headers: API_HEADERS,
      });
    }
  });
}

// The v6 frames BW5 left without a shot (#774): the account menu's terminal preference and its
// failed save, and the audit log's empty, no access (403), turned off (404), filter error and pager
// states. Server states are routed in the browser; nothing is changed on the server.
for (const size of SIZES) {
  test(`account menu preference and save failed at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await signIn(page, ADMIN);
    await expect(page.getByLabel("Plate", { exact: true })).toBeVisible();
    const account = page.getByRole("banner").locator(".qm-account__button");
    await account.click();
    await expect(page.getByRole("group", { name: "Terminal" })).toBeVisible();
    await save(page, "account-preference", size.width);
    await page.route(`**${PREFERENCES}`, (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 500, json: {} })
        : route.continue(),
    );
    await page
      .getByRole("group", { name: "Terminal" })
      .getByRole("button", { name: "Beside results" })
      .click();
    await expect(
      page.getByText("Could not save the layout. It stays on In the panel."),
    ).toBeVisible();
    await save(page, "account-save-failed", size.width);
  });

  test(`audit log states at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await signIn(page, ADMIN);
    await expect(page.getByLabel("Plate", { exact: true })).toBeVisible();
    const w = size.width;
    await page.goto("/admin/audit");
    await expect(page.getByRole("table").first()).toBeVisible();

    // Pager: the bottom of the loaded table.
    await page.getByRole("navigation", { name: "Audit pages" }).scrollIntoViewIfNeeded();
    await save(page, "audit-pager", w);

    // Filter error: a request ID that is not a UUIDv7.
    await page.getByRole("textbox", { name: "Request ID" }).fill("0192f3a1-7c2e-4b10");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("textbox", { name: "Request ID" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await save(page, "audit-filter-error", w);

    // Empty: the server answers with no rows.
    await page.route("**/api/v1/admin/audit?*", (route) =>
      route.fulfill({ json: { events: [], nextCursor: null } }),
    );
    await page.getByRole("button", { name: "Reset" }).first().click();
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText("No audit events match")).toBeVisible();
    await save(page, "audit-empty", w);

    for (const [status, name] of [
      [403, "audit-403"],
      [404, "audit-404"],
    ] as const) {
      await page.unroute("**/api/v1/admin/audit?*");
      await page.route("**/api/v1/admin/audit?*", (route) => route.fulfill({ status, json: {} }));
      await page.goto("/admin/audit");
      await expect(page.locator(".qm-audit__state").first()).toBeVisible();
      await save(page, name, w);
    }
  });
}
