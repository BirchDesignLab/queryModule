import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

/**
 * FR-064, FR-063, SEC-012 (spec 5.1, 6.2): the admin reads the audit log, filters it, pages it,
 * exports it, and opens a request from a row knowing the view is recorded. Signed in as the seeded
 * admin; mock data only (plate ZZ-####). Rows other specs wrote are in the log too, so the checks
 * name what this run did and never count the whole log.
 */

const ADMIN = seededUser("admin@example.test");

test.use({ emptyQueryList: true });

/** Sends one plate query as the admin so the log has a request row to open. */
async function submitOneQuery(page: Page): Promise<void> {
  const field = page.getByLabel("Plate", { exact: true });
  await expect(field).toBeVisible();
  await field.fill("ZZ-0001");
  await field.press("Enter");
  await expect(page.getByTestId("announcer-polite")).not.toHaveText("");
}

async function openAuditLog(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Admin" }).first().click();
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByRole("heading", { name: "Audit log", level: 2 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Audit events" })).toBeVisible();
}

test("[FR-064] filter by event, page once, export, open a request and find the view", async ({
  page,
}) => {
  await signIn(page, ADMIN);
  await submitOneQuery(page);
  await openAuditLog(page);
  await expectNoSeriousAxeViolations(page);

  // The default window shows rows; the event filter narrows the table to one type.
  const table = page.getByRole("table", { name: "Audit events" });
  await page.getByLabel("Event", { exact: true }).selectOption({ label: "Request submitted" });
  await page.getByRole("button", { name: "Apply filters" }).click();
  const rows = table.getByRole("row");
  await expect(rows.nth(1)).toContainText("Request submitted");
  for (const row of (await rows.all()).slice(1))
    await expect(row).toContainText("Request submitted");

  // Paging keeps focus on the control used.
  await page.getByLabel("Rows per page").selectOption("25");
  const older = page.getByRole("button", { name: "Older" });
  if (await older.isEnabled()) {
    await older.click();
    await expect(page.getByRole("button", { name: "Newer" })).toBeEnabled();
    await page.getByRole("button", { name: "Newer" }).click();
  }

  // Export: one JSON object per line, each with the stored fields.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export NDJSON" }).click();
  const file = await (await download).path();
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "");
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    const row = JSON.parse(line) as Record<string, unknown>;
    expect(row).toMatchObject({
      id: expect.any(Number),
      type: expect.any(String),
      at: expect.any(Number),
      actor: expect.objectContaining({ id: expect.any(String), role: expect.any(String) }),
      details: expect.any(Object),
    });
  }

  // Open a request from a row: the view says it is recorded.
  await page
    .getByRole("table", { name: "Audit events" })
    .getByRole("link", { name: /open this request/ })
    .first()
    .click();
  await expect(page.getByText("This view is recorded in the audit log.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Include hidden results" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expectNoSeriousAxeViolations(page);

  // Back keeps the filters; the view itself is now an adminViewed row.
  await page.getByRole("link", { name: "Back to audit log" }).click();
  await expect(page.getByLabel("Event", { exact: true })).toHaveValue(/submitted/);
  await page
    .getByLabel("Event", { exact: true })
    .selectOption({ label: "Request viewed by an admin" });
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("table", { name: "Audit events" })).toContainText(
    "Request viewed by an admin",
  );
});

test("[FR-064] a window over 31 days is blocked before any request", async ({ page }) => {
  await signIn(page, ADMIN);
  await openAuditLog(page);
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/admin/audit") && !r.url().includes("/export")) calls++;
  });
  await page.getByLabel("From", { exact: true }).fill("01-01-26 00:00");
  await page.getByLabel("To", { exact: true }).fill("03-01-26 00:00");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("Window can span at most 31 days.", { exact: true })).toBeVisible();
  expect(calls).toBe(0);
});

test("[FR-064] at 1366 the filters sit on two rows, in focus order (mockup v6)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, ADMIN);
  await openAuditLog(page);
  const form = page.getByRole("form", { name: "Audit filters" });
  // The user filter is a picker with the users list on, an ID field without it.
  const field = (label: string) =>
    label === "User" ? form.getByLabel(/^User( ID)?$/) : form.getByLabel(label, { exact: true });
  const top = async (label: string) => Math.round((await field(label).boundingBox())?.y ?? -1);
  const [user, request, event, from, to] = [
    await top("User"),
    await top("Request ID"),
    await top("Event"),
    await top("From"),
    await top("To"),
  ];
  // User, Request ID and Event share the first row; From and To share the second, below it.
  expect(new Set([user, request, event]).size).toBe(1);
  expect(from).toBe(to);
  expect(from).toBeGreaterThan(event);
  // The role tag sits under the email in the Actor column, on its own line (mockup v6).
  const actor = page
    .getByRole("table", { name: "Audit events" })
    .locator("tbody tr")
    .first()
    .locator("td")
    .nth(2);
  const email = await actor.locator("span").first().boundingBox();
  const role = await actor.locator(".qm-badge").boundingBox();
  expect(role?.y ?? 0).toBeGreaterThan((email?.y ?? 0) + (email?.height ?? 0) - 2);

  // Tab order is the reading order.
  await field("User").focus();
  for (const label of ["Request ID", "Event", "From", "To"]) {
    await page.keyboard.press("Tab");
    await expect(field(label)).toBeFocused();
  }
});
