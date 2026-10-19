import type { Page } from "@playwright/test";
import { restoreShippedConfig, saveGapDraft } from "./admin-draft.js";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

/**
 * BR-001, UX-004, D-M2P0-4 (ADR-0011 item 1): a publish takes an optional note; the history drawer
 * shows each version's note and the publisher's name. Signed in as the seeded admin; the shipped
 * config is put back afterwards, as the other admin specs expect it.
 */

const ADMIN = seededUser("admin@example.test");
const NOTE = "Moved Make to the summary and added the TESTMAKE keyword.";

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.afterAll(({ browser }) => restoreShippedConfig(browser));

async function adminName(page: Page): Promise<string> {
  const response = await page.request.get("/api/v1/auth/get-session");
  return ((await response.json()) as { user: { name: string } }).user.name;
}

test("[BR-001] a publish note and the publisher's name show in the history drawer", async ({
  page,
}) => {
  await signIn(page, ADMIN);
  const name = await adminName(page);
  await saveGapDraft(page);
  await page.goto("/admin/config");
  await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");

  await page.getByRole("button", { name: "Review and publish" }).click();
  const dialog = page.getByRole("dialog", { name: "Review and publish" });
  await expect(dialog).toBeVisible();
  const note = dialog.getByRole("textbox", { name: /note/i });
  await note.fill(NOTE);
  await expect(dialog.getByText(`${NOTE.length} of 200`)).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await dialog.getByRole("button", { name: /^Publish version \d+$/ }).click();
  const toast = page.getByText(/^Published version \d+\./).first();
  await expect(toast).toBeVisible();
  const version = Number(/\d+/.exec(await toast.innerText())?.[0]);

  await page.getByRole("button", { name: "History" }).click();
  const history = page.getByRole("region", { name: "Version history" });
  await expect(history).toBeVisible();
  // Other specs publish and roll back too, so every check is scoped to this publish's own entry
  // (and a CI retry, which publishes again, finds its own version, not the first attempt's).
  const entry = (n: number) =>
    history.getByRole("listitem").filter({ hasText: new RegExp(`^Version ${n}(?!\\d)`) });
  await expect(entry(version).getByText(NOTE)).toBeVisible();
  await expect(entry(version).getByText(`Published by ${name}`)).toBeVisible();
  // The shipped first version was published by the system, which has no name to show.
  await expect(entry(1).getByText("Published by system (name not available)")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});
