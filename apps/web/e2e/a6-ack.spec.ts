import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

// A6 (FR-043, FR-064, FR-065; spec 6.2, 10.2): a submit is acknowledged with its correlation ID and
// ack time, the entry carries both, the ID is copyable, and a polite announcement says when the
// results return. Keyboard only. The local build serves mock sources; nothing reaches a real system.

const ACK_TIME = String.raw`\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}`;

async function typePlate(page: Page, plate: string): Promise<void> {
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  await page.getByLabel("Year", { exact: true }).fill("26");
  const field = page.getByLabel("Plate", { exact: true });
  await field.focus();
  await page.keyboard.type(plate);
}

test("[A6] submit is acknowledged with its correlation ID and ack time, and results are announced", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await typePlate(page, "ZZ-0001");
  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
  );
  await page.keyboard.press("Enter");
  const reply = await posted;
  expect(reply.status()).toBe(202);
  const { correlationId } = (await reply.json()) as { correlationId: string };
  const short = correlationId.slice(0, 8);

  // The acknowledgment, spoken once and politely: type, ack time, short reference.
  const polite = page.getByTestId("announcer-polite");
  await expect(polite).toContainText(
    new RegExp(`Vehicle query sent at ${ACK_TIME}\\. Reference ${short}\\.`),
  );

  // The toast: type and plate, ack time, the reference; polite, no payload, dismissible by keyboard.
  const toast = page.getByTestId("ack-toast");
  await expect(toast).toHaveAttribute("role", "status");
  await expect(toast).toContainText("Vehicle ZZ-0001 acknowledged");
  await expect(toast).toContainText(new RegExp(`Sent ${ACK_TIME}`));
  await expect(toast.locator("code", { hasText: short })).toBeVisible();
  await expect(toast).not.toContainText("TESTMAKE");
  const toastCopy = toast.getByRole("button", {
    name: `Copy acknowledgment reference ${short} for Vehicle ZZ-0001`,
  });
  await toastCopy.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(correlationId);
  await toast.getByRole("button", { name: "Dismiss acknowledgment for Vehicle ZZ-0001" }).focus();
  await page.keyboard.press("Enter");
  await expect(toast).toBeHidden();

  // The entry carries the ack time (MM-DD-YY HH:mm:ss) and the correlation ID.
  const list = page.getByRole("region", { name: "Requests this shift" });
  const row = list.getByRole("listitem").first();
  await expect(row).toContainText("Acknowledged");
  await expect(row).toContainText(new RegExp(`Sent ${ACK_TIME}`));
  await expect(row.locator("code", { hasText: short })).toBeVisible();

  // Copy by keyboard puts the full ID on the clipboard and says so.
  const copy = row.getByRole("button", { name: `Copy reference ${short} for Vehicle ZZ-0001` });
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(polite).toContainText("Reference copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(correlationId);

  // The results return: a coalesced polite summary naming the request, no payload content.
  await expect(polite).toContainText("Vehicle ZZ-0001: 2 of 2 sources done.", { timeout: 8000 });
  await expect(polite).not.toContainText("TESTMAKE");
  await expectNoSeriousAxeViolations(page);
});
