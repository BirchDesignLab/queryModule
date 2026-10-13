import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

// Live per-source status (FR-043, FR-044, FR-065; spec 6.2, 6.6, 5.4). The local build serves mock
// sources (ALLOW_MOCK_SOURCES) and the real dispatcher, so each plate below is a canned scenario:
// ZZ-0001 and ABC123 return, FAIL1 fails at the state source, TIMEOUT times out at the national
// source. A returned source shows as a result card (spec 6.2); the announcements carry the query
// type, the plate, counts, status words and the severity keyword, never other payload content
// (ruling 12). Nothing here reaches any real state or national system.

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
  await expect(row.getByRole("group", { name: /Source status for Vehicle ZZ-0001/ })).toBeVisible();
  await expect(statusLine(page, STATE, "returned")).toBeVisible({ timeout: 5000 });
  await expect(statusLine(page, NATIONAL, "returned")).toBeVisible({ timeout: 5000 });
  // The summary names the request by its plate (ruling 12) and says the keyword that set the
  // severity; no other payload content.
  const polite = page.getByTestId("announcer-polite");
  await expect(polite).toContainText(
    "Vehicle ZZ-0001: 2 of 2 sources done. 2 returned, critical: STOLEN.",
    { timeout: 5000 },
  );
  await expect(polite).not.toContainText("TESTMAKE");
  await expect(polite).not.toContainText("SAMPLEMODEL");
  // Each source is a card with a critical badge, and the entry header repeats the severity.
  await expect(row.getByRole("region", { name: "State system: returned" })).toContainText(
    "Critical",
  );
  await expect(row.locator(".qm-request__severity")).toContainText("Critical");
  await expectNoSeriousAxeViolations(page);
});

test("[A4] ABC123: a clean no-record request ends with both sources returned", async ({ page }) => {
  const list = await openList(page);
  await runPlate(page, "ABC123");
  const row = list.getByRole("listitem").first();
  await expect(row).toContainText("Acknowledged");
  // No record is a returned source, not a failure; it shows as an info card.
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

test("[#587] a plate-only VEH shows the National system as not run, in words", async ({ page }) => {
  const list = await openList(page);
  // A plate alone runs plate-only: the planner drops the national source (spec 4.6 step 3).
  const field = page.getByLabel("Plate", { exact: true });
  await field.fill("ZZ-0001");
  await field.press("Enter");
  const row = list.getByRole("listitem").first();
  await expect(row).toContainText("Acknowledged");
  await expect(statusLine(page, STATE, "returned")).toBeVisible({ timeout: 5000 });
  await expect(statusLine(page, NATIONAL, "not run (plate only)")).toBeVisible();
  // The summary counts the dispatched source only and says what was not run.
  const polite = page.getByTestId("announcer-polite");
  await expect(polite).toContainText(
    "Vehicle ZZ-0001: 1 of 1 source done. 1 returned, critical: STOLEN. 1 not run.",
    { timeout: 5000 },
  );
  await expectNoSeriousAxeViolations(page);
});
