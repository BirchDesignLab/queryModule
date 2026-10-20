import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { recordPolite, signIn } from "./helpers.js";

// Offline (spec 10.4; NFR-003, FR-064; spec 6.6, 6.7). The browser context goes offline with
// context.setOffline: submit stays focusable with aria-disabled and a visible reason, Enter in the
// form and in the terminal sends nothing and keeps what was typed, and the change is announced
// politely once each way, never with a typed value. A request still pending when the connection
// dropped is refetched over HTTP once it is back and settles. Mock sources only: TIMEOUT times out
// at the national source after the site's 10 s limit; nothing reaches a real system.

const NATIONAL = "National system";
const OFFLINE = "No connection to server";
const RESTORED = "Connection restored";

async function openForm(page: Page) {
  await signIn(page);
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
}

test("offline: submit is held with a visible reason, Enter sends nothing, values stay (spec 10.4)", async ({
  page,
  context,
}) => {
  await openForm(page);
  const said = await recordPolite(page);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/v1/queries")) posts.push(r.url());
  });

  const plate = page.getByLabel("Plate", { exact: true });
  await plate.focus();
  await page.keyboard.type("QQ-0420");

  await context.setOffline(true);
  const submit = page.locator("#qp-submit");
  await expect(submit).toHaveAttribute("aria-disabled", "true");
  // The reason sits under the button (the header and the announcer say it too).
  const reason = page.locator("#qp-submit-reason");
  await expect(reason).toHaveText(OFFLINE);
  await expect(reason).toBeVisible();
  await expect(submit).toHaveAccessibleDescription(new RegExp(OFFLINE));
  await expect(page.getByTestId("announcer-polite")).toContainText(OFFLINE);
  // Announced once on the way down, before any gated key press re-announces the reason.
  expect((await said()).filter((s) => s.includes(OFFLINE))).toHaveLength(1);

  // Enter in the field: nothing sent, the value and focus stay.
  await page.keyboard.press("Enter");
  await expect(plate).toBeFocused();
  await expect(plate).toHaveValue("QQ-0420");
  // The submit control stays reachable by keyboard while held.
  await expect
    .poll(async () => {
      await page.keyboard.press("Tab");
      return page.evaluate(() => document.activeElement?.id ?? "");
    })
    .toBe("qp-submit");
  await page.keyboard.press("Enter");
  await expectNoSeriousAxeViolations(page);

  // The terminal's Enter is held the same way and keeps the typed command.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Slash");
  const command = page.getByRole("textbox", { name: "Command" });
  await expect(command).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("VEH.QQ-0421");
  await page.keyboard.press("Enter");
  await expect(command).toHaveValue("VEH.QQ-0421");
  expect(posts).toEqual([]);

  await context.setOffline(false);
  await expect(page.getByTestId("announcer-polite")).toContainText(RESTORED, { timeout: 15_000 });
  await expect(submit).not.toHaveAttribute("aria-disabled");
  await expect(reason).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);

  const spoken = await said();
  expect(spoken.filter((s) => s.includes(RESTORED))).toHaveLength(1);
  // Announcements never carry a typed value (spec 6.7).
  for (const text of spoken) {
    expect(text).not.toContain("QQ-0420");
    expect(text).not.toContain("QQ-0421");
  }
});

test("offline: a request pending when the connection dropped is refetched once it is back (spec 10.4, FR-064)", async ({
  page,
  context,
}) => {
  test.slow();
  await openForm(page);
  const list = page.getByRole("region", { name: "Requests this shift" });

  await page.getByLabel("Year", { exact: true }).focus();
  await page.keyboard.type("26");
  await page.getByLabel("Plate", { exact: true }).focus();
  await page.keyboard.type("TIMEOUT");
  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
  );
  await page.keyboard.press("Enter");
  const { correlationId } = (await (await posted).json()) as { correlationId: string };
  const row = list.getByRole("listitem").first();
  await expect(row).toContainText("Acknowledged");
  await expect(row.getByText(`${NATIONAL}: pending`, { exact: true })).toBeVisible();

  await context.setOffline(true);
  await expect(page.locator("#qp-submit")).toHaveAttribute("aria-disabled", "true");
  // The server times the national source out while the page is offline; read it from the test
  // side (not the page) so the wait targets that state.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/v1/queries/${correlationId}`);
        const body = (await res.json()) as { parts: { sources: { status: string }[] }[] };
        const statuses = body.parts.flatMap((p) => p.sources.map((s) => s.status));
        return statuses.length > 0 && statuses.every((s) => s !== "pending");
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(row.getByText(`${NATIONAL}: pending`, { exact: true })).toBeVisible();

  const refetched = page.waitForResponse(
    (r) =>
      r.request().method() === "GET" &&
      r.url().endsWith(`/api/v1/queries/${correlationId}`) &&
      r.ok(),
  );
  await context.setOffline(false);
  await refetched;
  await expect(row.getByText(`${NATIONAL}: timed out`, { exact: true })).toBeVisible();
  await expect(row).not.toContainText("pending");
  await expectNoSeriousAxeViolations(page);
});
