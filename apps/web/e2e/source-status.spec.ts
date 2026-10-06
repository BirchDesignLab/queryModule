import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

// Live per-source status (FR-043, FR-044, FR-065; spec 6.2, 6.6, 5.4). The local build serves mock
// sources (ALLOW_MOCK_SOURCES) and the real dispatcher, so each plate below is a canned scenario:
// ZZ-0001 and ABC123 return, FAIL1 fails at the state source, TIMEOUT times out at the national
// source. Status only: the content of a response shows with M2 P1. Nothing here reaches any real
// state or national system.

const STATE = "State system";
const NATIONAL = "National system";

async function openList(page: Page) {
  await signIn(page);
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  return page.getByRole("region", { name: "Requests this shift" });
}

/**
 * Types a plate and a year and runs it with Enter. A plate alone runs plate-only, which drops the
 * national source; the year makes it a full query, so both sources are dispatched.
 */
async function runPlate(page: Page, plate: string): Promise<void> {
  await page.getByLabel("Year", { exact: true }).fill("26");
  const field = page.getByLabel("Plate", { exact: true });
  await field.fill(plate);
  await field.press("Enter");
}

const statusLine = (page: Page, system: string, status: string) =>
  page.getByText(`${system}: ${status}`, { exact: true });

test("ZZ-0001: both sources return, in the list, and one coalesced polite summary", async ({
  page,
}) => {
  const list = await openList(page);
  await runPlate(page, "ZZ-0001");
  const row = list.getByRole("listitem").first();
  await expect(row).toContainText("Acknowledged");
  await expect(row.getByRole("group", { name: /Source status for VEH\.ZZ-0001/ })).toBeVisible();
  await expect(statusLine(page, STATE, "returned")).toBeVisible({ timeout: 5000 });
  await expect(statusLine(page, NATIONAL, "returned")).toBeVisible({ timeout: 5000 });
  // The summary speaks counts and words only: never the plate, never a payload.
  const polite = page.getByTestId("announcer-polite");
  await expect(polite).toContainText("2 of 2 sources done. 2 returned.", { timeout: 5000 });
  await expect(polite).not.toContainText("ZZ-0001");
  await expect(polite).not.toContainText("STOLEN");
  await expectNoSeriousAxeViolations(page);
});

test("[A4] ABC123: a clean no-record request ends with both sources returned", async ({ page }) => {
  const list = await openList(page);
  await runPlate(page, "ABC123");
  const row = list.getByRole("listitem").first();
  await expect(row).toContainText("Acknowledged");
  // No record is a returned source, not a failure; what it returned shows with M2 P1.
  await expect(statusLine(page, STATE, "returned")).toBeVisible({ timeout: 5000 });
  await expect(statusLine(page, NATIONAL, "returned")).toBeVisible({ timeout: 5000 });
  await expect(row).not.toContainText("pending");
  await expectNoSeriousAxeViolations(page);
});

test("FAIL1: the state source fails and the national source still returns", async ({ page }) => {
  const list = await openList(page);
  await runPlate(page, "FAIL1");
  const row = list.getByRole("listitem").first();
  await expect(statusLine(page, STATE, "failed")).toBeVisible({ timeout: 5000 });
  await expect(statusLine(page, NATIONAL, "returned")).toBeVisible({ timeout: 5000 });
  await expect(row).not.toContainText("pending");
  await expectNoSeriousAxeViolations(page);
});

test("TIMEOUT: the national source times out within its limit plus two seconds", async ({
  page,
}) => {
  test.slow();
  const list = await openList(page);
  await runPlate(page, "TIMEOUT");
  const row = list.getByRole("listitem").first();
  await expect(statusLine(page, STATE, "returned")).toBeVisible({ timeout: 5000 });
  // timeoutMs is 10 s in the default site config.
  await expect(statusLine(page, NATIONAL, "timed out")).toBeVisible({ timeout: 12_000 });
  await expect(page.getByTestId("announcer-polite")).toContainText("timed out");
  await expect(row).not.toContainText("pending");
  await expectNoSeriousAxeViolations(page);
});

test("typing into Plate while statuses arrive keeps focus and value (spec 6.6)", async ({
  page,
}) => {
  const list = await openList(page);
  await runPlate(page, "ZZ-0001");
  const field = page.getByLabel("Plate", { exact: true });
  // The form keeps its value after a submit; replace it, slowly, while the sources answer.
  await field.press("Control+A");
  await field.pressSequentially("ABC", { delay: 200 });
  await expect(statusLine(page, STATE, "returned")).toBeVisible({ timeout: 5000 });
  await expect(statusLine(page, NATIONAL, "returned")).toBeVisible({ timeout: 5000 });
  await field.pressSequentially("123", { delay: 100 });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("ABC123");
  // The status block is not a live region: only the shared announcer speaks.
  expect(await list.locator("[aria-live], [role=status], [role=alert]").count()).toBe(0);
  await expect(page.getByTestId("announcer-polite")).toContainText("sources done");
  await expectNoSeriousAxeViolations(page);
});
