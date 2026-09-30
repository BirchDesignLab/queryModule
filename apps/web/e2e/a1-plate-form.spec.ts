import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

test("[A1] the plate form shows Plate, State TX, Year and VIN, and Enter submits (FR-004, FR-006, FR-064)", {
  tag: "@smoke",
}, async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();

  // VEH opens with exactly its four fields; State carries the "default" tag (spec 6.2).
  const plate = page.getByLabel("Plate", { exact: true });
  const state = page.getByLabel("State", { exact: true });
  await expect(plate).toBeVisible();
  await expect(state).toHaveValue("TX");
  await expect(page.getByLabel("Year")).toBeVisible();
  await expect(page.getByLabel("VIN")).toBeVisible();
  await expect(page.locator("main form input:not([type=checkbox]), main form select")).toHaveCount(
    4,
  );
  await expect(page.locator("main form").getByText("default", { exact: true })).toBeVisible();

  // Keyboard only: focus the first field, type, Enter.
  await plate.focus();
  await page.keyboard.type("ZZ-0001");
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/v1/queries") && r.method() === "POST",
  );
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
  );
  await page.keyboard.press("Enter");

  const body = (await request).postDataJSON() as {
    queryType: string;
    values: Record<string, unknown>;
  };
  expect(body.queryType).toBe("VEH");
  expect(body.values.plate).toBe("ZZ-0001");
  const reply = await response;
  expect(reply.status()).toBe(202);
  const { correlationId } = (await reply.json()) as { correlationId: string };
  expect(correlationId).not.toBe("");

  // The polite region gives the short reference; the requests list shows the same short reference on its row.
  await expect(page.getByTestId("announcer-polite")).toHaveText(
    new RegExp(String.raw`Vehicle query sent at .+\. Reference ${correlationId.slice(0, 8)}\.`),
  );
  const ack = page.getByRole("region", { name: "Requests this shift" });
  await expect(ack).toBeVisible();
  await expect(ack.getByRole("listitem")).toContainText(correlationId.slice(0, 8));
  await expectNoSeriousAxeViolations(page);
});
