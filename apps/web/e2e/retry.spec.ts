import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Failed-row retry (query surfaces): the first POST is answered 503 by the test (the app then shows
// a Failed row); Retry sends the kept values as a new request against the real server.

interface Sent {
  key: string | null;
  body: string | null;
}

/** Answers the first query POST with a 503 and lets every later one through; records each. */
async function failFirstQuery(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route("**/api/v1/queries", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent.push({
      key: await route.request().headerValue("idempotency-key"),
      body: route.request().postData(),
    });
    if (sent.length === 1) return route.fulfill({ status: 503, body: "" });
    return route.continue();
  });
  return sent;
}

test.describe("dispatcher retry (1366x768)", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test("Retry sends the kept values as a new request; the failed row stays, superseded; focus to the heading; one announcement", async ({
    page,
  }) => {
    await signIn(page, seededUser("dispatcher@example.test"));
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    const sent = await failFirstQuery(page);
    const plate = page.getByLabel("Plate", { exact: true });
    await plate.fill("ZZ-0001");
    await plate.press("Enter");
    const region = page.getByRole("region", { name: "Requests this shift" });
    const retry = region.getByRole("button", { name: /^Retry VEH\.ZZ-0001/ });
    await expect(retry).toBeVisible();
    await expect(region.getByText("The server was restarting.")).toBeVisible();
    const box = await retry.boundingBox();
    expect(Math.round(box?.height ?? 0), "dispatcher target").toBeGreaterThanOrEqual(36);

    // The draft moves on; the retry still sends what the row kept.
    await plate.fill("ZZ-0009");
    await retry.click();
    await expect(region.getByRole("listitem")).toHaveCount(2);
    await expect(region.getByRole("listitem").first()).toContainText("Acknowledged");
    await expect(region.getByRole("listitem").last()).toContainText("Failed");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body).toBe(sent[0]?.body);
    // SUBMIT-1: a retry is the same request, so it carries the same Idempotency-Key.
    expect(sent[1]?.key).toBe(sent[0]?.key);
    // M1 exit C1: the acknowledged retry supersedes the failed row, so its Retry leaves the page
    // and focus goes to the list heading (spec 6.4); the result went through the shared region only.
    await expect(retry).toHaveCount(0);
    await expect(region.getByRole("heading", { name: "Requests this shift" })).toBeFocused();
    await expect(page.getByTestId("announcer-polite")).toContainText(/Vehicle query sent at/);
    expect(await region.locator("[aria-live], [role=status], [role=alert]").count()).toBe(0);
  });
});

test.describe("officer retry (1024x768)", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("the retry replaces the one visible row; targets are 48 px; focus goes to the Last request heading", async ({
    page,
  }) => {
    await signIn(page, seededUser("officer@example.test"));
    await expect(page.locator(".qm-layout--mobile-unit")).toHaveCount(1);
    const sent = await failFirstQuery(page);
    const plate = page.getByLabel("Plate", { exact: true });
    await plate.fill("ZZ-0001");
    await plate.press("Enter");
    const region = page.getByRole("region", { name: "Last request" });
    const retry = region.getByRole("button", { name: /^Retry VEH\.ZZ-0001/ });
    await expect(retry).toBeVisible();
    const box = await retry.boundingBox();
    expect(Math.round(box?.height ?? 0), "officer target").toBeGreaterThanOrEqual(48);
    expect(Math.round(box?.width ?? 0), "officer target").toBeGreaterThanOrEqual(48);
    await retry.click();
    await expect(region.getByRole("listitem")).toHaveCount(1);
    await expect(region.getByRole("listitem")).toContainText("Acknowledged");
    expect(sent).toHaveLength(2);
    // SUBMIT-1: a retry is the same request, so it carries the same Idempotency-Key.
    expect(sent[1]?.key).toBe(sent[0]?.key);
    await expect(region.getByRole("heading", { name: "Last request" })).toBeFocused();
    await expect(page.getByTestId("announcer-polite")).toContainText(/Vehicle query sent at/);
  });
});
