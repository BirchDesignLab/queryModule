import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn, signOutFromHeader } from "./helpers.js";

// B3 (design system): the requests this session sent, on the dispatcher's right pane and as the
// officer's last request under the form. Submit stops at the 202 acknowledgment; nothing here
// reaches any state or national system, and there are no responses yet (M2).

const QUERIES = "**/api/v1/queries";

async function panelReady(page: Page): Promise<void> {
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
}

/** Holds the next POST until `release` is called, then lets the real server answer it. */
async function holdNextPost(page: Page): Promise<() => void> {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    QUERIES,
    async (route) => {
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  return release;
}

/** Types a plate into the first field and runs it with Enter; returns the 202's reference. */
async function runPlate(page: Page, plate: string): Promise<string> {
  const field = page.getByLabel("Plate", { exact: true });
  await field.fill(plate);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
  );
  await field.press("Enter");
  const reply = await response;
  expect(reply.status()).toBe(202);
  return ((await reply.json()) as { correlationId: string }).correlationId;
}

test("dispatcher: Sending, then Acknowledged with the ack's reference, newest first, cleared on sign-out", async ({
  page,
}) => {
  await signIn(page);
  await panelReady(page);
  const list = page.getByRole("region", { name: "Requests this shift" });
  await expect(list).toContainText("No requests yet this shift.");

  // The list sits in the right pane, beside the panel (two panes at desktop width).
  const [panel, pane] = await Promise.all([
    page.locator(".qm-panes__panel").boundingBox(),
    list.boundingBox(),
  ]);
  expect((pane?.x ?? 0) >= (panel?.x ?? 0) + (panel?.width ?? 0) - 1).toBe(true);

  const release = await holdNextPost(page);
  const first = runPlate(page, "ZZ-0001");
  const row = list.getByRole("listitem").first();
  await expect(row).toContainText("Sending");
  await expect(row.locator("code").first()).toContainText("VEH.ZZ-0001");
  release();
  const reference = await first;
  await expect(row).toContainText("Acknowledged");
  await expect(row).toContainText(reference.slice(0, 8));
  await expect(page.getByTestId("announcer-polite")).toContainText(
    `Reference ${reference.slice(0, 8)}.`,
  );
  // Focus stayed where the dispatcher was typing.
  await expect(page.getByLabel("Plate", { exact: true })).toBeFocused();

  await runPlate(page, "ZZ-0002");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").first().locator("code").first()).toContainText("ZZ-0002");
  await expect(list.getByRole("listitem").nth(1).locator("code").first()).toContainText("ZZ-0001");

  // Keyboard: the copy buttons are ordinary buttons, told apart by their command (two references
  // minutes apart share their first eight characters).
  await expect(
    list.getByRole("button", { name: /^Copy reference for VEH\.ZZ-0001/ }),
  ).toBeVisible();
  await expect(
    list.getByRole("button", { name: /^Copy reference for VEH\.ZZ-0002/ }),
  ).toBeVisible();

  await signOutFromHeader(page);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await signIn(page);
  await panelReady(page);
  await expect(page.getByRole("region", { name: "Requests this shift" })).toContainText(
    "No requests yet this shift.",
  );
  await expect(page.getByRole("listitem").filter({ hasText: "ZZ-000" })).toHaveCount(0);
});

test("dispatcher: a server error is a Failed row with its reason", async ({ page }) => {
  await signIn(page);
  await panelReady(page);
  await page.route(
    QUERIES,
    (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    { times: 1 },
  );
  await page.getByLabel("Plate", { exact: true }).fill("ZZ-0003");
  await page.getByLabel("Plate", { exact: true }).press("Enter");
  const row = page
    .getByRole("region", { name: "Requests this shift" })
    .getByRole("listitem")
    .first();
  await expect(row).toContainText("Failed");
  await expect(row).toContainText("The server was restarting.");
});

test("officer: the last request sits under the form, 48 px targets, and clears on sign-out", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signIn(page, seededUser("officer@example.test"));
  await panelReady(page);
  await expect(page.locator(".qm-layout--mobile-unit")).toHaveCount(1);
  const last = page.getByRole("region", { name: "Last request" });
  await expect(last).toContainText("Nothing sent yet.");

  const release = await holdNextPost(page);
  const first = runPlate(page, "ZZ-0001");
  await expect(last.getByRole("listitem")).toContainText("Sending");
  release();
  const reference = await first;
  const row = last.getByRole("listitem");
  await expect(row).toContainText("Acknowledged");
  await expect(row).toContainText(reference.slice(0, 8));

  // Below the form card, and every control in it is a 48 px target.
  const [card, box] = await Promise.all([
    page.locator(".qm-layout--mobile-unit .qm-panel__body").boundingBox(),
    last.boundingBox(),
  ]);
  expect(box?.y ?? 0).toBeGreaterThan((card?.y ?? 0) + (card?.height ?? 0) - 1);
  const copy = await last.getByRole("button", { name: /^Copy reference / }).boundingBox();
  expect(copy?.height ?? 0).toBeGreaterThanOrEqual(47.5);
  expect(copy?.width ?? 0).toBeGreaterThanOrEqual(47.5);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);

  // Only the latest request stays.
  await runPlate(page, "ZZ-0002");
  await expect(row).toHaveCount(1);
  await expect(row.locator("code").first()).toContainText("ZZ-0002");

  await signOutFromHeader(page);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await signIn(page, seededUser("officer@example.test"));
  await panelReady(page);
  await expect(page.getByRole("region", { name: "Last request" })).toContainText(
    "Nothing sent yet.",
  );
});
