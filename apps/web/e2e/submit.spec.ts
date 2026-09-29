import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

const QUERIES = "**/api/v1/queries";

/** Signs in, waits for the panel, types a plate and leaves focus in it (keyboard only from here). */
async function readyWithPlate(page: Page, plate: string) {
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();
  const field = page.getByLabel("Plate", { exact: true });
  await field.focus();
  await page.keyboard.type(plate);
  return field;
}

/** Answers the first POST with `first`, lets every later one through. */
async function failOnce(page: Page, first: (route: Route) => Promise<void>) {
  let calls = 0;
  await page.route(QUERIES, async (route) => {
    calls += 1;
    if (calls === 1) await first(route);
    else await route.continue();
  });
}

test("a 409 refetches the config, announces it and keeps the draft (spec 6.7)", async ({
  page,
}) => {
  const plate = await readyWithPlate(page, "ZZ-0011");
  await failOnce(page, (route) =>
    route.fulfill({ status: 409, contentType: "application/json", body: "{}" }),
  );
  const refetch = page.waitForRequest(
    (r) => r.url().endsWith("/api/v1/config") && r.method() === "GET",
  );
  await page.keyboard.press("Enter");
  await refetch;
  await expect(page.getByTestId("announcer-polite")).toHaveText(
    "The site configuration changed. Check the form and submit again.",
  );
  await expect(plate).toHaveValue("ZZ-0011");
  await expect(plate).toBeFocused();
});

test("a 503 announces that the server is restarting (spec 6.7)", async ({ page }) => {
  const plate = await readyWithPlate(page, "ZZ-0012");
  await failOnce(page, (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("announcer-polite")).toHaveText(
    "The server is restarting. Try again shortly.",
  );
  await expect(plate).toHaveValue("ZZ-0012");
});

test("an aborted request shows No connection, and the retry reuses the Idempotency-Key (spec 6.8, FR-064)", async ({
  page,
}) => {
  const plate = await readyWithPlate(page, "ZZ-0013");
  const keys: (string | undefined)[] = [];
  let calls = 0;
  await page.route(QUERIES, async (route) => {
    calls += 1;
    keys.push(route.request().headers()["idempotency-key"]);
    if (calls === 1) await route.abort("connectionrefused");
    else await route.continue();
  });
  await page.keyboard.press("Enter");

  // Focusable, aria-disabled (never disabled), and the visible reason is linked to it.
  const submit = page.getByRole("button", { name: "Submit" });
  await expect(submit).toHaveAttribute("aria-disabled", "true");
  await expect(submit).not.toHaveAttribute("disabled", /.*/);
  await expect(page.getByText("No connection to server")).toBeVisible();
  const reasonId = (await submit.getAttribute("aria-describedby")) ?? "";
  expect(reasonId).not.toBe("");
  await expect(page.locator(`#${reasonId.split(" ").at(-1)}`)).toHaveText(
    "No connection to server",
  );

  // The health poll clears the gate; the same query, resubmitted, carries the same key.
  await expect(submit).not.toHaveAttribute("aria-disabled", "true", { timeout: 20_000 });
  const retried = page.waitForResponse((r) => r.url().endsWith("/api/v1/queries"));
  await plate.focus();
  await page.keyboard.press("Enter");
  expect((await retried).status()).toBe(202);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});
