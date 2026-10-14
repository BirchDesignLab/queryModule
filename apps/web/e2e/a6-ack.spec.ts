import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

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

/**
 * Records every polite announcement, not just the region's current text: the announcer keeps only
 * the latest message, so a later "Reference copied." would hide the results summary on a slow run.
 */
async function recordPolite(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __politeLog: string[] }).__politeLog = log;
    const watch = () => {
      const region = document.querySelector('[data-testid="announcer-polite"]');
      if (region === null) {
        requestAnimationFrame(watch);
        return;
      }
      new MutationObserver(() => {
        const text = region.textContent ?? "";
        if (text !== "" && log[log.length - 1] !== text) log.push(text);
      }).observe(region, { childList: true, characterData: true, subtree: true });
    };
    watch();
  });
  return () =>
    page.evaluate(() => (window as unknown as { __politeLog: string[] }).__politeLog ?? []);
}

test("[A6] submit is acknowledged with its correlation ID and ack time, and results are announced", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const spoken = await recordPolite(page);
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

  // The results return: a coalesced polite summary naming the request, no payload content. Read
  // from the log of everything spoken, so the copy announcements above cannot hide it.
  await expect
    .poll(
      async () => (await spoken()).some((m) => m.includes("Vehicle ZZ-0001: 2 of 2 sources done.")),
      {
        timeout: 8000,
      },
    )
    .toBe(true);
  expect((await spoken()).join(" ")).not.toContain("TESTMAKE");
  await expectNoSeriousAxeViolations(page);
});

test.describe("officer layout", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("[A6] the ack toast's Copy and Dismiss are at least 48 px tall for the officer (spec 6.3, UX-004)", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await signIn(page, seededUser("officer@example.test"));
    await typePlate(page, "ZZ-0001");
    await page.keyboard.press("Enter");
    const toast = page.getByTestId("ack-toast");
    await expect(toast).toBeVisible();
    for (const name of [/^Copy acknowledgment reference/, /^Dismiss acknowledgment/]) {
      const box = await toast.getByRole("button", { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    }
  });
});
